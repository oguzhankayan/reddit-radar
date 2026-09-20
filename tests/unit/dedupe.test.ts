import { describe, it, expect } from "vitest"
import { Deduper } from "../../packages/reddit-json/src/dedupe.ts"
import type { RadarItem } from "../../packages/shared/src/types.ts"

const item = (over: Partial<RadarItem> = {}): RadarItem => ({
  id: "t3_a", type: "post", subreddit: "SaaS", body: "x".repeat(80),
  title: "bir başlık", url: "https://www.reddit.com/r/SaaS/comments/a/x/", ...over,
})

describe("Deduper", () => {
  it("aynı id'yi ikinci kez kabul etmez", () => {
    const d = new Deduper()
    expect(d.add(item())).toBe(true)
    expect(d.add(item())).toBe(false)
    expect(d.size).toBe(1)
    expect(d.duplicates).toBe(1)
  })

  it("farklı id ama aynı URL'yi yakalar (crosspost)", () => {
    const d = new Deduper()
    d.add(item())
    expect(d.add(item({ id: "t3_b" }))).toBe(false)
  })

  it("farklı id ve URL ama aynı içeriği yakalar", () => {
    const d = new Deduper()
    d.add(item())
    expect(d.add(item({ id: "t3_b", url: "https://www.reddit.com/r/x/comments/b/y/" }))).toBe(false)
  })

  it("kısa metni içerik-hash'ine sokmaz (yanlış pozitif olmasın)", () => {
    const d = new Deduper()
    d.add(item({ id: "t3_a", title: "hi", body: "", url: "https://a.example/1" }))
    expect(d.add(item({ id: "t3_b", title: "hi", body: "", url: "https://a.example/2" }))).toBe(true)
  })
})
