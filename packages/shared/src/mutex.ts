/**
 * Sıraya sokan basit mutex.
 *
 * Gerek sebebi: Playwright aynı userDataDir ile iki instance açamaz. İki
 * `radar_scan` aynı anda gelirse ikincisi lock hatasıyla çöküyordu. Artık
 * sırasını bekliyor ve kullanıcıya "kuyrukta" denebiliyor.
 */
export class Mutex {
  #queue: (() => void)[] = []
  #locked = false

  get locked(): boolean {
    return this.#locked
  }
  get waiting(): number {
    return this.#queue.length
  }

  async acquire(): Promise<() => void> {
    if (this.#locked) await new Promise<void>((resolve) => this.#queue.push(resolve))
    this.#locked = true
    let released = false
    return () => {
      if (released) return
      released = true
      const next = this.#queue.shift()
      if (next) next()
      else this.#locked = false
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/** Browser tek kaynak — toplama fazları bu kilidi paylaşır. */
export const browserMutex = new Mutex()
