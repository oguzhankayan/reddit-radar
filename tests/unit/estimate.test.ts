import { describe, it, expect } from "vitest"
import { estimateScanMinutes } from "../../packages/shared/src/estimate.ts"

describe("estimateScanMinutes — ölçüme dayalı", () => {
  it("1.255 item ~2-3 dk (ölçüm: 54 sn, cache'li)", () => {
    expect(estimateScanMinutes(1_255).minutes).toBeLessThanOrEqual(4)
  })

  it("5.000 item ~7 dk — eski formül 25 dk diyordu", () => {
    const e = estimateScanMinutes(5_000)
    expect(e.minutes).toBeGreaterThanOrEqual(5)
    expect(e.minutes).toBeLessThanOrEqual(9)
  })

  it("kota beklemesi büyük taramada devreye girer", () => {
    expect(estimateScanMinutes(5_000).quotaWaitMinutes).toBe(0)
    expect(estimateScanMinutes(20_000).quotaWaitMinutes).toBeGreaterThan(0)
  })

  it("20.000 item kota beklemeleriyle 40 dk civarı", () => {
    const e = estimateScanMinutes(20_000)
    expect(e.minutes).toBeGreaterThan(30)
    expect(e.minutes).toBeLessThan(60)
  })

  it("asla 1 dakikanın altında söylemez", () => {
    expect(estimateScanMinutes(50).minutes).toBeGreaterThanOrEqual(1)
  })

  it("kota beklemesi varsa açıklamada görünür", () => {
    expect(estimateScanMinutes(20_000).note).toContain("kota")
    expect(estimateScanMinutes(3_000).note).not.toContain("kota")
  })
})
