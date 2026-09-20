import { describe, it, expect, beforeEach } from "vitest"
import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RedditJsonBrowserSource } from "../../packages/reddit-json/src/collector.ts"
import type { RadarBrowser } from "../../packages/browser/src/browser.ts"
import type { BrowserFetchResult } from "../../packages/shared/src/types.ts"
import type { CollectionPlan } from "../../packages/reddit-json/src/types.ts"

/** Belirli bir id aralığından listing üretir. */
function listing(ids: number[], after: string | null) {
  return {
    data: {
      after,
      children: ids.map((n) => ({
        kind: "t3",
        data: {
          name: `t3_${n}`, subreddit: "SaaS", author: "u", title: `başlık ${n}`,
          selftext: `gövde metni ${n} `.repeat(6), created_utc: 1_700_000_000 + n,
          score: n, num_comments: n, permalink: `/r/SaaS/comments/${n}/x/`,
        },
      })),
    },
  }
}

const jsonOk = (data: unknown, remaining = 90, resetSeconds = 0): BrowserFetchResult<any> =>
  ({ ok: true, kind: "json", status: 200, data, ms: 1, rate: { remaining, resetSeconds } }) as any

/** Sıraya konmuş cevapları dönen sahte browser. */
function fakeBrowser(responses: BrowserFetchResult<any>[]) {
  const calls: string[] = []
  let i = 0
  const b = {
    async fetchJson(_o: string, url: string) {
      calls.push(url)
      return responses[Math.min(i++, responses.length - 1)]!
    },
  }
  return { browser: b as unknown as RadarBrowser, calls, count: () => i }
}

const plan = (over: Partial<CollectionPlan> = {}): CollectionPlan => ({
  partitions: [{ subreddit: "SaaS", sort: "new", targetItems: 10_000 }],
  targetItems: 10_000,
  spacingMs: 0,
  ...over,
})

async function drain(src: RedditJsonBrowserSource, p: CollectionPlan) {
  const out = []
  for await (const it of src.collect(p)) out.push(it)
  return out
}

beforeEach(() => {
  rmSync(join(tmpdir(), "radar-test-home"), { recursive: true, force: true })
})

describe("collector — durma koşulları (v2 §16)", () => {
  it("after === null → after_null", async () => {
    const { browser } = fakeBrowser([jsonOk(listing([1, 2, 3], null))])
    const src = new RedditJsonBrowserSource(browser)
    const items = await drain(src, plan())
    expect(items).toHaveLength(3)
    expect(src.outcomes[0]!.stoppedBy).toBe("after_null")
  })

  it("aynı after tekrar gelirse → after_repeated", async () => {
    const { browser } = fakeBrowser([
      jsonOk(listing([1, 2], "t3_same")),
      jsonOk(listing([3, 4], "t3_same")),
    ])
    const src = new RedditJsonBrowserSource(browser)
    await drain(src, plan())
    expect(src.outcomes[0]!.stoppedBy).toBe("after_repeated")
  })

  it("yeni unique gelmezse → no_new_unique", async () => {
    const { browser } = fakeBrowser([
      jsonOk(listing([1, 2], "t3_p1")),
      jsonOk(listing([1, 2], "t3_p2")),
    ])
    const src = new RedditJsonBrowserSource(browser)
    const items = await drain(src, plan())
    expect(items).toHaveLength(2)
    expect(src.outcomes[0]!.stoppedBy).toBe("no_new_unique")
    expect(src.stats.duplicates).toBe(2)
  })

  it("hedefe ulaşınca → target_reached", async () => {
    const { browser } = fakeBrowser([jsonOk(listing([1, 2, 3, 4, 5], "t3_next"))])
    const src = new RedditJsonBrowserSource(browser)
    const items = await drain(src, plan({ targetItems: 3 }))
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(src.outcomes[0]!.stoppedBy).toBe("target_reached")
  })

  it("sayfa tavanına gelince → max_pages", async () => {
    let n = 0
    const b = {
      async fetchJson() {
        n += 10
        return jsonOk(listing([n, n + 1, n + 2], `t3_${n}`))
      },
    } as unknown as RadarBrowser
    const src = new RedditJsonBrowserSource(b)
    await drain(src, plan({ maxPagesPerPartition: 3 }))
    expect(src.outcomes[0]!.pages).toBe(3)
    expect(src.outcomes[0]!.stoppedBy).toBe("max_pages")
  })

  it("abort edilince → aborted", async () => {
    const ac = new AbortController()
    let n = 0
    const b = {
      async fetchJson() {
        if (++n === 2) ac.abort()
        return jsonOk(listing([n * 10, n * 10 + 1], `t3_${n}`))
      },
    } as unknown as RadarBrowser
    const src = new RedditJsonBrowserSource(b)
    await drain(src, plan({ signal: ac.signal, maxPagesPerPartition: 20 }))
    expect(src.outcomes[0]!.stoppedBy).toBe("aborted")
  })

  it("challenge gelirse sessizce 0 dönmez, source_error raporlar", async () => {
    const { browser } = fakeBrowser([
      { ok: false, kind: "challenge", status: 403, contentType: "text/html", ms: 1 } as any,
    ])
    const src = new RedditJsonBrowserSource(browser)
    await drain(src, plan())
    expect(src.outcomes[0]!.stoppedBy).toBe("source_error")
    expect(src.stats.failures.challenge).toBe(1)
    expect(src.stats.partitionsFailed).toBe(1)
  })
})

describe("collector — kota yönetimi (G0 bulgusu)", () => {
  it("reset bilgisi yoksa muhafazakâr varsayılana düşer", async () => {
    const { browser } = fakeBrowser([
      { ok: true, kind: "json", status: 200, data: listing([1], null), ms: 1, rate: { remaining: 1 } } as any,
    ])
    const src = new RedditJsonBrowserSource(browser, { quotaReserve: 4, waitBufferSeconds: 0 })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 200)
    await drain(src, plan({ signal: ac.signal }))
    // 600 sn beklemeye girdi, abort ile kesildi — sessizce devam etmedi.
    expect(src.stats.quotaWaits).toBe(1)
  })

  it("kota eşiğin altına inince bekler ve sayar", async () => {
    const { browser } = fakeBrowser([
      jsonOk(listing([1, 2], "t3_p1"), 2, 0),
      jsonOk(listing([3, 4], null), 90),
    ])
    const src = new RedditJsonBrowserSource(browser, { quotaReserve: 4, waitBufferSeconds: 0 })
    await drain(src, plan())
    expect(src.stats.quotaWaits).toBe(1)
  })

  it("429'da retry-after'a uyar, sonra devam eder", async () => {
    const { browser } = fakeBrowser([
      { ok: false, kind: "rate_limited", status: 429, ms: 1, rate: { retryAfter: 0 } } as any,
      jsonOk(listing([1, 2], null)),
    ])
    const src = new RedditJsonBrowserSource(browser, { waitBufferSeconds: 0 })
    const items = await drain(src, plan())
    expect(src.stats.rateLimitHits).toBe(1)
    expect(items).toHaveLength(2)
  })

  it("429 ısrar ederse quota_exhausted ile durur", async () => {
    const { browser } = fakeBrowser([
      { ok: false, kind: "rate_limited", status: 429, ms: 1, rate: { retryAfter: 0 } } as any,
    ])
    const src = new RedditJsonBrowserSource(browser, { waitBufferSeconds: 0 })
    await drain(src, plan())
    expect(src.outcomes[0]!.stoppedBy).toBe("quota_exhausted")
    expect(src.stats.rateLimitHits).toBeGreaterThan(1)
  })
})

describe("collector — coverage metadata (v2 §41)", () => {
  it("duplicate oranını ve taranan kaynakları raporlar", async () => {
    const { browser } = fakeBrowser([
      jsonOk(listing([1, 2, 3], "t3_p1")),
      jsonOk(listing([2, 3, 4], null)),
    ])
    const src = new RedditJsonBrowserSource(browser)
    await drain(src, plan({
      partitions: [{ subreddit: "SaaS", query: "crm", sort: "new", targetItems: 100 }],
    }))
    const s = src.stats
    expect(s.rawSeen).toBe(6)
    expect(s.collected).toBe(4)
    expect(s.duplicates).toBe(2)
    expect(s.duplicateRatio).toBeCloseTo(0.3333, 3)
    expect(s.subredditsScanned).toEqual(["SaaS"])
    expect(s.queriesExecuted).toEqual(["crm"])
    expect(s.timeRangeObserved).toBeDefined()
  })

  it("birden çok partition'ı sırayla işler", async () => {
    let n = 0
    const b = {
      async fetchJson() {
        n++
        return jsonOk(listing([n * 100, n * 100 + 1], null))
      },
    } as unknown as RadarBrowser
    const src = new RedditJsonBrowserSource(b)
    await drain(src, plan({
      partitions: [
        { subreddit: "a", sort: "new", targetItems: 50 },
        { subreddit: "b", sort: "new", targetItems: 50 },
        { subreddit: "c", sort: "new", targetItems: 50 },
      ],
    }))
    expect(src.outcomes).toHaveLength(3)
    expect(src.stats.partitionsCompleted).toBe(3)
    expect(src.stats.subredditsScanned).toEqual(["a", "b", "c"])
  })
})
