/** Kaynaktan bağımsız, normalize edilmiş Reddit item'ı (v2 §17). */
export type RadarItem = {
  id: string
  type: "post" | "comment"
  subreddit: string
  author?: string
  title?: string
  body: string
  createdAt?: number
  score?: number
  commentsCount?: number
  url: string
  parentId?: string
}

export type LoginStatus =
  | { loggedIn: true; username: string; via: "api" | "dom" }
  | { loggedIn: false; reason: string }

/**
 * Her fetch sonucu tipli. HTML asla JSON sanılmaz (v1 §10, v2 §47).
 */
export type RateInfo = {
  used?: number
  remaining?: number
  resetSeconds?: number
  retryAfter?: number
}

export type BrowserFetchResult<T> =
  | { ok: true; kind: "json"; status: number; data: T; ms: number; rate: RateInfo }
  | { ok: false; kind: "rate_limited"; status: number; ms: number; rate: RateInfo }
  | { ok: false; kind: "forbidden"; status: number; ms: number }
  | { ok: false; kind: "challenge"; status: number; contentType: string; ms: number }
  | { ok: false; kind: "login_required"; status: number; location?: string; ms: number }
  | { ok: false; kind: "not_json"; status: number; contentType: string; ms: number }
  | { ok: false; kind: "invalid_json"; status: number; ms: number }
  | { ok: false; kind: "http_error"; status: number; ms: number }
  | { ok: false; kind: "network_error"; message: string; ms: number }

export type RedditOrigin = "https://www.reddit.com" | "https://old.reddit.com"
