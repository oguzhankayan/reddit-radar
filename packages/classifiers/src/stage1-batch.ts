import type { JevQuestion } from "../../jev/src/client.ts"
import { sanitizeUntrusted } from "../../shared/src/untrusted.ts"
import { disqualifiedQuestion, fitQuestion, type ResearchSpec } from "./stage1.ts"

/**
 * Stage 1, çağrı başına çok item.
 *
 * Neden: ölçüldü ki Jev tarafındaki tavan ~3.3 çağrı/sn ve eşzamanlılıktan
 * BAĞIMSIZ (12 ve 40 eşzamanlıda aynı). Yani bağlayıcı kısıt token maliyeti
 * değil, çağrı sayısı. 10 item/çağrı duvar saatini ~10 kat düşürür.
 *
 * Bedeli: cross-item contamination riski. Bu yüzden benimsenmeden önce
 * tek-item sonuçlarıyla uyum ölçülür (`radar batch-bench`).
 *
 * Soru anahtarları `i<index>_<kriter>` biçiminde; state'teki her post kendi
 * indeksini taşır, böylece model hangi posta cevap verdiğini şaşırmaz.
 */
export type BatchItem = { id: string; subreddit: string; title: string; body: string }

export function batchState(items: BatchItem[], postChars: number) {
  return {
    posts: items.map((it, i) => ({
      i,
      subreddit: sanitizeUntrusted(it.subreddit),
      title: sanitizeUntrusted(it.title).slice(0, 300),
      body: sanitizeUntrusted(it.body).slice(0, postChars),
    })),
  }
}

export function batchQuestions(n: number, spec: ResearchSpec): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {}
  for (let i = 0; i < n; i++) {
    q[`i${i}_disqualified`] = disqualifiedQuestion(spec, `POST ${i}: `)
    q[`i${i}_fit`] = fitQuestion(spec, `POST ${i}: `)
  }
  return q
}

/** Batch cevabını item başına olasılık haritalarına böler. */
export function splitBatchAnswers(
  answers: Record<string, { type: string; noul?: number; score?: number }>,
  n: number,
): (Record<string, number> | null)[] {
  const out: (Record<string, number> | null)[] = []
  for (let i = 0; i < n; i++) {
    const p: Record<string, number> = {}
    let complete = true
    const dq = answers[`i${i}_disqualified`]
    const fit = answers[`i${i}_fit`]
    if (typeof dq?.noul !== "number" || typeof fit?.score !== "number") complete = false
    else { p.disqualified = dq.noul; p.fit = fit.score }
    out.push(complete ? p : null)
  }
  return out
}
