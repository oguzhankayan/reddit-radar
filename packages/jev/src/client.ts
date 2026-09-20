import { TypeSafeClient } from "@typesafe-ai/sdk"
import { envVar } from "../../shared/src/env.ts"

/**
 * Jev sarmalayıcısı. Sözleşme (prospector/bench/lib/jev.mjs'te kanıtlanmış hâliyle):
 *
 *   1. Asla fırlatmaz — transport hatası, timeout, 429 veya eksik anahtar `ok:false` döner.
 *   2. Asla metin üretmez. Yalnız noul / choice / score.
 *   3. **STATE DÜŞMANDIR.** Reddit metni yalnız `state` içine, uzunluğu sınırlanmış
 *      biçimde girer; asla `instructions`/`criteria` içine interpolate edilmez.
 *      State ne sorulduğunu değiştiremez (v2 §25).
 *   4. Güven eşikleri karara aittir, bu modüle değil.
 */

/** Tek bir post'un state içinde kaplayabileceği en fazla karakter. */
export const POST_CHARS = 1_200
/** Tek istekteki bütün state için tavan (gerçek sınır 32k token; bu güvenli altı). */
export const STATE_CHARS = 24_000
/** typesafe.ai fiyatı 2026-09: $0.042 / 1M girdi token. Çıktı bedava. */
export const USD_PER_M_INPUT = 0.042
/**
 * TypeSafe 1.200 istek/dk (20/sn) veriyor.
 *
 * Ölçüldü: 12 eşzamanlı ile 300 çağrı 90.5 sn sürdü = 3.3 çağrı/sn, yani
 * çağrı başına ~3.6 sn. Limitin altıda birindeyiz. 40 eşzamanlı ≈ 11 çağrı/sn
 * — hâlâ 20/sn'nin güvenli altında, ama Stage 1'i 3.3 kat hızlandırır
 * (5k item: ~25 dk → ~8 dk).
 */
export const DEFAULT_CONCURRENCY = 40

export type NoulQuestion = {
  type: "noul"
  instructions: string
  criteria?: { true: string; false: string }
}
export type ChoiceQuestion = {
  type: "choice"
  instructions: string
  criteria: Record<string, string | null>
}
export type ScoreQuestion = {
  type: "score"
  instructions: string
  criteria: string[]
}
export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }

export type DecideResult =
  | { ok: true; answers: Record<string, JevAnswer>; usage?: { input_tokens?: number }; model?: string }
  | { ok: false; reason: "timeout" | "rate_limited" | "transport" | "no_key" }

/** Çalışan toplam: çağrı, token, dolar. Ölçüm G2'nin asıl çıktısı. */
export class Meter {
  calls = 0
  failed = 0
  inputTokens = 0
  get usd(): number {
    return (this.inputTokens * USD_PER_M_INPUT) / 1_000_000
  }
  get perThousandUsd(): number {
    return this.calls ? (this.usd / this.calls) * 1_000 : 0
  }
}

let client: TypeSafeClient | null = null
/**
 * Node'da anahtar env'den okunur; Workers'da binding'den geldiği için açıkça
 * verilir. SDK sıfır bağımlılıklı ve fetch enjekte edilebilir, ikisinde de çalışır.
 */
const clientFor = (apiKey?: string) => {
  if (apiKey) return new TypeSafeClient({ apiKey, timeout: 20_000 })
  return (client ??= new TypeSafeClient({ timeout: 20_000 }))
}

/** Tek state hakkında bir veya çok soru. Asla fırlatmaz. */
export async function decide(
  args: { state: unknown; questions: Record<string, JevQuestion>; purpose: string; apiKey?: string },
  meter?: Meter,
): Promise<DecideResult> {
  const key = args.apiKey ?? envVar("TYPESAFE_API_KEY")
  if (!key) return { ok: false, reason: "no_key" }

  const state =
    typeof args.state === "string" && args.state.length > STATE_CHARS
      ? `${args.state.slice(0, STATE_CHARS)}…`
      : args.state

  try {
    const result: any = await clientFor(args.apiKey).systemOne({ state, questions: args.questions } as any)
    if (meter) {
      meter.calls++
      meter.inputTokens += result.usage?.input_tokens ?? 0
    }
    return { ok: true, answers: result.answers, usage: result.usage, model: result.model }
  } catch (error: any) {
    if (meter) {
      meter.calls++
      meter.failed++
    }
    const reason =
      error?.name === "APITimeoutError" ? "timeout" : error?.status === 429 ? "rate_limited" : "transport"
    console.warn(`[jev] ${args.purpose}: ${reason} — ${String(error?.message ?? error).slice(0, 160)}`)
    return { ok: false, reason }
  }
}

/** Sınırlı eşzamanlılıkla çalıştır. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        if (signal?.aborted) return
        const index = next++
        results[index] = await worker(items[index]!, index)
      }
    }),
  )
  return results
}
