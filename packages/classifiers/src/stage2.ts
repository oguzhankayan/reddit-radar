import type { JevQuestion } from "../../jev/src/client.ts"

/** v2 §22 preset'leri. */
export type PresetName =
  | "saas_opportunities" | "buyer_intent" | "competitor_complaints"
  | "alternatives" | "feature_requests" | "geo_seo_opportunities"

/**
 * Stage 2: preset'e göre hedefli semantic kararlar (v2 §21).
 * Stage 1'den farkı: daha pahalı ama çok daha dar bir havuza uygulanıyor.
 * Reddit metni yine yalnız state'e gider.
 */
export function stage2Questions(preset: PresetName, topic: string): Record<string, JevQuestion> {
  const common = {
    pain_severity: {
      type: "score",
      instructions: "How severe is the problem for the author?",
      criteria: ["none", "mild annoyance", "real friction", "blocking or costly"],
    },
    repeated_need: {
      type: "noul",
      instructions: "Does this read as a recurring need rather than a one-off?",
      criteria: { true: "Recurring or ongoing", false: "One-off" },
    },
  } satisfies Record<string, JevQuestion>

  switch (preset) {
    case "saas_opportunities":
      return {
        ...common,
        existing_solution: {
          type: "noul",
          instructions: "Is the author already using a tool or service for this?",
          criteria: { true: "Names or implies a current tool", false: "No current tool" },
        },
        solution_dissatisfaction: {
          type: "noul",
          instructions: "Is the author dissatisfied with their current solution?",
          criteria: { true: "Expresses dissatisfaction", false: "Satisfied or no opinion" },
        },
        workaround_present: {
          type: "noul",
          instructions: "Has the author built a manual workaround (spreadsheets, scripts, manual steps)?",
          criteria: { true: "Describes a workaround", false: "No workaround" },
        },
        switching_intent: {
          type: "noul",
          instructions: "Is the author looking to switch away from what they use now?",
          criteria: { true: "Actively considering a switch", false: "Not switching" },
        },
        willingness_to_pay_signal: {
          type: "noul",
          instructions: "Is there any signal the author would pay to solve this?",
          criteria: { true: "Mentions paying, budget, or worth the cost", false: "No payment signal" },
        },
      }
    case "buyer_intent":
      return {
        ...common,
        seeking_solution: { type: "noul", instructions: "Is the author actively looking for a solution?" },
        asking_for_recommendation: { type: "noul", instructions: "Is the author asking for a product or vendor recommendation?" },
        evaluating_alternatives: { type: "noul", instructions: "Is the author comparing specific options?" },
        budget_discussed: { type: "noul", instructions: "Does the author discuss price or budget?" },
        intent_strength: {
          type: "score",
          instructions: "How strong is the intent to buy or switch?",
          criteria: ["none", "weak", "medium", "strong"],
        },
      }
    case "competitor_complaints":
      return {
        ...common,
        names_a_product: { type: "noul", instructions: "Does the author name a specific product or brand?" },
        complaint_type: {
          type: "choice",
          instructions: "What is the primary complaint?",
          criteria: { price: null, complexity: null, support: null, missing_feature: null, reliability: null, none: null },
        },
        switching_intent: { type: "noul", instructions: "Is the author considering leaving that product?" },
      }
    case "alternatives":
      return {
        ...common,
        seeking_alternative: { type: "noul", instructions: "Is the author looking for an alternative to something they use?" },
        names_incumbent: { type: "noul", instructions: "Does the author name the product they want to replace?" },
        reason_cheaper_or_better: {
          type: "choice",
          instructions: "Why do they want an alternative?",
          criteria: { price: null, features: null, reliability: null, support: null, unclear: null },
        },
      }
    case "feature_requests":
      return {
        ...common,
        names_a_product: { type: "noul", instructions: "Does the author name a specific product?" },
        missing_capability: { type: "noul", instructions: "Does the author describe a capability the product lacks?" },
        blocking: { type: "noul", instructions: "Does the missing capability block their work?" },
      }
    case "geo_seo_opportunities":
      return {
        ...common,
        commercial_question: { type: "noul", instructions: "Is this an evergreen commercial question (best X, X vs Y, what should I use)?" },
        names_category: { type: "noul", instructions: "Does it name a product category someone could rank for?" },
        answer_would_help_others: { type: "noul", instructions: "Would a good answer help many people with the same question?" },
      }
  }
}

export const PRESETS: PresetName[] = [
  "saas_opportunities", "buyer_intent", "competitor_complaints",
  "alternatives", "feature_requests", "geo_seo_opportunities",
]
