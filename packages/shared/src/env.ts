/**
 * Ortam değişkeni okuma — Node ve Workers'da aynı çalışır.
 * Workers'da `process` yoktur; anahtar binding'den açıkça geçilir ve burası
 * yalnız Node tarafı için yedek kalır.
 */
export function envVar(name: string): string | undefined {
  const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return p?.env?.[name]
}
