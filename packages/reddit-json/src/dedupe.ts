import { createHash } from "node:crypto"
import type { RadarItem } from "../../shared/src/types.ts"

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim()
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex")

/**
 * v2 §18: birincil anahtar Reddit fullname. Ek katmanlar crosspost ve
 * yeniden paylaşımları yakalar. Near-duplicate V2'ye bırakıldı.
 */
export class Deduper {
  #ids = new Set<string>()
  #urls = new Set<string>()
  #content = new Set<string>()
  #duplicates = 0

  /** true → yeni item. */
  add(item: RadarItem): boolean {
    if (this.#ids.has(item.id)) return this.#dup()

    const url = item.url ? norm(item.url) : ""
    if (url && this.#urls.has(url)) return this.#dup()

    const text = norm(`${item.title ?? ""}\u0000${item.body}`)
    // Sadece başlığı olan link post'larda gövde boş olabilir; çok kısa metni
    // içerik-hash'ine sokmak yanlış pozitif üretir.
    const hash = text.length >= 40 ? sha1(text) : null
    if (hash && this.#content.has(hash)) return this.#dup()

    this.#ids.add(item.id)
    if (url) this.#urls.add(url)
    if (hash) this.#content.add(hash)
    return true
  }

  #dup(): boolean {
    this.#duplicates++
    return false
  }

  get size(): number {
    return this.#ids.size
  }
  get duplicates(): number {
    return this.#duplicates
  }
}
