import { describe, it, expect } from "vitest"
import { detectLanguage } from "../../packages/shared/src/detect-language.ts"

describe("detectLanguage — kullanıcı parametre vermek zorunda kalmasın", () => {
  it("aksanlı Türkçeyi yakalar", () => {
    expect(detectLanguage("İstanbuldaki restoranlar hakkında şikayetleri bul")).toBe("tr")
    expect(detectLanguage("SEO hizmeti satabileceğim kişileri bul")).toBe("tr")
  })

  it("aksansız yazılmış Türkçeyi de yakalar", () => {
    expect(detectLanguage("bana SEO arayan insanlar icin postlari bul")).toBe("tr")
  })

  it("İngilizceyi Türkçe sanmaz", () => {
    expect(detectLanguage("Find people who need SEO help and backlinks")).toBeUndefined()
    expect(detectLanguage("Find recurring problems with customer support tools")).toBeUndefined()
  })

  it("tek aksanlı harf yeterli değil (marka adı olabilir)", () => {
    expect(detectLanguage("Find posts about Škoda reliability issues")).toBeUndefined()
  })

  it("diğer dilleri de tanır", () => {
    expect(detectLanguage("Finde Menschen die über SEO Beschwerden haben")).toBe("de")
    expect(detectLanguage("Encontrar personas que buscan clientes sobre SEO")).toBe("es")
  })

  it("çok kısa ya da belirsiz metinde karar vermez", () => {
    expect(detectLanguage("seo")).toBeUndefined()
    expect(detectLanguage("")).toBeUndefined()
  })
})
