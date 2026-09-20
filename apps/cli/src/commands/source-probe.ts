import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { RadarBrowser } from "../../../../packages/browser/src/browser.ts"
import type { BrowserFetchResult, RedditOrigin } from "../../../../packages/shared/src/types.ts"
import { fromRoot, PROJECT_ROOT } from "../../../../packages/shared/src/paths.ts"

const ROOT = PROJECT_ROOT
const FIXTURES = join(ROOT, "tests/fixtures")
const DOCS = join(ROOT, "docs")

const ORIGINS: RedditOrigin[] = ["https://www.reddit.com", "https://old.reddit.com"]

const ENDPOINTS: { name: string; path: string }[] = [
  { name: "sub_new", path: "/r/SaaS/new.json?limit=100&raw_json=1" },
  { name: "sub_new_2", path: "/r/smallbusiness/new.json?limit=100&raw_json=1" },
  { name: "sub_top", path: "/r/SaaS/top.json?limit=100&t=month&raw_json=1" },
  { name: "global_search", path: "/search.json?q=mailchimp%20alternative&sort=new&t=month&limit=100&raw_json=1" },
  { name: "sub_search", path: "/r/smallbusiness/search.json?q=crm&restrict_sr=on&sort=new&t=year&limit=100&raw_json=1" },
  { name: "user_submitted", path: "/user/spez/submitted.json?limit=100&raw_json=1" },
]

type Row = {
  origin: string
  endpoint: string
  kind: string
  status: number | null
  contentType?: string
  children?: number
  after?: string | null
  ms: number
}

/** Konservatif: aynı anda en fazla 2 istek (plan G0). Rate-limit sınırı aranmaz. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]!)
      await new Promise((r) => setTimeout(r, 1_100))
    }
  })
  await Promise.all(workers)
  return out
}

function summarize(origin: string, endpoint: string, r: BrowserFetchResult<any>): Row {
  const base = { origin: origin.replace("https://", ""), endpoint, ms: r.ms }
  if (r.ok) {
    const kids = r.data?.data?.children
    return {
      ...base,
      kind: "json",
      status: r.status,
      children: Array.isArray(kids) ? kids.length : 0,
      after: r.data?.data?.after ?? null,
    }
  }
  return {
    ...base,
    kind: r.kind,
    status: "status" in r ? r.status : null,
    contentType: "contentType" in r ? r.contentType : undefined,
  }
}

export async function sourceProbe(opts: { headless: boolean; quick?: boolean }): Promise<void> {
  mkdirSync(FIXTURES, { recursive: true })
  mkdirSync(DOCS, { recursive: true })

  console.log(`\nReddit Radar — G0 source probe (headless=${opts.headless})\n`)
  const browser = await RadarBrowser.launch({ headless: opts.headless })
  const lines: string[] = []
  const rows: Row[] = []

  try {
    // 1. Login durumu
    let login = await browser.ensureLogin()
    if (!login.loggedIn) {
      if (opts.quick) {
        console.log("Login yok — logged-out ölçüm yapılıyor.\n")
      } else if (opts.headless) {
        console.log("Login yok ve headless modda interaktif giriş yapılamaz.")
        console.log("Önce şunu çalıştır:  node apps/cli/src/index.ts login\n")
        return
      }
      else {
        console.log("Reddit oturumu açık değil. Açılan browser'da giriş yap; bekliyorum...\n")
        login = await browser.waitForLogin()
      }
    }
    console.log(
      login.loggedIn
        ? `Login ✓  (${login.username}, via ${login.via})\n`
        : `Login ✗  (${login.reason})\n`,
    )

    // 2. Endpoint matrisi: origin × endpoint
    const endpoints = opts.quick ? ENDPOINTS.slice(0, 2) : ENDPOINTS
    const origins = opts.quick ? [ORIGINS[0]!] : ORIGINS
    const jobs = origins.flatMap((o) => endpoints.map((e) => ({ o, e })))
    const results = await mapLimit(jobs, 2, async ({ o, e }) => {
      const r = await browser.fetchJson<any>(o, e.path)
      const row = summarize(o, e.name, r)
      console.log(
        `  ${row.origin.padEnd(16)} ${e.name.padEnd(16)} ${row.kind.padEnd(15)} ` +
          `status=${String(row.status).padEnd(4)} items=${row.children ?? "-"}`,
      )
      if (!r.ok && r.kind === "rate_limited") {
        console.log(`    ↑ 429 — retry-after: ${r.rate.retryAfter ?? "yok"}`)
      }
      if (r.ok) {
        writeFileSync(
          join(FIXTURES, `${row.origin.split(".")[0]}_${e.name}.json`),
          JSON.stringify(r.data, null, 2),
        )
      }
      return { row, ok: r.ok, origin: o, endpoint: e }
    })
    rows.push(...results.map((r) => r.row))

    // 3. Pagination — JSON veren ilk listing üzerinde
    const pagable = opts.quick ? undefined : results.find((r) => r.ok && r.row.children! > 0 && r.row.after)
    let pagination = opts.quick ? "Quick modda atlandı." : "Test edilemedi: JSON veren listing yok."
    if (pagable) {
      const seen = new Set<string>()
      let after: string | null = null
      let url: string
      let pages = 0
      let stopped = "max_pages"
      for (let p = 0; p < 5; p++) {
        url = pagable.endpoint.path + (after ? `&after=${after}` : "")
        const r: BrowserFetchResult<any> = await browser.fetchJson<any>(pagable.origin, url)
        if (!r.ok) {
          stopped = r.kind === "rate_limited" ? `rate_limited(retry-after=${r.rate.retryAfter ?? "yok"})` : r.kind
          break
        }
        pages++
        const kids = r.data?.data?.children ?? []
        const before = seen.size
        for (const c of kids) if (c?.data?.name) seen.add(c.data.name)
        const next: string | null = r.data?.data?.after ?? null
        if (next === null) {
          stopped = "after_null"
          break
        }
        if (next === after) {
          stopped = "after_repeated"
          break
        }
        if (seen.size === before) {
          stopped = "no_new_unique"
          break
        }
        after = next
        await new Promise((r) => setTimeout(r, 1_100))
      }
      pagination = `\`${pagable.origin.replace("https://", "")}${pagable.endpoint.path}\` → **${pages} sayfa**, **${seen.size} unique item**, duruş sebebi: \`${stopped}\``
      console.log(`\n  pagination: ${pages} sayfa / ${seen.size} unique / stop=${stopped}`)
    }

    // 4. Rapor
    const jsonOk = rows.filter((r) => r.kind === "json")
    lines.push(
      `# G0 — Source Report`,
      ``,
      `- Tarih: ${new Date().toISOString()}`,
      `- headless: \`${opts.headless}\``,
      `- Login: ${login.loggedIn ? `✓ \`${login.username}\` (via ${login.via})` : `✗ ${login.reason}`}`,
      ``,
      `## Endpoint matrisi`,
      ``,
      `| origin | endpoint | sonuç | status | items | after | ms |`,
      `|---|---|---|---:|---:|---|---:|`,
      ...rows.map(
        (r) =>
          `| ${r.origin} | ${r.endpoint} | \`${r.kind}\` | ${r.status ?? "-"} | ${r.children ?? "-"} | ${
            r.after === undefined ? "-" : r.after === null ? "null" : "var"
          } | ${r.ms} |`,
      ),
      ``,
      `## Pagination`,
      ``,
      pagination,
      ``,
      `## Kapı değerlendirmesi`,
      ``,
      `- JSON dönen endpoint sayısı: **${jsonOk.length} / ${rows.length}**`,
      `- Toplanan fixture: \`tests/fixtures/\``,
      ``,
    )
    writeFileSync(join(DOCS, `source-report${opts.quick ? "-quick" : ""}${opts.headless ? "-headless" : ""}.md`), lines.join("\n"))
    console.log(`\nRapor: docs/source-report${opts.quick ? "-quick" : ""}${opts.headless ? "-headless" : ""}.md\n`)
  } finally {
    await browser.close()
  }
}
