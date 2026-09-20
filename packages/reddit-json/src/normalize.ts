import type { RadarItem } from "../../shared/src/types.ts"

type Child = { kind?: string; data?: Record<string, any> }

/** Reddit listing child → RadarItem (v2 §17). Şekil G0 fixture'larıyla doğrulandı. */
export function normalizePost(child: Child): RadarItem | null {
  const d = child?.data
  if (!d?.name || !d.subreddit) return null
  return {
    id: d.name,
    type: "post",
    subreddit: d.subreddit,
    author: d.author && d.author !== "[deleted]" ? d.author : undefined,
    title: d.title ?? undefined,
    body: typeof d.selftext === "string" ? d.selftext : "",
    createdAt: typeof d.created_utc === "number" ? d.created_utc : undefined,
    score: typeof d.score === "number" ? d.score : undefined,
    commentsCount: typeof d.num_comments === "number" ? d.num_comments : undefined,
    url: d.permalink ? `https://www.reddit.com${d.permalink}` : (d.url ?? ""),
  }
}

export function normalizeListing(data: any): RadarItem[] {
  const kids: Child[] = data?.data?.children ?? []
  const out: RadarItem[] = []
  for (const c of kids) {
    const item = normalizePost(c)
    if (item) out.push(item)
  }
  return out
}
