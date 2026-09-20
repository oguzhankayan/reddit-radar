import type { RadarItem } from "../../shared/src/types.ts"
import { envVar } from "../../shared/src/env.ts"

/**
 * Reddit Radar API istemcisi.
 *
 * Kullanıcının TypeSafe/DeepSeek anahtarına ihtiyacı YOK — yalnız RADAR_API_KEY.
 * Reddit toplama hep local kalır (v2 §31); bu istemci normalize edilmiş item'ları
 * yollar ve sınıflandırma/sentez sonucunu geri alır.
 */
export const DEFAULT_BASE = "https://redditradar.creativefactory.tr"

export type ScanStatus =
  | "collecting" | "classifying" | "classifying_stage2" | "synthesizing"
  | "completed" | "partial" | "failed" | "cancelled"

export type ApiError = { error: string; [k: string]: unknown }
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError }

export class RadarClient {
  #base: string
  #key: string

  constructor(opts: { apiKey?: string; baseUrl?: string } = {}) {
    this.#key = opts.apiKey ?? envVar("RADAR_API_KEY") ?? ""
    this.#base = (opts.baseUrl ?? envVar("RADAR_API_URL") ?? DEFAULT_BASE).replace(/\/+$/, "")
  }

  get configured(): boolean {
    return this.#key.length > 0
  }

  async #call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
    if (!this.#key) return { ok: false, status: 0, error: { error: "no_api_key" } }
    try {
      const res = await fetch(`${this.#base}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.#key}`,
          "content-type": "application/json",
          ...(init?.headers ?? {}),
        },
      })
      const body: any = await res.json().catch(() => ({}))
      if (!res.ok) return { ok: false, status: res.status, error: body ?? { error: `http_${res.status}` } }
      return { ok: true, data: body as T }
    } catch (e) {
      return { ok: false, status: 0, error: { error: "network_error", detail: String((e as Error)?.message ?? e) } }
    }
  }

  plan(question: string, language?: string) {
    return this.#call<{ plan: any }>("/v1/plan", { method: "POST", body: JSON.stringify({ question, language }) })
  }

  createScan(question: string, plan: unknown, targetItems: number) {
    return this.#call<{ scan_id: string; status: ScanStatus }>("/v1/scans", {
      method: "POST", body: JSON.stringify({ question, plan, target_items: targetItems }),
    })
  }

  /** Batch sınırı 250 (API'nin kendi sınırı). */
  sendItems(scanId: string, items: RadarItem[]) {
    return this.#call<{ accepted: number; received: number }>(`/v1/scans/${scanId}/items`, {
      method: "POST", body: JSON.stringify({ items }),
    })
  }

  finalize(scanId: string) {
    return this.#call<{ scan_id: string; status: ScanStatus }>(`/v1/scans/${scanId}/finalize`, { method: "POST" })
  }

  status(scanId: string) {
    return this.#call<{ scan_id: string; status: ScanStatus; partial_reason?: string; progress: Record<string, number> }>(`/v1/scans/${scanId}`)
  }

  results(scanId: string, limit = 20) {
    return this.#call<any>(`/v1/scans/${scanId}/results?limit=${limit}`)
  }

  evidence(scanId: string, clusterId: string, limit = 10) {
    return this.#call<any>(`/v1/scans/${scanId}/evidence?cluster_id=${encodeURIComponent(clusterId)}&limit=${limit}`)
  }

  prospects(scanId: string, opts: { limit?: number; maxAgeDays?: number; minOpportunity?: number; subreddit?: string } = {}) {
    const q = new URLSearchParams()
    if (opts.limit) q.set("limit", String(opts.limit))
    if (opts.maxAgeDays !== undefined) q.set("max_age_days", String(opts.maxAgeDays))
    if (opts.minOpportunity !== undefined) q.set("min_opportunity", String(opts.minOpportunity))
    if (opts.subreddit) q.set("subreddit", opts.subreddit)
    return this.#call<any>(`/v1/scans/${scanId}/prospects?${q}`)
  }

  usage() {
    return this.#call<{ plan: string; item_quota: number; used_this_month: number; remaining: number }>("/v1/usage")
  }
}
