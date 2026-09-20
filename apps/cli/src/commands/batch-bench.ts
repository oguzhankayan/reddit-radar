import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { decide, pool, Meter, POST_CHARS, DEFAULT_CONCURRENCY } from "../../../../packages/jev/src/client.ts"
import { stage1Questions, stage1Verdict, type ResearchSpec } from "../../../../packages/classifiers/src/stage1.ts"
import { batchState, batchQuestions, splitBatchAnswers } from "../../../../packages/classifiers/src/stage1-batch.ts"
import type { RadarItem } from "../../../../packages/shared/src/types.ts"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

const SPEC: ResearchSpec = {
  topic: "choosing, paying for, or being frustrated by software tools used to run a business",
  domain: "running or building a software, SaaS, or online business",
  pain_signals: ["is comparing two or more specific software products", "complains that a tool is too expensive", "is looking for an alternative to a tool they name", "is stuck doing something manually because no tool fits"],
  who: ["a founder running a small software or online business", "someone who personally pays for the tools they describe"],
  negative_signals: ["is asking about careers, jobs, or hiring", "is a listicle or thought-leadership piece", "is announcing something the author built or sells"],
}
const KEYS = ["disqualified", "fit"]

/**
 * Batching precision'ı bozuyor mu?
 *
 * Aynı item'lar hem tek tek hem paketli sınıflandırılır; olasılıklar
 * karşılaştırılır. Kabul ölçütü: sıralama korunmalı (shortlist örtüşmesi
 * yüksek) ve kriter bazında ortalama sapma küçük olmalı.
 */
export async function batchBench(n: number, sizes: number[]): Promise<void> {
  const raw = readFileSync(fromRoot("tests/fixtures/g1-collect.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as RadarItem)
  const items = raw.filter((i) => i.body.length > 150).slice(0, n)
  console.log(`\nBatch benchmark — ${items.length} item, boyutlar: ${sizes.join(", ")}\n`)

  // Referans: tek tek
  const single = new Meter()
  const t0 = Date.now()
  const base = await pool(items, DEFAULT_CONCURRENCY, async (it) => {
    const res = await decide({
      purpose: "single",
      state: { subreddit: it.subreddit, title: it.title ?? "", body: it.body.slice(0, POST_CHARS) },
      questions: stage1Questions(SPEC),
    }, single)
    if (!res.ok) return null
    const a = res.answers as any
    return { disqualified: a.disqualified?.noul ?? 0, fit: a.fit?.score ?? 0 } as Record<string, number>
  })
  const singleMs = Date.now() - t0
  const okBase = base.filter(Boolean).length
  console.log(`  tek tek: ${singleMs} ms · ${single.calls} çağrı · ${single.inputTokens} token · $${single.usd.toFixed(4)} · ${okBase}/${items.length} başarılı`)

  const rows: string[] = []
  for (const size of sizes) {
    const meter = new Meter()
    const chunks: RadarItem[][] = []
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))

    const t1 = Date.now()
    const results = await pool(chunks, DEFAULT_CONCURRENCY, async (chunk) => {
      const res = await decide({
        purpose: `batch${size}`,
        state: batchState(chunk.map((c) => ({ id: c.id, subreddit: c.subreddit, title: c.title ?? "", body: c.body })), POST_CHARS),
        questions: batchQuestions(chunk.length, SPEC),
      }, meter)
      return res.ok ? splitBatchAnswers(res.answers as any, chunk.length) : chunk.map(() => null)
    })
    const ms = Date.now() - t1
    const flat = results.flat()

    // Karşılaştırma
    let compared = 0, absSum = 0, agree = 0, parseFail = 0
    const perKey: Record<string, number> = Object.fromEntries(KEYS.map((k) => [k, 0]))
    for (let i = 0; i < items.length; i++) {
      const a = base[i], b = flat[i]
      if (!b) { parseFail++; continue }
      if (!a) continue
      compared++
      // fit 0-4, disqualified 0-1 → aynı ölçeğe getirip karşılaştır
      for (const k of KEYS) {
        const scale = k === "fit" ? 4 : 1
        const d = Math.abs(((a[k] ?? 0) - (b[k] ?? 0)) / scale)
        absSum += d
        perKey[k] = (perKey[k] ?? 0) + d
        const thr = k === "fit" ? 2 : 0.5
        if ((a[k]! >= thr) === (b[k]! >= thr)) agree++
      }
    }
    const mad = compared ? absSum / (compared * KEYS.length) : 1
    const agreePct = compared ? agree / (compared * KEYS.length) : 0

    // Shortlist örtüşmesi: asıl önemli olan sıralama
    const scoreOf = (p: Record<string, number> | null) => (p ? stage1Verdict(p).score : -1)
    const topN = Math.max(1, Math.ceil(items.length * 0.05))
    const idx = (arr: (Record<string, number> | null)[]) =>
      new Set(arr.map((p, i) => [i, scoreOf(p)] as const).sort((x, y) => y[1] - x[1]).slice(0, topN).map(([i]) => i))
    const sa = idx(base), sb = idx(flat)
    const overlap = [...sa].filter((i) => sb.has(i)).length / topN

    const speedup = singleMs / ms
    const costRatio = meter.inputTokens / (single.inputTokens || 1)
    console.log(
      `  ${String(size).padStart(2)} item/çağrı: ${String(ms).padStart(6)} ms (${speedup.toFixed(1)}x) · ` +
      `${String(meter.calls).padStart(3)} çağrı · $${meter.usd.toFixed(4)} (${(costRatio * 100).toFixed(0)}%) · ` +
      `uyum ${(agreePct * 100).toFixed(1)}% · MAD ${mad.toFixed(3)} · shortlist örtüşme ${(overlap * 100).toFixed(0)}% · parse hata ${parseFail}`,
    )
    rows.push(`| ${size} | ${ms} ms | ${speedup.toFixed(1)}x | ${meter.calls} | $${meter.usd.toFixed(4)} | ${(agreePct * 100).toFixed(1)}% | ${mad.toFixed(3)} | ${(overlap * 100).toFixed(0)}% | ${parseFail} |`)
  }

  writeFileSync(fromRoot("docs/batch-bench.md"), [
    `# Stage 1 batching benchmark`,
    ``,
    `Tarih: ${new Date().toISOString()} · ${items.length} item`,
    ``,
    `Referans (tek tek): **${singleMs} ms**, ${single.calls} çağrı, $${single.usd.toFixed(4)}`,
    ``,
    `| item/çağrı | süre | hızlanma | çağrı | maliyet | karar uyumu | MAD | shortlist örtüşme | parse hata |`,
    `|---:|---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...rows,
    ``,
    `**Karar ölçütü:** shortlist örtüşmesi ≥ %90 ve karar uyumu ≥ %95 olmadan benimsenmez —`,
    `hız uğruna sıralama bozulursa ürünün tek gerçek metriği (precision@top-k) çöker.`,
    ``,
  ].join("\n"))
  console.log(`\nRapor: docs/batch-bench.md\n`)
}
