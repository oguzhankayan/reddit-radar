import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { join } from "node:path"
import { RadarBrowser, RADAR_HOME } from "../../browser/src/browser.ts"
import { RedditJsonBrowserSource } from "../../reddit-json/src/collector.ts"
import { compileQuery, planPartitions } from "../../query-compiler/src/compile.ts"
import { stage1Verdict, shortlist, type Stage1Verdict, type ResearchSpec } from "../../classifiers/src/stage1.ts"
import { batchState, batchQuestions, splitBatchAnswers, } from "../../classifiers/src/stage1-batch.ts"
import { stage2Questions, type PresetName } from "../../classifiers/src/stage2.ts"
import { scoreWithBreakdown } from "../../scoring/src/opportunity.ts"
import { clusterChunk, mergeClusters } from "../../llm/src/synthesis.ts"
import { decide, pool, Meter, POST_CHARS, DEFAULT_CONCURRENCY } from "../../jev/src/client.ts"
import { toDecision } from "../../jev/src/decision.ts"
import { LlmMeter } from "../../llm/src/deepseek.ts"
import type { RadarItem } from "../../shared/src/types.ts"
import { browserMutex } from "../../shared/src/mutex.ts"
import { purgeAllExpired } from "./retention.ts"

type Scored = { item: RadarItem; p1?: Record<string, number>; s1?: number; p2?: Record<string, number>; v1?: Stage1Verdict; score?: number; basis?: { signalsUsed: string[]; signalCoverage: number } }

const probsOf = (answers: Record<string, any>) => {
  const p: Record<string, number> = {}
  for (const [k, a] of Object.entries(answers)) {
    p[k] = a.type === "noul" ? a.noul : a.type === "score" ? a.score : toDecision(a).confidence
  }
  return p
}
/** Ölçülen en iyi paket boyutu (docs/batch-bench.md). */
const STAGE1_BATCH = Number(process.env.RADAR_STAGE1_BATCH ?? 10)

const stateOf = (i: RadarItem) => ({ subreddit: i.subreddit, title: i.title ?? "", body: i.body.slice(0, POST_CHARS) })

export type ScanPhase =
  | { phase: "planning" }
  | { phase: "planned"; topic: string; preset: string; subreddits: number; partitions: number }
  | { phase: "collecting"; collected: number; target: number }
  | { phase: "quota_wait"; seconds: number }
  | { phase: "collected"; collected: number; requests: number; cacheHits: number; duplicateRatio: number }
  | { phase: "stage1"; matched: number }
  | { phase: "stage2"; highSignal: number; scored: number }
  | { phase: "synthesized"; clusters: number }
  | { phase: "queued"; ahead: number }
  | { phase: "cancelled" }

export type ScanHooks = { onPhase?: (e: ScanPhase) => void }

export async function runScan(
  opts: { question: string; preset?: PresetName; target: number; scanId?: string; signal?: AbortSignal },
  hooks: ScanHooks = {},
): Promise<{ ok: true; scanId: string; dir: string; results: any } | { ok: false; scanId: string; reason: string }> {
  const emit = (e: ScanPhase) => hooks.onPhase?.(e)
  const scanId = opts.scanId ?? `scan_${Date.now().toString(36)}`
  const dir = join(RADAR_HOME, "scans", scanId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const jev = new Meter()
  const llm = new LlmMeter()
  const signal = opts.signal
  const aborted = () => signal?.aborted === true
  /** Sınıflandırma hataları sessizce yutulmaz — sayılır ve rapora girer. */
  const failures = { stage1: 0, stage2: 0, cluster: 0 }

  purgeAllExpired()

  // ── Planning ───────────────────────────────────────────────────────────
  emit({ phase: "planning" })
  const compiled = await compileQuery(opts.question, llm)
  if (!compiled.ok) return { ok: false, scanId, reason: `plan_failed: ${compiled.reason}` }
  const plan = { ...compiled.plan, preset: opts.preset ?? compiled.plan.preset }
  const partitions = planPartitions(plan, opts.target)
  const spec: ResearchSpec = {
    topic: plan.topic, domain: plan.domain,
    pain_signals: plan.pain_signals, who: plan.who, negative_signals: plan.negative_signals,
  }
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ question: opts.question, ...plan, partitions }, null, 2))
  emit({ phase: "planned", topic: plan.topic, preset: plan.preset, subreddits: plan.candidate_subreddits.length, partitions: partitions.length })

  // ── Collecting ─────────────────────────────────────────────────────────

  if (browserMutex.locked) emit({ phase: "queued", ahead: browserMutex.waiting + 1 })
  const releaseBrowser = await browserMutex.acquire()
  if (aborted()) { releaseBrowser(); emit({ phase: "cancelled" }); return { ok: false, scanId, reason: "cancelled" } }

  // launch() MUTLAKA try'ın içinde: dışarıdayken fırlatırsa (Chrome yok,
  // profil kullanıcının kendi Chrome'unda açık, disk dolu) releaseBrowser()
  // hiç çalışmıyordu ve sonraki HER tarama sessizce sonsuza kilitleniyordu.
  const items: RadarItem[] = []
  let collectStats: any
  let browser: RadarBrowser | undefined
  try {
    browser = await RadarBrowser.launch({ headless: false })
    const src = new RedditJsonBrowserSource(browser, {
      onProgress: (e) => {
        if (e.type === "page") emit({ phase: "collecting", collected: e.total, target: opts.target })
        else if (e.type === "quota_wait") emit({ phase: "quota_wait", seconds: e.seconds })
      },
    })
    for await (const item of src.collect({ partitions, targetItems: opts.target, maxPagesPerPartition: 10, spacingMs: 1_100, signal })) {
      items.push(item)
      appendFileSync(join(dir, "items.ndjson"), JSON.stringify(item) + "\n")
    }
    collectStats = src.stats
    emit({ phase: "collected", collected: items.length, requests: collectStats.requestCount, cacheHits: collectStats.cacheHits, duplicateRatio: collectStats.duplicateRatio })
  } catch (err) {
    return { ok: false, scanId, reason: `browser_failed: ${String((err as Error)?.message ?? err).slice(0, 200)}` }
  } finally {
    await browser?.close().catch(() => {})
    releaseBrowser()
  }
  if (aborted()) { emit({ phase: "cancelled" }); return { ok: false, scanId, reason: "cancelled" } }
  if (!items.length) return { ok: false, scanId, reason: "no_items_collected" }

  // ── Stage 1 ────────────────────────────────────────────────────────────

  const rows: Scored[] = items.map((item) => ({ item }))
  // Ölçüldü: Jev tavanı ~3.3 çağrı/sn ve eşzamanlılıktan bağımsız → bağlayıcı
  // kısıt çağrı sayısı. 10 item/çağrı 5.6x hızlı, %33 ucuz ve shortlist
  // örtüşmesi %100 (docs/batch-bench.md). 20'de örtüşme %80'e düşüyor.
  const chunks: Scored[][] = []
  for (let i = 0; i < rows.length; i += STAGE1_BATCH) chunks.push(rows.slice(i, i + STAGE1_BATCH))

  await pool(chunks, DEFAULT_CONCURRENCY, async (chunk) => {
    const res = await decide({
      purpose: "stage1",
      state: batchState(chunk.map((r) => ({ id: r.item.id, subreddit: r.item.subreddit, title: r.item.title ?? "", body: r.item.body })), POST_CHARS),
      questions: batchQuestions(chunk.length, spec),
    }, jev)
    if (!res.ok) { failures.stage1 += chunk.length; return }
    const split = splitBatchAnswers(res.answers as any, chunk.length)
    for (const [i, probs] of split.entries()) {
      const row = chunk[i]!
      if (!probs) { failures.stage1++; continue }
      row.p1 = probs
      row.v1 = stage1Verdict(probs)
      row.s1 = row.v1.score
      appendFileSync(join(dir, "stage1.ndjson"), JSON.stringify({ id: row.item.id, probs, ...row.v1 }) + "\n")
    }
  }, signal)
  if (aborted()) { emit({ phase: "cancelled" }); return { ok: false, scanId, reason: "cancelled" } }

  // Kota bir ÜRÜN kararı: taranan havuzun %5'i, en az 50, en çok 500.
  // Skor tabanı yok — kota varken eşiğe gerek yok (bkz. stage1.ts).
  // Kota "en fazla kaç" sorusunun cevabı; fit tabanı "aday sayılır mı" sorusununki.
  const quota = Math.min(500, Math.max(50, Math.round(rows.length * 0.05)))
  const short = shortlist(rows, (r) => r.v1, quota)
  emit({ phase: "stage1", matched: short.length })
  if (!short.length) return { ok: false, scanId, reason: "empty_shortlist" }

  // ── Stage 2 ────────────────────────────────────────────────────────────

  const q2 = stage2Questions(plan.preset as PresetName, plan.topic)
  await pool(short, DEFAULT_CONCURRENCY, async (row) => {
    const res = await decide({ purpose: "stage2", state: stateOf(row.item), questions: q2 }, jev)
    if (!res.ok) { failures.stage2++; return }
    if (res.ok) {
      row.p2 = probsOf(res.answers)
      const b = scoreWithBreakdown(row.p2, plan.preset as any)
      row.score = b.score
      row.basis = b
      appendFileSync(join(dir, "stage2.ndjson"), JSON.stringify({ id: row.item.id, probs: row.p2, score: row.score }) + "\n")
    }
  }, signal)
  if (aborted()) { emit({ phase: "cancelled" }); return { ok: false, scanId, reason: "cancelled" } }
  const evidence = short.filter((r) => r.score !== undefined).sort((a, b) => b.score! - a.score!)
  emit({ phase: "stage2", highSignal: evidence.filter((r) => r.score! >= 50).length, scored: evidence.length })

  // ── Synthesis ──────────────────────────────────────────────────────────

  const top = evidence.slice(0, 200)
  const clusterChunks: typeof top[] = []
  for (let i = 0; i < top.length; i += 25) clusterChunks.push(top.slice(i, i + 25))
  const allClusters = (await pool(clusterChunks, 3, async (chunk) => {
    const res = await clusterChunk(
      chunk.map((r) => ({ id: r.item.id, subreddit: r.item.subreddit, title: r.item.title ?? "", excerpt: r.item.body })),
      plan.topic, llm,
    )
    if (!res.ok) { failures.cluster++; return [] }
    return res.clusters
  })).flat()
  const clusters = mergeClusters(allClusters)
  emit({ phase: "synthesized", clusters: clusters.length })

  // ── Output ─────────────────────────────────────────────────────────────
  const partial = statusOf(collectStats.collected, opts.target, failures, rows.length, short.length)
  const byId = new Map(evidence.map((r) => [r.item.id, r]))
  const results = {
    scan_id: scanId,
    question: opts.question,
    topic: plan.topic,
    preset: plan.preset,
    status: partial.status,
    partial_reason: partial.reason,
    coverage: {
      items_requested: opts.target,
      items_collected: collectStats.collected,
      duplicate_ratio: collectStats.duplicateRatio,
      requests_live: collectStats.requestCount,
      subreddits_scanned: collectStats.subredditsScanned,
      queries_executed: collectStats.queriesExecuted,
      partitions_completed: collectStats.partitionsCompleted,
      partitions_failed: collectStats.partitionsFailed,
      rate_limit_hits: collectStats.rateLimitHits,
      time_range_observed: collectStats.timeRangeObserved,
      stage1_matched: short.length,
      stage2_scored: evidence.length,
      cache_hits: collectStats.cacheHits ?? 0,
      classification_failures: failures,
    },
    cost: { jev_usd: +jev.usd.toFixed(4), llm_usd: +llm.usd.toFixed(4) },
    // Skor hangi sinyaller üzerinden hesaplandı — preset'ler farklı sinyal
    // üretir, bu olmadan skorlar karşılaştırılamaz görünürdü.
    score_basis: { preset: plan.preset, signals_used: evidence[0]?.basis?.signalsUsed ?? [], signal_coverage: evidence[0]?.basis?.signalCoverage ?? 0 },
    clusters: clusters.map((c) => {
      const members = c.member_ids.map((id) => byId.get(id)).filter(Boolean) as Scored[]
      return {
        cluster_name: c.cluster_name,
        count: members.length,
        avg_opportunity: members.length ? Math.round(members.reduce((a, m) => a + m.score!, 0) / members.length) : 0,
        summary: c.summary,
        common_pattern: c.common_pattern,
        evidence: members.sort((a, b) => b.score! - a.score!).slice(0, 10).map((m) => ({
          reddit_url: m.item.url,
          subreddit: m.item.subreddit,
          title: m.item.title,
          excerpt: m.item.body.slice(0, 300),
          opportunity: m.score,
        })),
      }
    }),
  }
  writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2))

  const csv = ["cluster,opportunity,subreddit,url,title"]
  for (const c of results.clusters) {
    for (const e of c.evidence) {
      csv.push([c.cluster_name, e.opportunity, e.subreddit, e.reddit_url, e.title ?? ""].map(csvCell).join(","))
    }
  }
  writeFileSync(join(dir, "evidence.csv"), csv.join("\n"))

  return { ok: true, scanId, dir, results }
}

/**
 * Durum, yalnız toplanan sayıya değil sınıflandırma sağlığına da bakar.
 * Yoksa Stage 1'in üçte biri hata verse bile rapor "completed" görünürdü.
 */
function statusOf(
  collected: number, target: number,
  failures: { stage1: number; stage2: number; cluster: number },
  stage1Total: number, stage2Total: number,
): { status: "completed" | "partial"; reason?: string } {
  if (collected < target) return { status: "partial", reason: `hedefin ${Math.round((collected / target) * 100)}%'i toplandı` }
  if (stage1Total && failures.stage1 / stage1Total > 0.02) {
    return { status: "partial", reason: `Stage 1'de ${failures.stage1}/${stage1Total} sınıflandırma başarısız` }
  }
  if (stage2Total && failures.stage2 / stage2Total > 0.02) {
    return { status: "partial", reason: `Stage 2'de ${failures.stage2}/${stage2Total} sınıflandırma başarısız` }
  }
  if (failures.cluster > 0) {
    return { status: "partial", reason: `${failures.cluster} cluster chunk'ı başarısız — bazı evidence kümelenemedi` }
  }
  return { status: "completed" }
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "")
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
