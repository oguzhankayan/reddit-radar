import type { PresetName } from "../../classifiers/src/stage2.ts"

/**
 * Opportunity Score (v2 §28).
 *
 * LLM'den "score ver" İSTENMEZ. Atomik kararlar Jev'den gelir, birleştirme
 * burada kodla yapılır.
 *
 * ── Ağırlıklar preset'e ÖZEL ──────────────────────────────────────────────
 * Tek bir ağırlık tablosu bütün preset'lere uygulanıyordu ve bu, SaaS
 * fırsatı dışındaki her preset'i sakatlıyordu. Ölçülen vaka:
 *
 *   geo_seo_opportunities üretiyor : pain_severity, repeated_need,
 *                                    commercial_question, names_category,
 *                                    answer_would_help_others
 *   eski skorlayıcı arıyordu       : pain_severity, repeated_need,
 *                                    switching_intent, solution_dissatisfaction,
 *                                    workaround_present, willingness_to_pay_signal
 *
 * Kesişim iki sinyal. Preset'in ASIL sinyalleri (ticari soru mu, kategori
 * adı geçiyor mu, cevabı çok kişiye yarar mı) skora hiç girmiyordu. Üstelik
 * "İstanbul'da nerede yemek yesem" sorusunda `pain_severity` doğal olarak
 * sıfıra yakın — skorlar 11-27'ye çöktü. Rakamlar yanlış değil, SORU yanlıştı.
 */

/** 0-3 aralığında dönen `score` tipi cevaplar; 0-1'e normalize edilir. */
const ORDINAL = new Set(["pain_severity", "intent_strength"])

export type Weights = Record<string, number>

export const PRESET_WEIGHTS: Record<PresetName, Weights> = {
  // v2 §28'deki orijinal tablo — bu preset için yazılmıştı.
  saas_opportunities: {
    pain_severity: 0.25, repeated_need: 0.20, switching_intent: 0.20,
    solution_dissatisfaction: 0.15, workaround_present: 0.10, willingness_to_pay_signal: 0.10,
  },
  buyer_intent: {
    intent_strength: 0.30, seeking_solution: 0.20, asking_for_recommendation: 0.20,
    evaluating_alternatives: 0.15, budget_discussed: 0.15,
  },
  competitor_complaints: {
    names_a_product: 0.25, switching_intent: 0.30, pain_severity: 0.25, repeated_need: 0.20,
  },
  alternatives: {
    seeking_alternative: 0.35, names_incumbent: 0.25, pain_severity: 0.20, repeated_need: 0.20,
  },
  feature_requests: {
    missing_capability: 0.30, blocking: 0.25, names_a_product: 0.25, repeated_need: 0.20,
  },
  // Acı burada YANLIŞ sinyal: öneri soran kimse acı çekmiyor. Değerli olan
  // sorunun evergreen-ticari olması ve cevabının çok kişiye yaraması.
  geo_seo_opportunities: {
    commercial_question: 0.35, answer_would_help_others: 0.30,
    names_category: 0.20, repeated_need: 0.15,
  },
}

export type Probs = Record<string, number>

export type ScoreBreakdown = {
  score: number
  /** Skora katkı veren sinyaller. */
  signalsUsed: string[]
  /** Beklenen ağırlığın ne kadarının arkasında sinyal vardı. 1.0 = tamamı.
   *  DİKKAT: veri kapsaması DEĞİL — kaç post tarandığıyla ilgisi yok. */
  signalCoverage: number
}

export function scoreWithBreakdown(p: Probs, preset: PresetName = "saas_opportunities"): ScoreBreakdown {
  const weights = PRESET_WEIGHTS[preset] ?? PRESET_WEIGHTS.saas_opportunities
  const present: [string, number, number][] = []
  for (const [key, w] of Object.entries(weights)) {
    const raw = p[key]
    if (typeof raw !== "number") continue
    present.push([key, clamp01(ORDINAL.has(key) ? raw / 3 : raw), w])
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const covered = present.reduce((a, [, , w]) => a + w, 0)
  if (!covered) return { score: 0, signalsUsed: [], signalCoverage: 0 }
  const sum = present.reduce((a, [, v, w]) => a + v * w, 0)
  return {
    score: Math.round((sum / covered) * 100),
    signalsUsed: present.map(([k]) => k),
    signalCoverage: +(covered / total).toFixed(3),
  }
}

export function opportunityScore(p: Probs, preset: PresetName = "saas_opportunities"): number {
  return scoreWithBreakdown(p, preset).score
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
