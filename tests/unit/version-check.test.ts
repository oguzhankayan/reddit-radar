import { describe, it, expect } from "vitest"
import { isOlder } from "../../packages/shared/src/version-check.ts"

describe("isOlder", () => {
  it("yama sürümünü yakalar", () => {
    expect(isOlder("0.1.0", "0.1.2")).toBe(true)
    expect(isOlder("0.1.2", "0.1.0")).toBe(false)
  })
  it("aynı sürümde güncelleme önermez", () => {
    expect(isOlder("0.1.2", "0.1.2")).toBe(false)
  })
  it("minor ve major'ı doğru sıralar", () => {
    expect(isOlder("0.1.9", "0.2.0")).toBe(true)
    expect(isOlder("0.9.9", "1.0.0")).toBe(true)
    expect(isOlder("1.0.0", "0.9.9")).toBe(false)
  })
  it("eksik haneyi sıfır sayar", () => {
    expect(isOlder("1.0", "1.0.1")).toBe(true)
  })
})

describe("checkForUpdate — yarış durumu", () => {
  it("eşzamanlı çağrılar AYNI promise'i paylaşır, null dönmez", async () => {
    // Regresyon: bayrak await'ten önce set edilince ikinci çağrı henüz
    // dolmamış cache'i (null) döndürüyordu ve eski sürüm kendini güncel sanıyordu.
    const mod = await import("../../packages/shared/src/version-check.ts?race=1")
    const a = mod.checkForUpdate("0.0.1")
    const b = mod.checkForUpdate("0.0.1")
    expect(a).toBe(b) // aynı promise nesnesi
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toEqual(rb)
  })

  it("ağ hatasında ürünü bozmaz, null döner", async () => {
    const mod = await import("../../packages/shared/src/version-check.ts?net=1")
    const orig = globalThis.fetch
    globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch
    try {
      expect(await mod.checkForUpdate("0.0.1")).toBeNull()
    } finally {
      globalThis.fetch = orig
    }
  })
})
