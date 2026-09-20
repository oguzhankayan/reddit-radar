import { join } from "node:path"
import { RADAR_HOME, type RadarBrowser } from "../../browser/src/browser.ts"
import type { RadarItem } from "../../shared/src/types.ts"
import { normalizeListing } from "./normalize.ts"
import { buildListingUrl, describePartition } from "./urls.ts"
import { Deduper } from "./dedupe.ts"
import { PageCache } from "./cache.ts"
import type {
  CollectionPlan,
  CollectionStats,
  Partition,
  PartitionOutcome,
  RedditSource,
  StopReason,
} from "./types.ts"

const ORIGIN = "https://www.reddit.com" as const
/** Kota bu eşiğin altına inince pencere yenilenene kadar beklenir. */
const QUOTA_RESERVE = 4
const DEFAULT_SPACING_MS = 1_100
const DEFAULT_MAX_PAGES = 12
const MAX_RETRIES = 3

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(t)
      reject(new Error("aborted"))
    }, { once: true })
  })

export type ProgressEvent =
  | { type: "page"; partition: string; page: number; newItems: number; total: number; quotaRemaining?: number }
  | { type: "partition_done"; outcome: PartitionOutcome }
  | { type: "quota_wait"; seconds: number }
  | { type: "rate_limited"; waitSeconds: number; attempt: number }

/**
 * v2 §52: Node fetch kullanmaz, her istek RadarBrowser üzerinden gider.
 * G0 bulgusu: limit quota-tabanlı ve `x-ratelimit-remaining` görünür,
 * bu yüzden 429'a çarpmak yerine önden bekliyoruz.
 */
export class RedditJsonBrowserSource implements RedditSource {
  #browser: RadarBrowser
  #cache: PageCache
  #onProgress?: (e: ProgressEvent) => void
  #stats: CollectionStats = emptyStats()
  #outcomes: PartitionOutcome[] = []

  #quotaReserve: number
  #waitBufferSec: number

  constructor(
    browser: RadarBrowser,
    opts: {
      onProgress?: (e: ProgressEvent) => void
      cacheTtlHours?: number
      /** Kota bu eşiğin altına inince pencere yenilenene kadar beklenir. */
      quotaReserve?: number
      /** Bekleme sürelerine eklenen güvenlik payı (sn). */
      waitBufferSeconds?: number
    } = {},
  ) {
    this.#browser = browser
    this.#cache = new PageCache(join(RADAR_HOME, "cache"), opts.cacheTtlHours ?? 24)
    this.#onProgress = opts.onProgress
    this.#quotaReserve = opts.quotaReserve ?? QUOTA_RESERVE
    this.#waitBufferSec = opts.waitBufferSeconds ?? 5
  }

  get stats(): CollectionStats {
    return this.#stats
  }
  get outcomes(): PartitionOutcome[] {
    return this.#outcomes
  }

  async *collect(plan: CollectionPlan): AsyncIterable<RadarItem> {
    const started = Date.now()
    const dedupe = new Deduper()
    const stats = emptyStats()
    stats.requested = plan.targetItems
    this.#stats = stats
    this.#outcomes = []

    const spacing = plan.spacingMs ?? DEFAULT_SPACING_MS
    const maxPages = plan.maxPagesPerPartition ?? DEFAULT_MAX_PAGES

    for (const partition of plan.partitions) {
      if (dedupe.size >= plan.targetItems) break
      if (plan.signal?.aborted) break

      if (partition.subreddit && !stats.subredditsScanned.includes(partition.subreddit)) {
        stats.subredditsScanned.push(partition.subreddit)
      }
      if (partition.query && !stats.queriesExecuted.includes(partition.query)) {
        stats.queriesExecuted.push(partition.query)
      }

      const label = describePartition(partition)
      let after: string | null = null
      let prevAfter: string | null = null
      let pages = 0
      let partitionUnique = 0
      let stoppedBy: StopReason = "max_pages"
      let error: string | undefined

      for (let page = 0; page < maxPages; page++) {
        if (plan.signal?.aborted) {
          stoppedBy = "aborted"
          break
        }
        if (dedupe.size >= plan.targetItems) {
          stoppedBy = "target_reached"
          break
        }
        if (partitionUnique >= partition.targetItems) {
          stoppedBy = "target_reached"
          break
        }

        const url = buildListingUrl(partition, after)
        let data: any
        let fromCache = false

        const cached = this.#cache.get(url)
        if (cached) {
          data = cached
          fromCache = true
          stats.cacheHits++
        } else {
          const res = await this.#fetchWithQuota(url, plan.signal)
          if (res === "quota_exhausted") {
            stoppedBy = "quota_exhausted"
            break
          }
          if (res === "aborted") {
            stoppedBy = "aborted"
            break
          }
          if (!res.ok) {
            stats.failures[res.kind] = (stats.failures[res.kind] ?? 0) + 1
            stoppedBy = "source_error"
            error = res.kind
            break
          }
          data = res.data
          stats.quotaRemaining = res.rate.remaining ?? stats.quotaRemaining
          this.#cache.set(url, data)
        }

        pages++
        const items = normalizeListing(data)
        stats.rawSeen += items.length
        let fresh = 0
        for (const item of items) {
          if (dedupe.add(item)) {
            fresh++
            partitionUnique++
            observeTime(stats, item)
            yield item
          }
        }

        this.#onProgress?.({
          type: "page",
          partition: label,
          page: pages,
          newItems: fresh,
          total: dedupe.size,
          quotaRemaining: stats.quotaRemaining,
        })

        const next: string | null = data?.data?.after ?? null
        if (next === null) {
          stoppedBy = "after_null"
          break
        }
        if (next === prevAfter || next === after) {
          stoppedBy = "after_repeated"
          break
        }
        if (fresh === 0) {
          stoppedBy = "no_new_unique"
          break
        }
        prevAfter = after
        after = next

        if (!fromCache) {
          try {
            await sleep(spacing, plan.signal)
          } catch {
            stoppedBy = "aborted"
            break
          }
        }
      }

      const outcome: PartitionOutcome = { partition, pages, unique: partitionUnique, stoppedBy, error }
      this.#outcomes.push(outcome)
      stats.stoppedBy[stoppedBy] = (stats.stoppedBy[stoppedBy] ?? 0) + 1
      if (stoppedBy === "source_error") stats.partitionsFailed++
      else stats.partitionsCompleted++
      this.#onProgress?.({ type: "partition_done", outcome })

      if (stoppedBy === "quota_exhausted" || stoppedBy === "aborted") break
    }

    stats.collected = dedupe.size
    stats.duplicates = dedupe.duplicates
    stats.duplicateRatio = stats.rawSeen > 0 ? +(dedupe.duplicates / stats.rawSeen).toFixed(4) : 0
    stats.elapsedMs = Date.now() - started
  }

  /** Kota-farkında fetch: eşiğin altına inince bekler, 429'da retry-after'a uyar. */
  async #fetchWithQuota(url: string, signal?: AbortSignal) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) return "aborted" as const
      const res = await this.#browser.fetchJson<any>(ORIGIN, url)
      this.#stats.requestCount++

      if (res.ok) {
        const remaining = res.rate.remaining
        if (remaining !== undefined && remaining <= this.#quotaReserve) {
          const wait = (res.rate.resetSeconds ?? 600) + this.#waitBufferSec
          this.#stats.quotaWaits++
          this.#onProgress?.({ type: "quota_wait", seconds: wait })
          try {
            await sleep(wait * 1000, signal)
          } catch {
            return "aborted" as const
          }
        }
        return res
      }

      if (res.kind === "rate_limited") {
        this.#stats.rateLimitHits++
        if (attempt === MAX_RETRIES) return "quota_exhausted" as const
        const wait = res.rate.retryAfter ?? res.rate.resetSeconds ?? 60 * (attempt + 1)
        this.#onProgress?.({ type: "rate_limited", waitSeconds: wait, attempt: attempt + 1 })
        try {
          await sleep((wait + this.#waitBufferSec) * 1000, signal)
        } catch {
          return "aborted" as const
        }
        continue
      }

      return res
    }
    return "quota_exhausted" as const
  }
}

function observeTime(stats: CollectionStats, item: RadarItem): void {
  if (item.createdAt === undefined) return
  if (!stats.timeRangeObserved) {
    stats.timeRangeObserved = { from: item.createdAt, to: item.createdAt }
    return
  }
  if (item.createdAt < stats.timeRangeObserved.from) stats.timeRangeObserved.from = item.createdAt
  if (item.createdAt > stats.timeRangeObserved.to) stats.timeRangeObserved.to = item.createdAt
}

function emptyStats(): CollectionStats {
  return {
    requested: 0, collected: 0, rawSeen: 0, duplicates: 0, duplicateRatio: 0,
    requestCount: 0, cacheHits: 0, partitionsCompleted: 0, partitionsFailed: 0,
    subredditsScanned: [], queriesExecuted: [], failures: {}, stoppedBy: {},
    quotaWaits: 0, rateLimitHits: 0, elapsedMs: 0,
  }
}
