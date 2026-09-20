import { RadarBrowser } from "../../browser/src/browser.ts"
import { RedditJsonBrowserSource } from "../../reddit-json/src/collector.ts"
import { planPartitions } from "../../query-compiler/src/compile.ts"
import { RadarClient } from "../../radar-client/src/index.ts"
import { browserMutex } from "../../shared/src/mutex.ts"
import type { RadarItem } from "../../shared/src/types.ts"

/**
 * Hosted tarama: toplama LOCAL, zekâ HOSTED.
 *
 * Reddit verisi ancak kullanıcının makinesindeki gerçek tarayıcıdan alınabiliyor
 * (ölçüldü: curl 403, headless 403, headful 200), bu yüzden collector asla
 * sunucuya taşınmaz (v2 §31). Sunucunun işi plan derleme, Jev sınıflandırma,
 * DeepSeek sentez, kullanım ölçümü ve saklama.
 *
 * Kullanıcının TypeSafe/DeepSeek anahtarı olmaz; yalnız RADAR_API_KEY.
 */
const UPLOAD_BATCH = 200

export type HostedPhase =
  | { phase: "planning" }
  | { phase: "planned"; topic: string; preset: string; subreddits: number; partitions: number }
  | { phase: "queued"; ahead: number }
  | { phase: "collecting"; collected: number; target: number; sent: number }
  | { phase: "quota_wait"; seconds: number }
  | { phase: "collected"; collected: number; requests: number; cacheHits: number; duplicateRatio: number }
  | { phase: "finalizing" }
  | { phase: "cancelled" }

export type HostedResult =
  | { ok: true; scanId: string; status: string }
  | { ok: false; scanId?: string; reason: string }

export async function runHostedScan(
  opts: { question: string; target: number; preset?: string; language?: string; signal?: AbortSignal; client?: RadarClient },
  hooks: { onPhase?: (e: HostedPhase) => void } = {},
): Promise<HostedResult> {
  const api = opts.client ?? new RadarClient()
  if (!api.configured) return { ok: false, reason: "no_api_key" }
  const emit = (e: HostedPhase) => hooks.onPhase?.(e)
  const aborted = () => opts.signal?.aborted === true

  emit({ phase: "planning" })
  const planned = await api.plan(opts.question, opts.language)
  if (!planned.ok) return { ok: false, reason: `plan_failed: ${planned.error.error}` }
  const plan = planned.data.plan

  // Çağıran preset dayattıysa derleyicinin seçimini ezer. Bu parametre önceden
  // kabul edilip sessizce yok sayılıyordu — tool sözleşmesi yalan söylüyordu.
  // language artık derleyiciye ÖNCEDEN gidiyor (yukarıda), burada yalnız preset ezilir.
  const effectivePlan = opts.preset ? { ...plan, preset: opts.preset } : plan
  const created = await api.createScan(opts.question, effectivePlan, opts.target)
  if (!created.ok) return { ok: false, reason: `${created.error.error}` }
  const scanId = created.data.scan_id

  const partitions = planPartitions(effectivePlan, opts.target)
  emit({
    phase: "planned", topic: plan.topic, preset: effectivePlan.preset,
    subreddits: plan.candidate_subreddits.length, partitions: partitions.length,
  })

  if (browserMutex.locked) emit({ phase: "queued", ahead: browserMutex.waiting + 1 })
  const release = await browserMutex.acquire()
  let browser: RadarBrowser | undefined
  let buffer: RadarItem[] = []
  let sent = 0
  let stats: any

  const flush = async (): Promise<boolean> => {
    if (!buffer.length) return true
    const res = await api.sendItems(scanId, buffer)
    if (!res.ok) return false
    sent += buffer.length
    buffer = []
    return true
  }

  try {
    browser = await RadarBrowser.launch({ headless: false })
    const src = new RedditJsonBrowserSource(browser, {
      onProgress: (e) => {
        if (e.type === "page") emit({ phase: "collecting", collected: e.total, target: opts.target, sent })
        else if (e.type === "quota_wait") emit({ phase: "quota_wait", seconds: e.seconds })
      },
    })
    for await (const item of src.collect({
      partitions, targetItems: opts.target, maxPagesPerPartition: 10, spacingMs: 1_100, signal: opts.signal,
    })) {
      buffer.push(item)
      if (buffer.length >= UPLOAD_BATCH && !(await flush())) {
        return { ok: false, scanId, reason: "upload_failed" }
      }
    }
    if (!(await flush())) return { ok: false, scanId, reason: "upload_failed" }
    stats = src.stats
  } catch (err) {
    return { ok: false, scanId, reason: `browser_failed: ${String((err as Error)?.message ?? err).slice(0, 200)}` }
  } finally {
    await browser?.close().catch(() => {})
    release()
  }

  if (aborted()) { emit({ phase: "cancelled" }); return { ok: false, scanId, reason: "cancelled" } }
  emit({
    phase: "collected", collected: sent, requests: stats.requestCount,
    cacheHits: stats.cacheHits, duplicateRatio: stats.duplicateRatio,
  })

  emit({ phase: "finalizing" })
  const fin = await api.finalize(scanId)
  if (!fin.ok) return { ok: false, scanId, reason: `finalize_failed: ${fin.error.error}` }
  return { ok: true, scanId, status: fin.data.status }
}
