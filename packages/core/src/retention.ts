import { readdirSync, existsSync, statSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { RADAR_HOME } from "../../browser/src/browser.ts"

/**
 * Saklama politikası (v2 §34).
 *
 *   ham Reddit metni      → varsayılan 48 saat
 *   sınıflandırma çıktısı → kalır (id + skor, metin yok)
 *   aggregate + evidence  → kalır
 *   reddit URL + ID       → kalır
 *
 * Ham metin ürünün çalışması için gerekli DEĞİL: cluster/evidence üretildikten
 * sonra elimizde kalan şey URL, id, skor ve kısa alıntı. Binlerce yabancının
 * yazdığı tam metni süresiz tutmak gereksiz risk.
 */
export const RAW_RETENTION_HOURS = Number(process.env.RADAR_RAW_RETENTION_HOURS ?? 48)

const RAW_FILES = ["items.ndjson"]

export type PurgeResult = { scansSwept: number; filesRemoved: number; bytesFreed: number }

/**
 * Sayfa cache'i de HAM Reddit metni tutar (tam gövde + kullanıcı adı).
 * Saklama politikasının dışında bırakmak "ham metin 48 saatte silinir"
 * iddiasını yalan yapıyordu: items.ndjson siliniyor, cache her şeyi
 * süresiz saklıyordu. Aynı süreye tabi ve aynı süpürmede temizleniyor.
 */
export function purgeExpiredCache(now = Date.now(), cacheRoot = join(RADAR_HOME, "cache")): PurgeResult {
  const result: PurgeResult = { scansSwept: 0, filesRemoved: 0, bytesFreed: 0 }
  if (!existsSync(cacheRoot)) return result
  const cutoff = now - RAW_RETENTION_HOURS * 3_600_000
  for (const name of readdirSync(cacheRoot)) {
    if (!name.endsWith(".json")) continue
    const p = join(cacheRoot, name)
    const st = statSync(p)
    if (st.mtimeMs > cutoff) continue
    result.bytesFreed += st.size
    rmSync(p, { force: true })
    result.filesRemoved++
  }
  return result
}

/** Ham metin nerede duruyorsa orayı süpürür: scan dizinleri + sayfa cache'i. */
export function purgeAllExpired(now = Date.now()): PurgeResult {
  const a = purgeExpiredRaw(now)
  const b = purgeExpiredCache(now)
  return {
    scansSwept: a.scansSwept + b.scansSwept,
    filesRemoved: a.filesRemoved + b.filesRemoved,
    bytesFreed: a.bytesFreed + b.bytesFreed,
  }
}

/** Süresi dolmuş ham metinleri siler. Her scan başlangıcında çağrılır. */
export function purgeExpiredRaw(now = Date.now(), scansRoot = join(RADAR_HOME, "scans")): PurgeResult {
  const root = scansRoot
  const result: PurgeResult = { scansSwept: 0, filesRemoved: 0, bytesFreed: 0 }
  if (!existsSync(root)) return result

  const cutoff = now - RAW_RETENTION_HOURS * 3_600_000
  for (const id of readdirSync(root)) {
    const dir = join(root, id)
    let swept = false
    for (const name of RAW_FILES) {
      const p = join(dir, name)
      if (!existsSync(p)) continue
      const st = statSync(p)
      if (st.mtimeMs > cutoff) continue
      result.bytesFreed += st.size
      rmSync(p, { force: true })
      writeFileSync(join(dir, `${name}.purged`), JSON.stringify({
        purgedAt: new Date(now).toISOString(),
        reason: `raw text retention ${RAW_RETENTION_HOURS}h`,
        originalBytes: st.size,
      }, null, 2))
      result.filesRemoved++
      swept = true
    }
    if (swept) result.scansSwept++
  }
  return result
}

/** Tek bir taramanın ham metnini hemen siler (kullanıcı isteğiyle). */
export function purgeScanRaw(scanId: string, scansRoot = join(RADAR_HOME, "scans")): PurgeResult {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scanId)) throw new Error(`geçersiz scanId: ${String(scanId).slice(0, 40)}`)
  const dir = join(scansRoot, scanId)
  const result: PurgeResult = { scansSwept: 0, filesRemoved: 0, bytesFreed: 0 }
  if (!existsSync(dir)) return result
  for (const name of RAW_FILES) {
    const p = join(dir, name)
    if (!existsSync(p)) continue
    result.bytesFreed += statSync(p).size
    rmSync(p, { force: true })
    result.filesRemoved++
  }
  if (result.filesRemoved) result.scansSwept = 1
  return result
}
