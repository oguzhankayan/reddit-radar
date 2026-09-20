import { envVar } from "../../shared/src/env.ts"
/**
 * OpenAI-uyumlu LLM istemcisi. Model config'ten gelir; varsayılan `deepseek-flash`.
 * v2 §26: her Reddit item'ı buraya GELMEZ — yalnız query compile, cluster ve synthesis.
 */
/**
 * Değerler modül yüklenirken DEĞİL çağrı anında okunur. Aksi hâlde MCP açılışta
 * `~/.reddit-radar/.env` dosyasını yükleyip `LLM_BASE_URL`/`LLM_MODEL`'i
 * ayarlasa bile modül bunları göremiyordu (import, yükleyiciden önce koşar).
 */
const baseUrl = (): string => envVar("LLM_BASE_URL") ?? "https://api.deepseek.com"
export const defaultModel = (): string => envVar("LLM_MODEL") ?? "deepseek-flash"

/** deepseek-flash fiyatı 2026-09: girdi $0.30/M (cache miss), çıktı $1.20/M. */
const USD_IN_PER_M = 0.3
const USD_OUT_PER_M = 1.2

export class LlmMeter {
  calls = 0
  failed = 0
  inputTokens = 0
  outputTokens = 0
  get usd(): number {
    return (this.inputTokens * USD_IN_PER_M + this.outputTokens * USD_OUT_PER_M) / 1_000_000
  }
}

export type StructuredResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "rate_limited" | "refused" | "unparsable" | "transport" | "no_key"; detail?: string }

export async function runStructured<T>(
  args: { system: string; user: string; model?: string; maxTokens?: number; purpose: string; apiKey?: string },
  meter?: LlmMeter,
): Promise<StructuredResult<T>> {
  const key = args.apiKey ?? envVar("DEEPSEEK_API_KEY")
  if (!key) return { ok: false, reason: "no_key" }
  try {
    const response = await fetch(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model ?? defaultModel(),
        // Ölçüldü: `thinking` varsayılanı enabled ve `reasoning_effort` high.
        // Kısa yapılandırılmış çıktıda düşünmenin faydası yok, bedeli çıktı token'ı —
        // açıkken model bütçeyi düşünmede bitirip `content`'i boş bırakıyor.
        thinking: { type: "disabled" },
        temperature: 0,
        max_tokens: args.maxTokens ?? 1_200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: args.system },
          { role: "user", content: args.user },
        ],
      }),
    })
    const body: any = await response.json().catch(() => null)
    if (!response.ok || !body?.choices?.[0]) {
      if (meter) { meter.calls++; meter.failed++ }
      return {
        ok: false,
        reason: response.status === 429 ? "rate_limited" : "refused",
        detail: `${response.status} ${JSON.stringify(body).slice(0, 200)}`,
      }
    }
    if (meter) {
      meter.calls++
      meter.inputTokens += body.usage?.prompt_tokens ?? 0
      meter.outputTokens += body.usage?.completion_tokens ?? 0
    }
    const raw: string = body.choices[0].message?.content ?? ""
    try {
      return { ok: true, data: JSON.parse(raw) as T }
    } catch {
      return { ok: false, reason: "unparsable", detail: `finish=${body.choices[0].finish_reason} …${raw.slice(-160)}` }
    }
  } catch (error: any) {
    if (meter) { meter.calls++; meter.failed++ }
    return { ok: false, reason: "transport", detail: String(error?.message ?? error).slice(0, 160) }
  }
}
