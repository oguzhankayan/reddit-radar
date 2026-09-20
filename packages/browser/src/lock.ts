import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { dirname } from "node:path"

/**
 * Tek-instance guard. Playwright aynı userDataDir ile iki instance açamaz;
 * ikinci denemeyi anlaşılır bir hatayla reddediyoruz.
 */
export class ProfileLock {
  #path: string
  #held = false

  constructor(path: string) {
    this.#path = path
  }

  acquire(): void {
    mkdirSync(dirname(this.#path), { recursive: true, mode: 0o700 })
    if (existsSync(this.#path)) {
      const pid = Number.parseInt(readFileSync(this.#path, "utf8").trim(), 10)
      if (Number.isFinite(pid) && pid !== process.pid && isAlive(pid)) {
        throw new Error(
          `Reddit Radar browser profile zaten ${pid} numaralı process tarafından kullanılıyor. ` +
            `Aynı profile ile ikinci bir browser açılamaz.`,
        )
      }
      // Sahipsiz lock (process ölmüş) — devral.
      unlinkSync(this.#path)
    }
    writeFileSync(this.#path, String(process.pid), { mode: 0o600 })
    this.#held = true
  }

  release(): void {
    if (!this.#held) return
    try {
      unlinkSync(this.#path)
    } catch {
      /* zaten yok */
    }
    this.#held = false
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"
  }
}
