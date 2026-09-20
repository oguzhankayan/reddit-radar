import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { normalizeListing, normalizePost } from "../../packages/reddit-json/src/normalize.ts"

const listing = JSON.parse(readFileSync("tests/fixtures/listing-sample.json", "utf8"))

describe("normalize", () => {
  it("G0 fixture'ından 100 item çıkarır", () => {
    const items = normalizeListing(listing)
    expect(items).toHaveLength(100)
  })

  it("tüm zorunlu alanları doldurur", () => {
    for (const it of normalizeListing(listing)) {
      expect(it.id).toMatch(/^t3_/)
      expect(it.subreddit).toBeTruthy()
      expect(it.url).toMatch(/^https:\/\/www\.reddit\.com\//)
      expect(typeof it.body).toBe("string")
      expect(it.type).toBe("post")
    }
  })

  it("[deleted] yazarı author alanına sızdırmaz", () => {
    const item = normalizePost({ data: { name: "t3_x", subreddit: "s", author: "[deleted]", selftext: "" } })
    expect(item?.author).toBeUndefined()
  })

  it("name veya subreddit yoksa null döner", () => {
    expect(normalizePost({ data: { subreddit: "s" } })).toBeNull()
    expect(normalizePost({ data: { name: "t3_x" } })).toBeNull()
    expect(normalizePost({})).toBeNull()
  })
})
