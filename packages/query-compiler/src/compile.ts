import { z } from "zod"
import { runStructured, type LlmMeter } from "../../llm/src/deepseek.ts"
import { PRESETS, type PresetName } from "../../classifiers/src/stage2.ts"
import type { Partition } from "../../reddit-json/src/types.ts"

/**
 * ScanPlan — artık yalnız bir konu dizgisi değil, **sayılmış sinyal listeleri**.
 *
 * Neden: Jev bir eşleştirici. `criteria`'ya "gerçek bir problem" gibi soyut bir
 * sıfat verilince tahmin yürütüyor; "şunlardan biri: kendi muhasebesini tutmakta
 * zorlanıyor / vergide geride kalmış / hangi yazılımı kullanacağını soruyor"
 * denince eşleştiriyor. Ölçüldü: soyut kriterlerle G2 kapısı %79-84 precision'da
 * takıldı ve FP'lerin hepsi (kariyer tavsiyesi, listicle, kendi ürününü tanıtma)
 * negative_signals'ta sayılabilecek şeylerdi.
 */
export const ScanPlanSchema = z.object({
  topic: z.string().min(3),
  domain: z.string().min(3),
  preset: z.enum(PRESETS as [PresetName, ...PresetName[]]),
  /** Postta aranan somut durumlar. Kriterlere madde madde derlenir. */
  pain_signals: z.array(z.string().min(8).max(160)).min(3).max(10),
  /** Yazarın kim olması gerektiği. */
  who: z.array(z.string().min(4).max(120)).min(2).max(8),
  /** Diskalifiye eden somut durumlar — TEK güvenlik kapısı bunu kullanır. */
  negative_signals: z.array(z.string().min(6).max(160)).min(2).max(10),
  /**
   * Aranacak içeriğin dili (ISO 639-1) ya da "any".
   *
   * Yalnız `search_queries` ve `candidate_subreddits` bu dile uyar. Kriterler
   * İngilizce KALIR — ölçüldü ki Jev diller arası çalışıyor: İngilizce
   * kriterlerle Türkçe postlar doğru sıralandı (restoran tavsiyesi fit=3.10,
   * ilişki tavsiyesi fit=0.01). Kriterleri çevirmek fayda getirmez, rubriği
   * dil başına yeniden kalibre etme yükü getirir.
   */
  language: z.string().min(2).max(8).default("en"),
  candidate_subreddits: z.array(z.string().regex(/^[A-Za-z0-9_]{2,21}$/)).min(3).max(25),
  search_queries: z.array(z.string().min(2).max(60)).min(0).max(10),
})
export type ScanPlan = z.infer<typeof ScanPlanSchema>

const SYSTEM = `You turn a market-research question into a Reddit collection plan. Return JSON only:
{"topic":"...","domain":"...","preset":"...","pain_signals":[...],"who":[...],"negative_signals":[...],"candidate_subreddits":[...],"search_queries":[...]}

language: the language of the Reddit content to search, as an ISO 639-1 code ("en", "tr", "de"),
or "any". Infer it from the question: if the user asks in a language other than English, or names a
country/city whose discussion happens in another language, prefer that language. When unsure, "en".

topic: the specific subject, as a noun phrase ("choosing or complaining about CRM tools").
Always write topic, who, pain_signals and negative_signals in ENGLISH regardless of \`language\` —
the classifier works cross-lingually and English keeps the rubric consistent.
domain: the broader field the authors are in ("running a small agency"). Must be BROADER than topic.
preset: one of ${PRESETS.join(", ")}.

pain_signals: 4-8 CONCRETE situations a matching post would describe. Each starts with a verb
phrase about the author, e.g. "is comparing two helpdesk products", "complains that their support
tool's pricing jumped", "is drowning in repetitive support tickets". These are matched literally
against post text — vague entries ("has a problem") make the whole scan worse.

who: 2-6 concrete descriptions of the author, e.g. "a founder handling support themselves",
"a small team that outgrew shared inboxes".

negative_signals: 2-5 things that make a post UNUSABLE AS EVIDENCE no matter how well it matches
— this is a hard gate, so keep it NARROW. Only include disqualifiers of kind, not of degree:
the author sells or builds this category, the post is promoting the author's own product, the
post is marketing or an ad, the post is not written by someone with first-hand experience.
Do NOT put topical mismatch here ("not about tools", "general advice", "a listicle") — those are
matters of degree and are handled by ranking. A negative_signal that describes a large share of
ordinary posts will throw away the whole pool.

candidate_subreddits: 8-20 real subreddit names, no "r/" prefix, ordered by relevant volume.
If \`language\` is not "en", prefer subreddits where that language is actually spoken.

search_queries: 0-6 SHORT queries (2-4 words), WRITTEN IN THE \`language\` ABOVE. Reddit search
matches post text literally, so an English query will not find Turkish posts and vice versa.
Long or rare phrases return almost nothing.`

/**
 * Doğal dil → ScanPlan. Zod ile doğrulanır; model uydurursa ok:false döner.
 *
 * `domain` ve `topic` ayrı istenir çünkü Stage 1 ikisini ayrı sorar — G2'de
 * ölçüldü ki tek soruda birleştirmek ya recall'u ya precision'ı yok ediyor.
 */
export async function compileQuery(
  question: string,
  meter?: LlmMeter,
  apiKey?: string,
  /**
   * Dil dayatması. Derleyiciye ÖNCEDEN verilmeli: sorgular derleme anında
   * üretiliyor, sonradan `plan.language` alanını değiştirmek onları
   * değiştirmez. (İlk uygulamam bu hatayı yapıyordu.)
   */
  language?: string,
): Promise<{ ok: true; plan: ScanPlan } | { ok: false; reason: string }> {
  const res = await runStructured<unknown>({
    purpose: "query-compile",
    system: SYSTEM,
    user: language
      ? `${question}\n\n[Zorunlu: language="${language}". search_queries bu dilde yazılacak.]`
      : question,
    maxTokens: 700,
    apiKey,
  }, meter)
  if (!res.ok) return { ok: false, reason: res.reason }

  // Dil dayatıldıysa modelin etiketine güvenme.
  if (language && res.data && typeof res.data === "object") {
    (res.data as { language?: string }).language = language
  }

  const parsed = ScanPlanSchema.safeParse(res.data)
  if (!parsed.success) {
    return { ok: false, reason: `invalid_plan: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ").slice(0, 200)}` }
  }
  return { ok: true, plan: parsed.data }
}

/**
 * Partition planner (v2 §14).
 *
 * G1 ölçümleri planı belirliyor:
 *  - listing derinliği subreddit başına ~930-1000 → omurga listing'ler
 *  - search çok daha zayıf (10-250 item) ve aynı subreddit'te listing'le %47 çakışıyor
 *    → search'ler listelenmeyen subreddit'lere yönlendirilir
 */
/**
 * Partition planner.
 *
 * ── Sıra ve kanal seçimi ölçümle belirlendi ──────────────────────────────
 * 1. **Global arama omurgadır.** `sort=relevance&t=year` ile sorgu başına 100
 *    item, sayfalanabiliyor, ve 67 farklı subreddit'ten konuya isabetli post
 *    getiriyor — elle listelenecek subreddit setinin asla ulaşamayacağı yerlerden.
 * 2. **Subreddit-scoped arama** dar ama temiz: aynı sorguda 11 item, hepsi hedefte.
 * 3. **Listing'ler (`/new`) en sonda.** Konusal olarak rastgele: r/SaaS/new,
 *    "destek araçları" sorusuna "Fiverr'da dolandırıldım" getiriyor. Yalnız
 *    genişlik doldurucu.
 *
 * Collector hedefe ulaşınca durur, bu yüzden sıra doğrudan havuz kalitesidir.
 */
export function planPartitions(plan: ScanPlan, targetItems: number): Partition[] {
  const subs = plan.candidate_subreddits
  const queries = plan.search_queries

  // 1. Global arama: her sorgu, alakaya göre, yıllık pencere.
  const global: Partition[] = queries.map((q) => ({
    query: q, sort: "relevance", timeRange: "year", targetItems: 600,
  }))

  // 2. Subreddit-scoped: en yoğun subreddit'lerde aynı sorgular.
  const scoped: Partition[] = []
  for (let si = 0; si < 3; si++) {
    for (const q of queries) {
      const sub = subs[si]
      if (sub) scoped.push({ subreddit: sub, query: q, sort: "relevance", timeRange: "year", targetItems: 200 })
    }
  }

  // 3. Listing'ler: kalan bütçe için genişlik.
  const listings: Partition[] = subs.map((s) => ({ subreddit: s, sort: "new", targetItems: 1_000 }))

  return [...global, ...scoped, ...listings]
}
