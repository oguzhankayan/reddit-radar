import type { JevAnswer } from "./client.ts"

/**
 * Jev cevap tiplerini tek bir Decision'a normalize eder.
 *
 * İki incelik, canlı cevaplardan ölçülerek bulundu:
 *
 * 1. `noul` ayrı bir `confidence` alanı DÖNMEZ — dönen olasılık hem değer hem
 *    güven sinyalidir. False kararlarda güven `1 - p` olur; yoksa "kesinlikle
 *    hayır" düşük güven gibi görünürdü.
 *
 * 2. `score` bir indeks DEĞİL, seviyeler üzerindeki **beklenen değerdir**
 *    (ör. probs 0.65/0.21/0.10/0.04 → score 0.53). Bu yüzden etiket
 *    `legend[score]` ile değil, olasılığı en yüksek seviyeyle bulunur.
 */
export type Decision =
  | { kind: "boolean"; value: boolean; confidence: number; raw: number }
  | { kind: "choice"; value: string; confidence: number; probabilities: Record<string, number> }
  | {
      kind: "score"
      /** Seviyeler üzerinde beklenen değer (sürekli). */
      value: number
      /** En olası seviyenin indeksi. */
      level: number
      /** En olası seviyenin etiketi. */
      label?: string
      confidence: number
      probabilities: Record<string, number>
    }

export function toDecision(answer: JevAnswer, threshold = 0.5): Decision {
  if (answer.type === "noul") {
    const p = answer.noul
    const value = p >= threshold
    return { kind: "boolean", value, confidence: value ? p : 1 - p, raw: p }
  }

  if (answer.type === "choice") {
    return {
      kind: "choice",
      value: answer.choice,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
    }
  }

  const probs = answer.probabilities ?? {}
  let level = 0
  let best = -1
  for (const [k, v] of Object.entries(probs)) {
    if (v > best) {
      best = v
      level = Number.parseInt(k, 10)
    }
  }
  return {
    kind: "score",
    value: answer.score,
    level,
    label: answer.legend?.[String(level)],
    confidence: answer.confidence,
    probabilities: probs,
  }
}

/** v2 §43 güven bantları. */
export type ConfidenceBand = "high" | "medium" | "low"
export function band(confidence: number): ConfidenceBand {
  if (confidence >= 0.9) return "high"
  if (confidence >= 0.8) return "medium"
  return "low"
}
