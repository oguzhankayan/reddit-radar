import { writeFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { RadarBrowser } from "../../../../packages/browser/src/browser.ts"
import { RedditJsonBrowserSource } from "../../../../packages/reddit-json/src/collector.ts"
import type { CollectionPlan, Partition } from "../../../../packages/reddit-json/src/types.ts"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

/**
 * G1 demo planı. Query compiler G3'te gelecek; burada amaç collector'ı
 * gerçek çok-partition yükü altında doğrulamak.
 * Duvar raporu: sayfa değil partition artırılır, partition başına ~10 sayfa tavan.
 */
const SUBREDDITS = [
  "SaaS", "smallbusiness", "Entrepreneur", "startups", "marketing",
  "freelance", "webdev", "ecommerce", "consulting", "SEO",
  "EntrepreneurRideAlong", "sweatystartup", "PPC", "CustomerSuccess", "Emailmarketing",
  "socialmedia", "msp", "bigseo", "indiehackers", "digital_marketing",
]

const SEARCHES: Partition[] = [
  { subreddit: "smallbusiness", query: "crm too expensive", sort: "new", timeRange: "year", targetItems: 300 },
  { subreddit: "SaaS", query: "customer support tool", sort: "new", timeRange: "year", targetItems: 300 },
  { subreddit: "Entrepreneur", query: "software alternative", sort: "new", timeRange: "year", targetItems: 300 },
]

export async function collect(target: number, searchesOnly = false): Promise<void> {
  const outDir = fromRoot("tests/fixtures")
  const out = join(outDir, searchesOnly ? "g1-search.ndjson" : "g1-collect.ndjson")
  mkdirSync(outDir, { recursive: true })
  rmSync(out, { force: true })

  const plan: CollectionPlan = {
    partitions: searchesOnly
      ? SEARCHES
      : [
          ...SUBREDDITS.map((s): Partition => ({ subreddit: s, sort: "new", targetItems: 1_000 })),
          ...SEARCHES,
        ],
    targetItems: target,
    maxPagesPerPartition: 10,
    spacingMs: 1_100,
  }

  console.log(`\nG1 collect — hedef ${target} item, ${plan.partitions.length} partition\n`)
  const browser = await RadarBrowser.launch({ headless: false })
  const src = new RedditJsonBrowserSource(browser, {
    onProgress: (e) => {
      if (e.type === "page") {
        process.stdout.write(
          `  ${e.partition.padEnd(34)} s${e.page} +${String(e.newItems).padStart(3)}  ` +
            `toplam=${e.total}${e.quotaRemaining !== undefined ? `  kota=${e.quotaRemaining}` : ""}\n`,
        )
      } else if (e.type === "partition_done") {
        console.log(`    ↳ ${e.outcome.unique} unique / ${e.outcome.pages} sayfa / stop=${e.outcome.stoppedBy}`)
      } else if (e.type === "quota_wait") {
        console.log(`  ⏸  kota bitti, ${e.seconds} sn bekleniyor (pencere yenilenmesi)`)
      } else if (e.type === "rate_limited") {
        console.log(`  ⚠️  429 (deneme ${e.attempt}), ${e.waitSeconds} sn bekleniyor`)
      }
    },
  })

  try {
    let n = 0
    for await (const item of src.collect(plan)) {
      appendFileSync(out, JSON.stringify(item) + "\n")
      n++
    }
    const s = src.stats
    const report = [
      `# G1 — Collection Report`,
      ``,
      `Tarih: ${new Date().toISOString()}`,
      ``,
      `## Coverage metadata (v2 §41)`,
      ``,
      `| alan | değer |`,
      `|---|---:|`,
      `| items_requested | ${s.requested} |`,
      `| items_collected (unique) | **${s.collected}** |`,
      `| raw_seen | ${s.rawSeen} |`,
      `| duplicates | ${s.duplicates} |`,
      `| duplicate_ratio | ${(s.duplicateRatio * 100).toFixed(1)}% |`,
      `| requests (canlı) | ${s.requestCount} |`,
      `| cache hits | ${s.cacheHits} |`,
      `| items / request | ${s.requestCount ? (s.collected / s.requestCount).toFixed(1) : "-"} |`,
      `| partitions_completed | ${s.partitionsCompleted} |`,
      `| partitions_failed | ${s.partitionsFailed} |`,
      `| subreddits_scanned | ${s.subredditsScanned.length} |`,
      `| queries_executed | ${s.queriesExecuted.length} |`,
      `| quota_waits | ${s.quotaWaits} |`,
      `| rate_limit_hits | ${s.rateLimitHits} |`,
      `| elapsed | ${(s.elapsedMs / 1000).toFixed(0)} sn |`,
      ``,
      `time_range_observed: ${
        s.timeRangeObserved
          ? `${new Date(s.timeRangeObserved.from * 1000).toISOString().slice(0, 10)} → ${new Date(s.timeRangeObserved.to * 1000).toISOString().slice(0, 10)}`
          : "-"
      }`,
      ``,
      `## Durma sebepleri`,
      ``,
      ...Object.entries(s.stoppedBy).map(([k, v]) => `- \`${k}\`: ${v} partition`),
      ``,
      `## Hatalar`,
      ``,
      Object.keys(s.failures).length
        ? Object.entries(s.failures).map(([k, v]) => `- \`${k}\`: ${v}`).join("\n")
        : "Yok.",
      ``,
      `## Partition detayı`,
      ``,
      `| partition | sayfa | unique | stop |`,
      `|---|---:|---:|---|`,
      ...src.outcomes.map((o) => {
        const p = o.partition
        const label = p.query ? `r/${p.subreddit} + "${p.query}"` : `r/${p.subreddit}`
        return `| ${label} | ${o.pages} | ${o.unique} | \`${o.stoppedBy}\` |`
      }),
      ``,
    ].join("\n")
    writeFileSync(fromRoot(searchesOnly ? "docs/collection-report-search.md" : "docs/collection-report.md"), report)
    console.log(`\n${n} item → ${out}`)
    console.log(`Rapor: docs/collection-report.md\n`)
  } finally {
    await browser.close()
  }
}
