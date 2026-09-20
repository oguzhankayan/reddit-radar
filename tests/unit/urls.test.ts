import { describe, it, expect } from "vitest"
import { buildListingUrl } from "../../packages/reddit-json/src/urls.ts"

describe("buildListingUrl", () => {
  it("subreddit listing kurar", () => {
    const u = buildListingUrl({ subreddit: "SaaS", sort: "new", targetItems: 100 }, null)
    expect(u).toBe("/r/SaaS/new.json?limit=100&raw_json=1")
  })

  it("after cursor ekler", () => {
    const u = buildListingUrl({ subreddit: "SaaS", sort: "new", targetItems: 100 }, "t3_abc")
    expect(u).toContain("after=t3_abc")
  })

  it("top için zaman aralığı ekler", () => {
    const u = buildListingUrl({ subreddit: "SaaS", sort: "top", timeRange: "month", targetItems: 100 }, null)
    expect(u).toContain("/top.json")
    expect(u).toContain("t=month")
  })

  it("subreddit+query daima restrict_sr kullanır", () => {
    const u = buildListingUrl({ subreddit: "smallbusiness", query: "crm", sort: "relevance", targetItems: 100 }, null)
    expect(u).toContain("/r/smallbusiness/search.json")
    expect(u).toContain("restrict_sr=1")
  })

  it("subreddit'siz query global aramaya gider", () => {
    const u = buildListingUrl({ query: "zendesk alternative", sort: "relevance", targetItems: 600 }, null)
    expect(u).toMatch(/^\/search\.json\?/)
    expect(u).not.toContain("restrict_sr")
  })

  it("aramada sort=relevance ve type=link varsayılan (ölçüm: new 14 item, relevance+year 100)", () => {
    const u = buildListingUrl({ query: "crm", sort: "relevance", targetItems: 100 }, null)
    expect(u).toContain("sort=relevance")
    expect(u).toContain("type=link")
    expect(u).toContain("t=year")
  })

  it("aramada zaman penceresi verilmezse year olur", () => {
    expect(buildListingUrl({ query: "x", sort: "relevance", targetItems: 1 }, null)).toContain("t=year")
    expect(buildListingUrl({ query: "x", sort: "relevance", timeRange: "month", targetItems: 1 }, null)).toContain("t=month")
  })

  it("subreddit de query de yoksa hata verir", () => {
    expect(() => buildListingUrl({ sort: "new", targetItems: 100 }, null)).toThrow()
  })
})
