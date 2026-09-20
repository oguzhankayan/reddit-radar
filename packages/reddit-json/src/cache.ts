import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

/** v2 §46: aynı sayfayı tekrar çekme. Kota kıt kaynak olduğu için değerli. */
export class PageCache {
  #dir: string
  #ttlMs: number

  constructor(dir: string, ttlHours = 24) {
    this.#dir = dir
    this.#ttlMs = ttlHours * 3_600_000
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  #path(url: string): string {
    return join(this.#dir, createHash("sha1").update(url).digest("hex") + ".json")
  }

  get(url: string): unknown | null {
    const p = this.#path(url)
    if (!existsSync(p)) return null
    try {
      const { fetchedAt, data } = JSON.parse(readFileSync(p, "utf8"))
      if (Date.now() - fetchedAt > this.#ttlMs) return null
      return data
    } catch {
      return null
    }
  }

  set(url: string, data: unknown): void {
    try {
      writeFileSync(this.#path(url), JSON.stringify({ fetchedAt: Date.now(), data }))
    } catch {
      /* cache best-effort */
    }
  }
}
