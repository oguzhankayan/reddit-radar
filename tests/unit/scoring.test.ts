import { describe, it, expect } from "vitest"
import { opportunityScore, scoreWithBreakdown, PRESET_WEIGHTS } from "../../packages/scoring/src/opportunity.ts"
import { stage1Verdict, shortlist } from "../../packages/classifiers/src/stage1.ts"
import { mergeClusters } from "../../packages/llm/src/synthesis.ts"

describe("opportunityScore — preset'e özel ağırlıklar", () => {
  it("her sinyal sıfırsa 0", () => {
    expect(opportunityScore({}, "saas_opportunities")).toBe(0)
  })

  it("saas_opportunities tam sinyalde 100", () => {
    expect(opportunityScore({
      pain_severity: 3, repeated_need: 1, switching_intent: 1,
      solution_dissatisfaction: 1, workaround_present: 1, willingness_to_pay_signal: 1,
    }, "saas_opportunities")).toBe(100)
  })

  it("geo_seo KENDİ sinyallerini kullanır, acıya bakmaz", () => {
    // Ölçülen hata: geo_seo'nun asıl sinyalleri skora hiç girmiyordu ve
    // pain_severity doğal olarak sıfır olduğu için skorlar 11-27'ye çöküyordu.
    const geo = { commercial_question: 1, answer_would_help_others: 1, names_category: 1, repeated_need: 1 }
    expect(opportunityScore(geo, "geo_seo_opportunities")).toBe(100)
    // Acı sinyali bu preset'te hiç kullanılmaz:
    expect(scoreWithBreakdown({ ...geo, pain_severity: 0 }, "geo_seo_opportunities").signalsUsed)
      .not.toContain("pain_severity")
  })

  it("aynı olasılıklar farklı preset'lerde farklı skor verir", () => {
    const p = { pain_severity: 0, repeated_need: 1, commercial_question: 1, answer_would_help_others: 1, names_category: 1 }
    expect(opportunityScore(p, "geo_seo_opportunities")).toBeGreaterThan(opportunityScore(p, "saas_opportunities"))
  })

  it("ordinal sinyaller 0-3'ten normalize edilir", () => {
    expect(opportunityScore({ pain_severity: 1.5 }, "saas_opportunities")).toBe(50)
    expect(opportunityScore({ intent_strength: 3 }, "buyer_intent")).toBe(100)
  })

  it("eksik sinyaller skoru sakatlamaz — ağırlık yeniden normalize edilir", () => {
    const b = scoreWithBreakdown({ pain_severity: 3, repeated_need: 1 }, "competitor_complaints")
    expect(b.score).toBe(100)
    expect(b.signalCoverage).toBeLessThan(1)
  })

  it("signalCoverage VERİ kapsaması değildir — yalnız ağırlık payı", () => {
    const b = scoreWithBreakdown({ commercial_question: 1 }, "geo_seo_opportunities")
    expect(b.signalCoverage).toBeCloseTo(0.35, 2)
    expect(b.score).toBe(100) // tek sinyal ama tam → skor 100
  })

  it("bilinmeyen preset saas tablosuna düşer, patlamaz", () => {
    expect(() => opportunityScore({ pain_severity: 3 }, "yok" as any)).not.toThrow()
  })
})

describe("stage1Verdict — tek dereceli skor", () => {
  it("fit 0-4'ten 0-1'e normalize edilir", () => {
    expect(stage1Verdict({ fit: 4, disqualified: 0 }).score).toBe(1)
    expect(stage1Verdict({ fit: 2, disqualified: 0 }).score).toBe(0.5)
    expect(stage1Verdict({ fit: 0, disqualified: 0 }).score).toBe(0)
  })

  it("promosyon kapısı bloklar", () => {
    expect(stage1Verdict({ fit: 4, disqualified: 0.9 }).blocked).toBe(true)
    expect(stage1Verdict({ fit: 4, disqualified: 0.1 }).blocked).toBe(false)
  })

  it("cevap yoksa güvenli tarafta kalır", () => {
    expect(stage1Verdict({}).blocked).toBe(true)
    expect(stage1Verdict({}).score).toBe(0)
  })

  it("KONUDAN BAĞIMSIZ sinyal alakasız postu TAŞIYAMAZ", () => {
    // Eski ağırlıklı toplamın hatası: problem 0.10 + persona 0.07 olan bir post,
    // concrete_detail 0.95 ve intent 2.99 sayesinde 0.53 alıp birinci oluyordu.
    // Tek fit skorunda böyle bir kaçış yolu yok.
    expect(stage1Verdict({ fit: 0, disqualified: 0 }).score).toBe(0)
    expect(stage1Verdict({ fit: 1, disqualified: 0 }).score).toBe(0.25)
  })
})

describe("shortlist — kapı, taban, kota", () => {
  const mk = (fit: number, blocked = false) => ({ v: { blocked, score: fit / 4, fit } })

  it("fit tabanının altını eler (havuzda hiçbir şey yoksa kota doldurmaz)", () => {
    const rows = [mk(0), mk(1), mk(1)]
    expect(shortlist(rows, (r) => r.v, 10)).toHaveLength(0)
  })

  it("tabanı geçenleri fit sırasına göre döndürür", () => {
    const rows = [mk(2), mk(4), mk(3)]
    expect(shortlist(rows, (r) => r.v, 10).map((r) => r.v.fit)).toEqual([4, 3, 2])
  })

  it("kotadan fazlasını döndürmez", () => {
    expect(shortlist([mk(4), mk(4), mk(4)], (r) => r.v, 2)).toHaveLength(2)
  })

  it("bloklananı fit 4 olsa bile almaz", () => {
    expect(shortlist([mk(4, true)], (r) => r.v, 10)).toHaveLength(0)
  })

  it("verdict'i olmayan item atlanır", () => {
    const rows = [{ v: undefined }, mk(4)]
    expect(shortlist(rows as any, (r: any) => r.v, 10)).toHaveLength(1)
  })
})

describe("mergeClusters", () => {
  it("benzer isimli kümeleri birleştirir ve üyeleri toplar", () => {
    const merged = mergeClusters([
      { cluster_name: "Klaviyo pricing too high", member_ids: ["a", "b"], summary: "s", common_pattern: "p" },
      { cluster_name: "Klaviyo pricing is too high", member_ids: ["b", "c"], summary: "s", common_pattern: "p" },
      { cluster_name: "Onboarding is confusing", member_ids: ["d"], summary: "s", common_pattern: "p" },
    ])
    expect(merged).toHaveLength(2)
    expect(merged[0]!.member_ids.sort()).toEqual(["a", "b", "c"])
  })

  it("üye sayısına göre sıralar", () => {
    const merged = mergeClusters([
      { cluster_name: "az", member_ids: ["a"], summary: "s", common_pattern: "p" },
      { cluster_name: "cok", member_ids: ["b", "c", "d"], summary: "s", common_pattern: "p" },
    ])
    expect(merged[0]!.cluster_name).toBe("cok")
  })
})

