import { describe, it, expect } from "vitest"
import { isValidScanId, readState, readResults } from "../../apps/mcp/src/store.ts"
import { purgeScanRaw } from "../../packages/core/src/retention.ts"

describe("scan_id doğrulaması — path traversal savunması", () => {
  const evil = ["../../..", "../../../Desktop", "scan_../../x", "/etc/passwd", "scan_a/../../b", "..", ".", "", "scan_" + "a".repeat(100)]

  it("kötü niyetli kimlikleri reddeder", () => {
    for (const id of evil) expect(isValidScanId(id), id).toBe(false)
  })

  it("gerçek kimlikleri kabul eder", () => {
    for (const id of ["scan_mu9n8dvs", "scan_1", "scan_abc123"]) expect(isValidScanId(id), id).toBe(true)
  })

  it("okuma yolları traversal'da null döner, patlamaz", () => {
    for (const id of evil) {
      expect(readState(id)).toBeNull()
      expect(readResults(id)).toBeNull()
    }
  })

  it("purgeScanRaw traversal'da FIRLATIR — sessizce silmez", () => {
    for (const id of ["../../..", "/etc", "a/../../b"]) {
      expect(() => purgeScanRaw(id), id).toThrow(/geçersiz/)
    }
  })
})
