import type { Partition } from "./types.ts"

/**
 * Arama URL'i.
 *
 * ── `sort=relevance` ve `t=year` ÖLÇÜMLE seçildi ─────────────────────────
 * Aynı sorgu ("zendesk alternative"), global arama:
 *
 *   sort=new       t=month →  14 item,  after=null
 *   sort=relevance t=month →  13 item,  after=null
 *   sort=relevance t=year  → 100 item,  67 subreddit, after=var (sayfalıyor)
 *
 * G0'da "global search yalnız 10 item döndürüyor" diye ölçüp subreddit-scoped
 * aramaya yaslanmıştım — ama o ölçümü `sort=new&t=month` ile yapmışım. Hata
 * global aramada değil, parametrelerdeydi.
 *
 * `sort=new` tazeliği alakanın önüne koyuyor ve tüm Reddit'te aranınca havuzu
 * konuyla ilgisiz ama yeni postlarla dolduruyor. `type=link` yorumları eler.
 */
export function buildListingUrl(p: Partition, after: string | null): string {
  if (p.query) {
    const sq = new URLSearchParams({
      q: p.query,
      limit: "100",
      raw_json: "1",
      type: "link",
      sort: p.sort === "top" ? "top" : p.sort === "new" ? "new" : "relevance",
      t: p.timeRange ?? "year",
    })
    if (after) sq.set("after", after)
    if (p.subreddit) {
      sq.set("restrict_sr", "1")
      return `/r/${p.subreddit}/search.json?${sq}`
    }
    return `/search.json?${sq}`
  }

  if (!p.subreddit) throw new Error("Partition'da subreddit ya da query olmalı")
  const qs = new URLSearchParams({ limit: "100", raw_json: "1" })
  if (after) qs.set("after", after)
  if (p.sort === "top" && p.timeRange) qs.set("t", p.timeRange)
  const sort = p.sort === "relevance" ? "new" : p.sort
  return `/r/${p.subreddit}/${sort}.json?${qs}`
}

export function describePartition(p: Partition): string {
  const sub = p.subreddit ? `r/${p.subreddit}` : "all"
  return p.query ? `${sub} + "${p.query}"` : `${sub} /${p.sort}`
}
