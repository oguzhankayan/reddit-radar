import { describe, it, expect } from "vitest"
import { planPartitions } from "../../packages/query-compiler/src/compile.ts"

const plan = {
  topic: "t", domain: "d", preset: "saas_opportunities" as const,
  candidate_subreddits: ["a", "b", "c", "d", "e", "f", "g", "h"],
  search_queries: ["q1", "q2", "q3"],
}

describe("planPartitions — sıralama ürünün isabetini belirliyor", () => {
  it("search partition'ları ÖNCE gelir", () => {
    const p = planPartitions(plan, 5_000)
    const firstListing = p.findIndex((x) => !x.query)
    const lastSearch = p.map((x) => !!x.query).lastIndexOf(true)
    expect(lastSearch).toBeLessThan(firstListing)
  })

  it("global arama ÖNCE, sonra subreddit-scoped, en son listing", () => {
    const p = planPartitions(plan, 5_000)
    const kind = (x: typeof p[number]) => (x.query && !x.subreddit ? 0 : x.query ? 1 : 2)
    const kinds = p.map(kind)
    expect(kinds).toEqual([...kinds].sort((a, b) => a - b))
    expect(kinds[0]).toBe(0)
    expect(kinds.at(-1)).toBe(2)
  })

  it("global aramalar alakaya göre ve yıllık pencerede (ölçüm: new+month 14 item, relevance+year 100)", () => {
    const g = planPartitions(plan, 5_000).filter((x) => x.query && !x.subreddit)
    expect(g.length).toBe(plan.search_queries.length)
    expect(g.every((x) => x.sort === "relevance" && x.timeRange === "year")).toBe(true)
  })

  it("tek sorgu tüm bütçeyi yemez — sorgular çapraz dağılır", () => {
    const p = planPartitions(plan, 5_000).filter((x) => x.query)
    const perQuery = new Map<string, number>()
    for (const x of p) perQuery.set(x.query!, (perQuery.get(x.query!) ?? 0) + 1)
    const counts = [...perQuery.values()]
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
  })

  it("büyük hedefte de search üretir (eski kod sıfır üretiyordu)", () => {
    // Eskiden listingSubs tüm subreddit'leri yiyince searchSubs boş kalıyordu.
    expect(planPartitions(plan, 20_000).filter((x) => x.query).length).toBeGreaterThan(0)
  })

  it("sorgu yoksa yalnız listing üretir", () => {
    const p = planPartitions({ ...plan, search_queries: [] }, 5_000)
    expect(p.every((x) => !x.query)).toBe(true)
    expect(p).toHaveLength(8)
  })

  it("tek sorgu tüm subreddit'leri yemez — scoped aramalar ilk 3 subreddit ile sınırlı", () => {
    const scoped = planPartitions(plan, 5_000).filter((x) => x.query && x.subreddit)
    expect(new Set(scoped.map((x) => x.subreddit)).size).toBeLessThanOrEqual(3)
  })

  it("listing'ler en sonda — konusal olarak rastgele oldukları için yalnız genişlik doldurur", () => {
    const p = planPartitions(plan, 5_000)
    const firstListing = p.findIndex((x) => !x.query)
    expect(p.slice(firstListing).every((x) => !x.query)).toBe(true)
  })
})
