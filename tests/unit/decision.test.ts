import { describe, it, expect } from "vitest"
import { toDecision, band } from "../../packages/jev/src/decision.ts"

describe("toDecision — noul", () => {
  it("eşiğin üstünde true, güven = p", () => {
    const d = toDecision({ type: "noul", noul: 0.97 })
    expect(d).toMatchObject({ kind: "boolean", value: true, confidence: 0.97 })
  })

  it("kesin hayır YÜKSEK güvendir, düşük değil", () => {
    const d = toDecision({ type: "noul", noul: 0.02 })
    expect(d.value).toBe(false)
    expect(d.confidence).toBeCloseTo(0.98, 5)
    expect(band(d.confidence)).toBe("high")
  })

  it("kararsız cevap düşük güven bandına düşer", () => {
    expect(band(toDecision({ type: "noul", noul: 0.52 }).confidence)).toBe("low")
  })
})

describe("toDecision — score", () => {
  // Canlı Jev cevabı: score beklenen değer, legend indeksten etikete.
  const answer = {
    type: "score" as const,
    score: 0.53,
    confidence: 0.47,
    legend: { "0": "none", "1": "weak", "2": "medium", "3": "strong" },
    probabilities: { "0": 0.65, "1": 0.21, "2": 0.1, "3": 0.04 },
  }

  it("etiketi legend[score] ile DEĞİL, en olası seviyeyle bulur", () => {
    const d = toDecision(answer)
    expect(d).toMatchObject({ kind: "score", value: 0.53, level: 0, label: "none" })
  })

  it("beklenen değeri olduğu gibi korur", () => {
    expect((toDecision(answer) as any).value).toBe(0.53)
  })

  it("zirve ortadaysa o seviyeyi seçer", () => {
    const d = toDecision({ ...answer, score: 2.1, probabilities: { "0": 0.05, "1": 0.15, "2": 0.6, "3": 0.2 } })
    expect(d).toMatchObject({ level: 2, label: "medium" })
  })
})

describe("toDecision — choice", () => {
  it("seçimi ve olasılık dağılımını taşır", () => {
    const d = toDecision({
      type: "choice",
      choice: "price",
      confidence: 0.54,
      probabilities: { price: 0.62, none: 0.18, complexity: 0.17 },
    })
    expect(d).toMatchObject({ kind: "choice", value: "price", confidence: 0.54 })
    expect(band(d.confidence)).toBe("low")
  })
})
