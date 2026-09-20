import { describe, it, expect, beforeEach } from "vitest"
import { mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { purgeExpiredRaw, purgeScanRaw, RAW_RETENTION_HOURS } from "../../packages/core/src/retention.ts"

const ROOT = join(tmpdir(), "radar-retention-test", "scans")

function makeScan(id: string, ageHours: number) {
  const dir = join(ROOT, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "items.ndjson"), '{"id":"t3_x","body":"gizli metin"}\n')
  writeFileSync(join(dir, "results.json"), '{"clusters":[]}')
  const t = new Date(Date.now() - ageHours * 3_600_000)
  utimesSync(join(dir, "items.ndjson"), t, t)
  return dir
}

beforeEach(() => rmSync(join(tmpdir(), "radar-retention-test"), { recursive: true, force: true }))

describe("retention (v2 §34)", () => {
  it("süresi dolmuş ham metni siler", () => {
    const dir = makeScan("eski", RAW_RETENTION_HOURS + 5)
    const r = purgeExpiredRaw(Date.now(), ROOT)
    expect(r.filesRemoved).toBe(1)
    expect(existsSync(join(dir, "items.ndjson"))).toBe(false)
  })

  it("taze ham metne dokunmaz", () => {
    const dir = makeScan("yeni", 1)
    expect(purgeExpiredRaw(Date.now(), ROOT).filesRemoved).toBe(0)
    expect(existsSync(join(dir, "items.ndjson"))).toBe(true)
  })

  it("sonuçları ASLA silmez — yalnız ham metin gider", () => {
    const dir = makeScan("eski", RAW_RETENTION_HOURS + 5)
    purgeExpiredRaw(Date.now(), ROOT)
    expect(existsSync(join(dir, "results.json"))).toBe(true)
  })

  it("silindiğine dair iz bırakır (sessizce kaybolmasın)", () => {
    const dir = makeScan("eski", RAW_RETENTION_HOURS + 5)
    purgeExpiredRaw(Date.now(), ROOT)
    expect(existsSync(join(dir, "items.ndjson.purged"))).toBe(true)
  })

  it("tek taramayı istek üzerine hemen siler", () => {
    const dir = makeScan("simdi", 0)
    expect(purgeScanRaw("simdi", ROOT).filesRemoved).toBe(1)
    expect(existsSync(join(dir, "items.ndjson"))).toBe(false)
    expect(existsSync(join(dir, "results.json"))).toBe(true)
  })

  it("olmayan taramada patlamaz", () => {
    expect(purgeScanRaw("yok", ROOT).filesRemoved).toBe(0)
  })
})
