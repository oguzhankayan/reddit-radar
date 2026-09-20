/**
 * Tarama süresi tahmini.
 *
 * ÖLÇÜLDÜ (canlı koşular, 2026-09-20):
 *   1.255 item → 54 sn uçtan uca
 *   1.400 item → 84 sn (sınıflandırma 1.190'da, yani toplamayla paralel)
 *   → toplama ~17 item/sn ≈ 1.000 item/dk
 *
 * Darboğaz artık sınıflandırma DEĞİL toplama. Stage 1 batching'den (10 item/çağrı)
 * sonra sınıflandırma 32.5 item/sn'ye çıktı ve item'lar 200'lük batch'ler hâlinde
 * geldikçe kuyrukta paralel işleniyor. Eski formül (`target/200`) batching öncesi
 * ölçüme dayanıyordu ve 4 kat fazla süre söylüyordu.
 *
 * Asıl sürprizi Reddit kotası yapar: pencere başına ~100 istek, pencere ~10 dk.
 * İstek başına 100 item düşer, yani ~9.500 item'da bir 10 dakikalık bekleme gelir.
 */
const ITEMS_PER_REQUEST = 100
const COLLECT_ITEMS_PER_MIN = 1_000
const REQUESTS_PER_WINDOW = 95
const WINDOW_WAIT_MIN = 10
const FINALIZE_MIN = 1.5

export type Estimate = { minutes: number; collectMinutes: number; quotaWaitMinutes: number; note: string }

export function estimateScanMinutes(targetItems: number): Estimate {
  const requests = Math.ceil(targetItems / ITEMS_PER_REQUEST)
  const collect = targetItems / COLLECT_ITEMS_PER_MIN
  const waits = Math.floor(requests / REQUESTS_PER_WINDOW) * WINDOW_WAIT_MIN
  const total = Math.max(1, Math.round(collect + waits + FINALIZE_MIN))
  return {
    minutes: total,
    collectMinutes: Math.round(collect * 10) / 10,
    quotaWaitMinutes: waits,
    note: waits
      ? `${Math.round(collect)} dk toplama + ${waits} dk Reddit kota beklemesi + ~1.5 dk sentez`
      : `${Math.round(collect)} dk toplama + ~1.5 dk sentez`,
  }
}
