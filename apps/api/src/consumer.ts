import type { Env, ClassifyMessage } from "./types.ts"
import { decide, pool, POST_CHARS } from "../../../packages/jev/src/client.ts"
import { batchState, batchQuestions, splitBatchAnswers } from "../../../packages/classifiers/src/stage1-batch.ts"
import { stage1Verdict, shortlist, type ResearchSpec } from "../../../packages/classifiers/src/stage1.ts"
import { stage2Questions, type PresetName } from "../../../packages/classifiers/src/stage2.ts"
import { scoreWithBreakdown } from "../../../packages/scoring/src/opportunity.ts"
import { clusterChunk, mergeClusters } from "../../../packages/llm/src/synthesis.ts"
import { toDecision } from "../../../packages/jev/src/decision.ts"
import type { RadarItem } from "../../../packages/shared/src/types.ts"

/** Ölçülen en iyi paket boyutu (docs/batch-bench.md). */
const STAGE1_BATCH = 10
/** 40 item/chunk ile çıktı JSON'u kesiliyordu (3/7 chunk düştü). */
const CLUSTER_CHUNK = 25
const CONCURRENCY = 8

const specOf = (plan: any): ResearchSpec => ({
  topic: plan.topic, domain: plan.domain,
  pain_signals: plan.pain_signals, who: plan.who, negative_signals: plan.negative_signals,
})
const stateOf = (i: RadarItem) => ({ subreddit: i.subreddit, title: i.title ?? "", body: i.body.slice(0, POST_CHARS) })
const probsOf = (answers: Record<string, any>) => {
  const p: Record<string, number> = {}
  for (const [k, a] of Object.entries(answers)) {
    p[k] = a.type === "noul" ? a.noul : a.type === "score" ? a.score : toDecision(a).confidence
  }
  return p
}

export async function handleBatch(batch: MessageBatch<ClassifyMessage>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      if (msg.body.kind === "stage1") await runStage1(env, msg.body.scanId, msg.body.chunkKey)
      else await finalize(env, msg.body.scanId)
      msg.ack()
    } catch (err) {
      console.error(`[queue] ${msg.body.kind} ${msg.body.scanId}: ${String((err as Error)?.message ?? err).slice(0, 200)}`)
      msg.retry()
    }
  }
}

async function runStage1(env: Env, scanId: string, chunkKey: string): Promise<void> {
  const scan = await env.DB.prepare(`SELECT * FROM scans WHERE id = ?`).bind(scanId).first<any>()
  if (!scan) return
  const obj = await env.ARTIFACTS.get(chunkKey)
  if (!obj) return
  const items = await obj.json<RadarItem[]>()
  const spec = specOf(JSON.parse(scan.spec))

  const chunks: RadarItem[][] = []
  for (let i = 0; i < items.length; i += STAGE1_BATCH) chunks.push(items.slice(i, i + STAGE1_BATCH))

  let ok = 0, failed = 0
  const rows: { id: string; fit: number; dq: number; score: number }[] = []
  await pool(chunks, CONCURRENCY, async (chunk) => {
    const res = await decide({
      purpose: "stage1",
      apiKey: env.TYPESAFE_API_KEY,
      state: batchState(chunk.map((c) => ({ id: c.id, subreddit: c.subreddit, title: c.title ?? "", body: c.body })), POST_CHARS),
      questions: batchQuestions(chunk.length, spec),
    })
    if (!res.ok) { failed += chunk.length; return }
    for (const [i, probs] of splitBatchAnswers(res.answers as any, chunk.length).entries()) {
      const item = chunk[i]!
      if (!probs) { failed++; continue }
      const v = stage1Verdict(probs)
      rows.push({ id: item.id, fit: v.fit, dq: probs.disqualified ?? 1, score: v.blocked ? -1 : v.score })
      ok++
    }
  })

  if (rows.length) {
    await env.DB.batch(rows.map((r) =>
      env.DB.prepare(`INSERT OR REPLACE INTO item_scores (scan_id, item_id, fit, disqualified, score) VALUES (?,?,?,?,?)`)
        .bind(scanId, r.id, r.fit, r.dq, r.score)))
  }
  await env.DB.prepare(`UPDATE scans SET classified = classified + ?, failures = failures + ? WHERE id = ?`)
    .bind(ok, failed, scanId).run()
  await env.DB.prepare(`INSERT INTO usage_events (account_id, scan_id, kind, units) VALUES (?,?,'classified_items',?)`)
    .bind(scan.account_id, scanId, ok).run()
}

async function finalize(env: Env, scanId: string): Promise<void> {
  const scan = await env.DB.prepare(`SELECT * FROM scans WHERE id = ?`).bind(scanId).first<any>()
  if (!scan) return

  // Stage 1 hâlâ akıyorsa bekle ve mesajı geri koy.
  if (scan.classified + scan.failures < scan.received) {
    await env.CLASSIFY.send({ kind: "finalize", scanId }, { delaySeconds: 10 })
    return
  }

  const plan = JSON.parse(scan.spec)
  const spec = specOf(plan)
  await env.DB.prepare(`UPDATE scans SET status = 'classifying_stage2' WHERE id = ?`).bind(scanId).run()

  // Kota: havuzun %5'i, 50-500 arası. Taban stage1Verdict/shortlist'te.
  const quota = Math.min(500, Math.max(50, Math.round(scan.classified * 0.05)))
  const ranked = await env.DB.prepare(
    `SELECT item_id, fit, score FROM item_scores WHERE scan_id = ? AND score >= 0 ORDER BY score DESC LIMIT ?`,
  ).bind(scanId, quota * 2).all<{ item_id: string; fit: number; score: number }>()

  const picked = shortlist(
    ranked.results, (r) => ({ blocked: false, score: r.score, fit: r.fit }), quota,
  )
  const wanted = new Set(picked.map((r) => r.item_id))
  const items = await loadItems(env, scanId, wanted)

  // Stage 2
  const preset = (plan.preset ?? "saas_opportunities") as PresetName
  const q2 = stage2Questions(preset, spec.topic)
  const scored: { item: RadarItem; opportunity: number; basis: any }[] = []
  let s2failed = 0
  await pool([...items.values()], CONCURRENCY, async (item) => {
    const res = await decide({ purpose: "stage2", apiKey: env.TYPESAFE_API_KEY, state: stateOf(item), questions: q2 })
    if (!res.ok) { s2failed++; return }
    const probs = probsOf(res.answers)
    const b = scoreWithBreakdown(probs, preset)
    scored.push({ item, opportunity: b.score, basis: b })
    await env.DB.prepare(`UPDATE item_scores SET stage2 = ?, opportunity = ? WHERE scan_id = ? AND item_id = ?`)
      .bind(JSON.stringify(probs), b.score, scanId, item.id).run()
  })
  scored.sort((a, b) => b.opportunity - a.opportunity)

  // Sentez
  await env.DB.prepare(`UPDATE scans SET status = 'synthesizing' WHERE id = ?`).bind(scanId).run()
  const top = scored.slice(0, 200)
  const cchunks: typeof top[] = []
  for (let i = 0; i < top.length; i += CLUSTER_CHUNK) cchunks.push(top.slice(i, i + CLUSTER_CHUNK))
  let cfailed = 0
  const all = (await pool(cchunks, 2, async (chunk) => {
    const res = await clusterChunk(
      chunk.map((r) => ({ id: r.item.id, subreddit: r.item.subreddit, title: r.item.title ?? "", excerpt: r.item.body })),
      spec.topic, undefined, env.DEEPSEEK_API_KEY,
    )
    if (!res.ok) { cfailed++; console.error(`[cluster] ${scanId}: ${res.reason}`); return [] }
    return res.clusters
  })).flat()
  const clusters = mergeClusters(all)

  const byId = new Map(scored.map((s) => [s.item.id, s]))
  const now = Date.now() / 1000
  /**
   * Prospecting için gereken alanlar. Cluster'lar "pazar ne diyor" sorusunu
   * cevaplıyor; bunlar "kime, ne zamana kadar yazılabilir" sorusunu.
   *
   * `age_days` bilerek öne çıkarıldı: bir hizmet arayışı hızla soğur. Sekiz ay
   * önce "SEO lazım" diyen çoktan birini bulmuştur. `comments` de aynı sebeple —
   * 50 yorumlu bir post zaten cevaplanmıştır.
   */
  const asProspect = (m: (typeof scored)[number]) => ({
    reddit_url: m.item.url,
    subreddit: m.item.subreddit,
    author: m.item.author ?? null,
    title: m.item.title,
    excerpt: m.item.body.slice(0, 300),
    opportunity: m.opportunity,
    age_days: m.item.createdAt ? Math.round((now - m.item.createdAt) / 86_400) : null,
    score: m.item.score ?? null,
    comments: m.item.commentsCount ?? null,
  })

  // Subreddit kırılımı: "nerede yoğunlaşıyor" sorusunun cevabı.
  const bySub = new Map<string, { n: number; total: number; best: number; url: string }>()
  for (const m of scored) {
    const e = bySub.get(m.item.subreddit) ?? { n: 0, total: 0, best: -1, url: "" }
    e.n++; e.total += m.opportunity
    if (m.opportunity > e.best) { e.best = m.opportunity; e.url = m.item.url }
    bySub.set(m.item.subreddit, e)
  }
  const subreddit_breakdown = [...bySub.entries()]
    .map(([subreddit, e]) => ({
      subreddit, evidence_count: e.n,
      avg_opportunity: Math.round(e.total / e.n),
      top_opportunity: e.best, top_url: e.url,
    }))
    .sort((a, b) => b.evidence_count - a.evidence_count || b.avg_opportunity - a.avg_opportunity)
  const partial = partialReason(scan, s2failed, scored.length, cfailed)
  const results = {
    scan_id: scanId, question: scan.question, topic: spec.topic, preset: plan.preset,
    status: partial ? "partial" : "completed", partial_reason: partial,
    coverage: {
      items_received: scan.received, items_classified: scan.classified,
      stage1_failures: scan.failures, stage2_failures: s2failed,
      shortlist: picked.length, evidence: scored.length,
    },
    // "signal_coverage" bilerek böyle adlandırıldı: eski adı `coverage` idi ve
    // veri kapsamasıyla karıştırılıp kullanıcıya "Reddit'in yarısı tarandı"
    // diye yanlış aktarıldı. Veri kapsaması yukarıdaki `coverage` bloğunda.
    subreddit_breakdown,
    // Düz sıralı liste — cluster'a girmemiş item'lar da burada.
    prospects: scored.slice(0, 300).map(asProspect),
    score_basis: {
      preset,
      signals_used: scored[0]?.basis?.signalsUsed ?? [],
      signal_coverage: scored[0]?.basis?.signalCoverage ?? 0,
      note: "signal_coverage = skor ağırlığının ne kadarının arkasında sinyal olduğu. Kaç post tarandığıyla İLGİSİ YOKTUR.",
    },
    clusters: clusters.map((c) => {
      const members = c.member_ids.map((id) => byId.get(id)).filter(Boolean) as typeof scored
      return {
        cluster_name: c.cluster_name, count: members.length,
        avg_opportunity: members.length ? Math.round(members.reduce((a, m) => a + m.opportunity, 0) / members.length) : 0,
        summary: c.summary, common_pattern: c.common_pattern,
        evidence: members.slice(0, 10).map(asProspect),
      }
    }),
  }

  await env.ARTIFACTS.put(`results/${scanId}.json`, JSON.stringify(results), {
    httpMetadata: { contentType: "application/json" },
  })
  await env.DB.prepare(`UPDATE scans SET status = ?, partial_reason = ?, finished_at = datetime('now') WHERE id = ?`)
    .bind(results.status, partial ?? null, scanId).run()

  // Ham metin işi bitince hemen silinir (v2 §34) — saklama süresini beklemez.
  const list = await env.ARTIFACTS.list({ prefix: `raw/${scanId}/` })
  await Promise.all(list.objects.map((o) => env.ARTIFACTS.delete(o.key)))
}

function partialReason(scan: any, s2failed: number, s2total: number, cfailed: number): string | undefined {
  if (scan.received < scan.target_items) return `hedefin %${Math.round((scan.received / scan.target_items) * 100)}'i toplandı`
  if (scan.classified && scan.failures / (scan.classified + scan.failures) > 0.02) return `Stage 1'de ${scan.failures} sınıflandırma başarısız`
  if (s2total && s2failed / (s2total + s2failed) > 0.02) return `Stage 2'de ${s2failed} sınıflandırma başarısız`
  if (cfailed) return `${cfailed} cluster chunk'ı başarısız`
  return undefined
}

/** Stage 2 ve evidence için metin gerekir; R2'deki ham chunk'lardan toplanır. */
async function loadItems(env: Env, scanId: string, wanted: Set<string>): Promise<Map<string, RadarItem>> {
  const out = new Map<string, RadarItem>()
  let cursor: string | undefined
  do {
    const page = await env.ARTIFACTS.list({ prefix: `raw/${scanId}/`, cursor })
    for (const o of page.objects) {
      const obj = await env.ARTIFACTS.get(o.key)
      if (!obj) continue
      for (const item of await obj.json<RadarItem[]>()) if (wanted.has(item.id)) out.set(item.id, item)
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return out
}
