import type { JevQuestion } from "../../jev/src/client.ts"

/**
 * Stage 1 rubriği — iki soru.
 *
 * ── Neden ağırlıklı toplam DEĞİL ──────────────────────────────────────────
 * Önceki sürüm beş boyutu ayrı ayrı sorup ağırlıklı topluyordu. Ölçüldü:
 *
 *   "Small MSP in Sydney - Need white label domain registrar"
 *     problem_match   0.10   ← Jev doğru: aradığımız problem değil
 *     persona_match   0.07   ← Jev doğru: SaaS kurucusu değil
 *     concrete_detail 0.95   ← doğru ama KONUDAN BAĞIMSIZ
 *     intent          2.99   ← doğru ama KONUDAN BAĞIMSIZ
 *     → 0.53, top-20'de birinci sıra
 *
 * Jev her soruya doğru cevap verdi; toplam yanlıştı. `concrete_detail` ve
 * `intent` iyi yazılmış hemen her Reddit postu için yüksektir, yani skorun
 * yarısı konuya bakmadan dağıtılıyordu. Bütünsel bir yargıyı boyutlara bölüp
 * toplamak, güçlü ama alakasız alt sinyallerin alakasız postu taşımasına
 * izin veriyor.
 *
 * Doğrusu: tek dereceli soru, tüm spec'i kendi talimatında taşısın ve
 * "bu post bu araştırma için ne kadar iyi" sorusunu bir bütün olarak cevaplasın.
 *
 * ── Neden bir değil iki soru ──────────────────────────────────────────────
 * Diskalifiye, derecelendirmeyle aynı kap değildir: kendi ürününü tanıtan biri
 * "çok uygun" görünüp tek skorlu bir sistemde üste çıkabilir. Ayrıca tek sayı
 * teşhisi öldürür — bu oturumdaki her düzeltme hangi alt skorun bozuk olduğunu
 * görmekten çıktı.
 *
 * Reddit metni kriterlere ASLA girmez; yalnız state'e gider (v2 §25).
 */

export type ResearchSpec = {
  topic: string
  domain: string
  pain_signals: string[]
  who: string[]
  negative_signals: string[]
}

const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n")

/** Tek kavram. "Veya" ile bağlanan evet/hayır soruları evete kayar. */
export function disqualifiedQuestion(spec: ResearchSpec, prefix = ""): JevQuestion {
  return {
    type: "noul",
    instructions: `${prefix}Is this post promoting, selling, or marketing something the author makes or sells?`,
    criteria: {
      true:
        `The post exists to promote the author's own product, service, or content. ` +
        `Being a customer, complaining about a tool, or shopping for one does NOT count.` +
        (spec.negative_signals.length ? `\nAlso treat as promotion:\n${list(spec.negative_signals)}` : ""),
      false: "The author is not promoting anything of their own here.",
    },
  }
}

/**
 * Tek dereceli soru — sıralamanın tamamını taşır.
 *
 * Kademe metinleri uzunluğu niyetle KARIŞTIRMAZ. Tek cümlelik bir post
 * ("Zendesk alternative?") mümkün olan en iyi kanıtlardan biridir; kısa
 * olduğu için daha zayıf değildir.
 */
export function fitQuestion(spec: ResearchSpec, prefix = ""): JevQuestion {
  return {
    type: "score",
    instructions: [
      `${prefix}Someone is researching: "${spec.topic}".`,
      `They want to hear from people like:\n${list(spec.who)}`,
      `Who show signs such as:\n${list(spec.pain_signals)}`,
      "How good is this post as evidence for that research, judged only on what this post says?",
    ].join("\n\n"),
    criteria: [
      "No connection: this post is about something else entirely.",
      "Adjacent, but the author shows no experience or need of their own with this subject.",
      "The author has real first-hand experience with this subject, mentioned in passing.",
      "The author describes their own concrete problem, choice, or complaint about this subject — whether at length or in one line.",
      "The author is openly deciding about it: comparing named options, asking what to use, or saying what made them switch.",
    ],
  }
}

export function stage1Questions(spec: ResearchSpec): Record<string, JevQuestion> {
  return { disqualified: disqualifiedQuestion(spec), fit: fitQuestion(spec) }
}

/** Kapı — ve bilerek sert. */
export const DISQUALIFIED_GATE = 0.5

export type Stage1Verdict = { blocked: boolean; score: number; fit: number }

export function stage1Verdict(p: Record<string, number>): Stage1Verdict {
  const disqualified = p.disqualified ?? 1 // cevap yoksa güvenli taraf
  const fit = p.fit ?? 0
  return { blocked: disqualified > DISQUALIFIED_GATE, score: +(fit / 4).toFixed(3), fit }
}

/**
 * Shortlist: kapıyı geçenleri sırala, kotayı üstten al.
 *
 * `fitFloor` kotadan ayrı ve ikisi de gerekli: kota "en fazla kaç" sorusunun,
 * taban "aday sayılır mı" sorusunun cevabı. Havuzda konuyla ilgili hiçbir şey
 * yoksa yalnız kota olsaydı sistem yine "en iyi 20"yi seçer ve alakasız
 * postları evidence diye sunardı.
 */
export const FIT_FLOOR = 2

export function shortlist<T>(
  rows: T[],
  verdictOf: (r: T) => Stage1Verdict | undefined,
  quota: number,
  fitFloor = FIT_FLOOR,
): T[] {
  return rows
    .filter((r) => { const v = verdictOf(r); return v && !v.blocked && v.fit >= fitFloor })
    .sort((a, b) => verdictOf(b)!.score - verdictOf(a)!.score)
    .slice(0, quota)
}
