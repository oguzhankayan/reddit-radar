import { runScan, type ScanPhase } from "../../../../packages/core/src/scan.ts"
import type { PresetName } from "../../../../packages/classifiers/src/stage2.ts"

/** CLI yüzü: v2 §32 terminal çıktısı. Boru hattı packages/core'da. */
export async function scan(opts: { question: string; preset?: PresetName; target: number }): Promise<void> {
  const render = (e: ScanPhase) => {
    switch (e.phase) {
      case "planning": return void console.log("\nPlanning...")
      case "planned":
        console.log(`  konu: ${e.topic}`)
        console.log(`  preset: ${e.preset}`)
        console.log(`  ${e.subreddits} subreddit, ${e.partitions} partition\n\nCollecting...`)
        return
      case "collecting": return void process.stdout.write(`\r  ${e.collected} / ${e.target}   `)
      case "quota_wait": return void console.log(`\n  ⏸  kota: ${e.seconds} sn bekleniyor`)
      case "queued": return void console.log(`  ⏳ browser meşgul, sırada: ${e.ahead}`)
      case "cancelled": return void console.log("\n  iptal edildi\n")
      case "collected":
        console.log(`\r  ${e.collected} unique item (${e.requests} canlı istek${e.cacheHits ? ` + ${e.cacheHits} cache` : ""}, duplicate %${(e.duplicateRatio * 100).toFixed(1)})\n\nStage 1...`)
        return
      case "stage1": return void console.log(`  ${e.matched} matched\n\nStage 2...`)
      case "stage2": return void console.log(`  ${e.highSignal} high signal\n\nSynthesizing...`)
      case "synthesized": return void console.log(`  ${e.clusters} clusters\n`)
    }
  }

  const res = await runScan(opts, { onPhase: render })
  if (!res.ok) return void console.error(`\nTarama başarısız: ${res.reason}\n`)

  const c = res.results.coverage
  console.log("Done.\n")
  console.log(`  ${c.items_collected} toplandı → ${c.stage1_matched} shortlist → ${c.stage2_scored} evidence → ${res.results.clusters.length} cluster`)
  console.log(`  durum: ${res.results.status}${res.results.partial_reason ? ` (${res.results.partial_reason})` : ""} · maliyet: Jev $${res.results.cost.jev_usd} + LLM $${res.results.cost.llm_usd}`)
  console.log(`\n  ${res.dir}/\n`)
  for (const cl of res.results.clusters.slice(0, 5)) {
    console.log(`  ${String(cl.avg_opportunity).padStart(3)}/100 · ${cl.count} evidence · ${cl.cluster_name}`)
  }
  console.log()
}
