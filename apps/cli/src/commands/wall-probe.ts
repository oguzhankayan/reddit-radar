import { writeFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { RadarBrowser } from "../../../../packages/browser/src/browser.ts"
import { normalizeListing } from "../../../../packages/reddit-json/src/normalize.ts"
import type { RadarItem, RateInfo } from "../../../../packages/shared/src/types.ts"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"

const ORIGIN = "https://www.reddit.com" as const
const OUT = fromRoot("tests/fixtures/collected.ndjson")

/** Round-robin partition seti — gerçek toplama deseni, boşa istek yok. */
const PARTITIONS = ["SaaS", "smallbusiness", "Entrepreneur", "startups", "marketing"]

/** Basamaklar: aynı deney farklı aralıklarla. Quota mı rate mi ayırt eder. */
const RUNGS = [1_000, 2_500, 5_000]
const MAX_REQ_PER_RUNG = 60
const RECOVERY_POLL_MS = 20_000
const RECOVERY_MAX_MS = 12 * 60_000

type RungResult = {
  spacingMs: number
  successes: number
  newUnique: number
  elapsedMs: number
  hitWall: boolean
  wallRate?: RateInfo
  firstRate?: RateInfo
  recoveryMs?: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function wallProbe(): Promise<void> {
  mkdirSync(fromRoot("tests/fixtures"), { recursive: true })
  rmSync(OUT, { force: true })

  console.log("\nReddit Radar — duvar ölçümü (logged-out, headful)\n")
  const browser = await RadarBrowser.launch({ headless: false })
  const seen = new Set<string>()
  const rungs: RungResult[] = []

  try {
    for (const spacingMs of RUNGS) {
      console.log(`\n── Basamak: ${spacingMs} ms aralık ──`)
      const cursors = new Map<string, string | null>(PARTITIONS.map((p) => [p, null]))
      const started = Date.now()
      let successes = 0
      const uniqueBefore = seen.size
      const r: RungResult = { spacingMs, successes: 0, newUnique: 0, elapsedMs: 0, hitWall: false }

      for (let i = 0; i < MAX_REQ_PER_RUNG; i++) {
        const sub = PARTITIONS[i % PARTITIONS.length]!
        const after = cursors.get(sub)
        const path =
          `/r/${sub}/new.json?limit=100&raw_json=1` + (after ? `&after=${after}` : "")
        const res = await browser.fetchJson<any>(ORIGIN, path)

        if (res.ok) {
          successes++
          if (successes === 1) r.firstRate = res.rate
          const items: RadarItem[] = normalizeListing(res.data)
          let fresh = 0
          for (const it of items) {
            if (!seen.has(it.id)) {
              seen.add(it.id)
              fresh++
              appendFileSync(OUT, JSON.stringify(it) + "\n")
            }
          }
          cursors.set(sub, res.data?.data?.after ?? null)
          process.stdout.write(
            `  #${String(successes).padStart(2)} r/${sub.padEnd(14)} +${String(fresh).padStart(3)} yeni  ` +
              `toplam=${seen.size}  ${res.ms}ms` +
              (res.rate.remaining !== undefined ? `  remaining=${res.rate.remaining}` : "") +
              "\n",
          )
        } else if (res.kind === "rate_limited") {
          r.hitWall = true
          r.wallRate = res.rate
          console.log(
            `\n  ⛔ DUVAR: ${successes} başarılı istekten sonra 429.` +
              `  retry-after=${res.rate.retryAfter ?? "yok"}` +
              `  reset=${res.rate.resetSeconds ?? "yok"}`,
          )
          break
        } else {
          console.log(`  ⚠️  ${res.kind} (status=${"status" in res ? res.status : "-"}) — basamak durduruldu`)
          r.hitWall = true
          break
        }
        await sleep(spacingMs)
      }

      r.successes = successes
      r.newUnique = seen.size - uniqueBefore
      r.elapsedMs = Date.now() - started
      console.log(
        `  → ${successes} istek / ${r.newUnique} yeni unique / ${(r.elapsedMs / 1000).toFixed(0)} sn` +
          (r.hitWall ? "  (duvara çarptı)" : "  (duvar görülmedi, tavana takıldı)"),
      )

      // Toparlanma süresi
      if (r.hitWall) {
        console.log("  toparlanma ölçülüyor...")
        const t0 = Date.now()
        while (Date.now() - t0 < RECOVERY_MAX_MS) {
          await sleep(RECOVERY_POLL_MS)
          const probe = await browser.fetchJson<any>(ORIGIN, `/r/SaaS/new.json?limit=1&raw_json=1`)
          if (probe.ok) {
            r.recoveryMs = Date.now() - t0
            console.log(`  ✓ toparlandı: ${(r.recoveryMs / 1000).toFixed(0)} sn`)
            break
          }
        }
        if (r.recoveryMs === undefined) {
          console.log(`  ✗ ${RECOVERY_MAX_MS / 60000} dk içinde toparlanmadı`)
        }
      }
      rungs.push(r)
    }

    writeReport(rungs, seen.size)
  } finally {
    await browser.close()
  }
}

function writeReport(rungs: RungResult[], totalUnique: number): void {
  const fmt = (v: number | undefined) => (v === undefined ? "-" : String(v))
  const lines = [
    `# Rate-limit duvar raporu (logged-out)`,
    ``,
    `Tarih: ${new Date().toISOString()} · origin: \`www.reddit.com\` · headful · concurrency 1`,
    ``,
    `| aralık | başarılı istek | yeni unique | süre | duvar | retry-after | reset | toparlanma |`,
    `|---:|---:|---:|---:|---|---:|---:|---:|`,
    ...rungs.map(
      (r) =>
        `| ${r.spacingMs} ms | ${r.successes} | ${r.newUnique} | ${(r.elapsedMs / 1000).toFixed(0)} sn | ` +
        `${r.hitWall ? "✓" : "görülmedi"} | ${fmt(r.wallRate?.retryAfter)} | ${fmt(r.wallRate?.resetSeconds)} | ` +
        `${r.recoveryMs ? (r.recoveryMs / 1000).toFixed(0) + " sn" : "-"} |`,
    ),
    ``,
    `Toplam unique item: **${totalUnique}** → \`tests/fixtures/collected.ndjson\``,
    ``,
    `## Yorum`,
    ``,
    interpret(rungs),
    ``,
  ]
  writeFileSync(fromRoot("docs/wall-report.md"), lines.join("\n"))
  console.log(`\nRapor: docs/wall-report.md\n`)
}

function interpret(rungs: RungResult[]): string {
  const walled = rungs.filter((r) => r.hitWall && r.successes > 0)
  if (walled.length < 2) {
    return "Yeterli veri yok: en az iki basamakta duvara çarpılmadı."
  }
  const counts = walled.map((r) => r.successes)
  const spread = Math.max(...counts) - Math.min(...counts)
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length
  if (spread <= Math.max(3, avg * 0.25)) {
    return (
      `Basamaklar arası başarılı istek sayısı yakın (${counts.join(", ")}). Bu **quota-tabanlı** bir limite işaret eder: ` +
      `pencere başına sabit sayıda istek. Yavaşlamak toplam hacmi artırmaz — sadece duvarı geciktirir. ` +
      `Hedef item sayısı bu durumda pencere başına ~${Math.round(avg)} istek × 100 item ile sınırlıdır.`
    )
  }
  return (
    `Aralık büyüdükçe başarılı istek sayısı artıyor (${counts.join(" → ")}). Bu **rate-tabanlı** bir limite işaret eder: ` +
    `daha yavaş giderek daha fazla toplam item toplanabilir. Collector sürdürülebilir aralığı hedeflemeli.`
  )
}
