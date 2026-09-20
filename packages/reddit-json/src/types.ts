import type { RadarItem } from "../../shared/src/types.ts"

export type Partition = {
  subreddit?: string
  query?: string
  sort: "new" | "top" | "hot" | "relevance"
  timeRange?: "day" | "week" | "month" | "year" | "all"
  targetItems: number
}

export type CollectionPlan = {
  partitions: Partition[]
  targetItems: number
  /** G0: /new.json listing'leri ~1000 item'da tükeniyor → 10 sayfa makul tavan. */
  maxPagesPerPartition?: number
  /** İstekler arası taban aralık. */
  spacingMs?: number
  signal?: AbortSignal
}

/** v2 §16 durma koşulları — hangisinin tetiklendiği raporlanır. */
export type StopReason =
  | "after_null"
  | "after_repeated"
  | "no_new_unique"
  | "target_reached"
  | "max_pages"
  | "aborted"
  | "source_error"
  | "quota_exhausted"

export type PartitionOutcome = {
  partition: Partition
  pages: number
  unique: number
  stoppedBy: StopReason
  error?: string
}

/** v2 §41 coverage metadata. */
export type CollectionStats = {
  requested: number
  collected: number
  rawSeen: number
  duplicates: number
  duplicateRatio: number
  requestCount: number
  /** Cache'ten karşılanan sayfa. Rapor "13 istekte 5000 item" demesin. */
  cacheHits: number
  partitionsCompleted: number
  partitionsFailed: number
  subredditsScanned: string[]
  queriesExecuted: string[]
  failures: Record<string, number>
  stoppedBy: Record<string, number>
  timeRangeObserved?: { from: number; to: number }
  quotaRemaining?: number
  quotaWaits: number
  rateLimitHits: number
  elapsedMs: number
}

export interface RedditSource {
  collect(plan: CollectionPlan): AsyncIterable<RadarItem>
}
