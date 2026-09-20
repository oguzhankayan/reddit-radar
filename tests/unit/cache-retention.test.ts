import { describe, it, expect, beforeEach } from "vitest"
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { purgeExpiredCache, RAW_RETENTION_HOURS } from "../../packages/core/src/retention.ts"

const CACHE = join(tmpdir(), "radar-cache-test")

function put(name: string, ageHours: number) {
  mkdirSync(CACHE, { recursive: true })
  const p = join(CACHE, name)
  // Cache gerçek ham içerik tutuyor: tam gövde + kullanıcı adı.
  writeFileSync(p, JSON.stringify({ fetchedAt: 1, data: { data: { children: [{ data: { selftext: "gerçek kullanıcı metni", author: "someone" } }] } } }))
  const t = new Date(Date.now() - ageHours * 3_600_000)
  utimesSync(p, t, t)
  return p
}

beforeEach(() => rmSync(CACHE, { recursive: true, force: true }))

describe("cache saklama politikası", () => {
  it("süresi dolmuş cache sayfasını siler", () => {
    const p = put("eski.json", RAW_RETENTION_HOURS + 2)
    expect(purgeExpiredCache(Date.now(), CACHE).filesRemoved).toBe(1)
    expect(existsSync(p)).toBe(false)
  })

  it("taze cache'e dokunmaz", () => {
    const p = put("yeni.json", 1)
    expect(purgeExpiredCache(Date.now(), CACHE).filesRemoved).toBe(0)
    expect(existsSync(p)).toBe(true)
  })

  it("json olmayan dosyaya dokunmaz", () => {
    mkdirSync(CACHE, { recursive: true })
    const p = join(CACHE, "not-a-page.txt")
    writeFileSync(p, "x")
    utimesSync(p, new Date(0), new Date(0))
    expect(purgeExpiredCache(Date.now(), CACHE).filesRemoved).toBe(0)
    expect(existsSync(p)).toBe(true)
  })

  it("cache dizini yoksa patlamaz", () => {
    expect(purgeExpiredCache(Date.now(), join(tmpdir(), "yok-boyle")).filesRemoved).toBe(0)
  })
})
