import { chromium, type BrowserContext, type Page } from "playwright"
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import { ProfileLock } from "./lock.ts"
import type { BrowserFetchResult, LoginStatus, RateInfo, RedditOrigin } from "../../shared/src/types.ts"

export const RADAR_HOME = process.env.RADAR_HOME ?? join(homedir(), ".reddit-radar")
const PROFILE_DIR = join(RADAR_HOME, "browser-profile")
const LOCK_PATH = join(RADAR_HOME, "browser.lock")

/**
 * COOKIE KURALI (v2 §5, §48):
 * Bu modül Reddit session'ını ASLA context.cookies() / context.storageState()
 * ile okumaz, serialize etmez, loglamaz veya dışarı göndermez. Cookie yalnız
 * persistent profile içinde kalır ve sadece page context'inden yapılan
 * fetch(credentials:"include") tarafından kullanılır.
 */
export class RadarBrowser {
  static #instance: RadarBrowser | null = null

  #ctx: BrowserContext
  #lock: ProfileLock
  #pages = new Map<string, Page>()
  #closed = false

  private constructor(ctx: BrowserContext, lock: ProfileLock) {
    this.#ctx = ctx
    this.#lock = lock
  }

  /** Singleton — process ömrü boyunca tek context (v2 §36). */
  static async launch(opts: { headless?: boolean } = {}): Promise<RadarBrowser> {
    if (RadarBrowser.#instance && !RadarBrowser.#instance.#closed) {
      return RadarBrowser.#instance
    }
    const lock = new ProfileLock(LOCK_PATH)
    lock.acquire()
    mkdirSync(PROFILE_DIR, { recursive: true, mode: 0o700 })

    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "chrome",
      headless: opts.headless ?? false,
      viewport: { width: 1280, height: 900 },
      args: ["--disable-blink-features=AutomationControlled"],
    })
    const b = new RadarBrowser(ctx, lock)
    RadarBrowser.#instance = b
    return b
  }

  /** CORS nedeniyle her origin için ayrı page tutulur. */
  async #pageFor(origin: RedditOrigin): Promise<Page> {
    const existing = this.#pages.get(origin)
    if (existing && !existing.isClosed()) return existing
    const page = await this.#ctx.newPage()
    await page.goto(`${origin}/`, { waitUntil: "domcontentloaded", timeout: 45_000 })
    this.#pages.set(origin, page)
    return page
  }

  async ensureLogin(origin: RedditOrigin = "https://www.reddit.com"): Promise<LoginStatus> {
    const res = await this.fetchJson<{ data?: { name?: string } }>(origin, "/api/me.json")
    if (res.ok && res.data?.data?.name) {
      return { loggedIn: true, username: res.data.data.name, via: "api" }
    }
    // DOM fallback (v2 §34)
    const page = await this.#pageFor(origin)
    const name = await page
      .evaluate(() => {
        const el = document.querySelector("[data-testid='user-drawer-button'], #USER_DROPDOWN_ID, .user a")
        return el?.textContent?.trim() ?? null
      })
      .catch(() => null)
    if (name && !/log\s*in|sign\s*up/i.test(name)) {
      return { loggedIn: true, username: name, via: "dom" }
    }
    return { loggedIn: false, reason: res.ok ? "no_user_in_api_me" : res.kind }
  }

  /** Interaktif login: kullanıcı elle girer, oturum profile'a yazılır. */
  async waitForLogin(timeoutMs = 300_000): Promise<LoginStatus> {
    const page = await this.#pageFor("https://www.reddit.com")
    await page.bringToFront()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const st = await this.ensureLogin()
      if (st.loggedIn) return st
      await page.waitForTimeout(3_000)
    }
    return { loggedIn: false, reason: "timeout" }
  }

  /**
   * JSON fetch — page context içinden, login session ile (v2 §7).
   * HTML asla JSON sanılmaz; her sonuç tipli döner.
   */
  async fetchJson<T>(origin: RedditOrigin, path: string): Promise<BrowserFetchResult<T>> {
    const page = await this.#pageFor(origin)
    const started = Date.now()
    try {
      const raw = await page.evaluate(async (p: string) => {
        try {
          const res = await fetch(p, {
            credentials: "include",
            headers: { accept: "application/json" },
          })
          const contentType = res.headers.get("content-type") ?? ""
          const text = await res.text()
          return {
            status: res.status,
            finalUrl: res.url,
            contentType,
            retryAfter: res.headers.get("retry-after"),
            rlUsed: res.headers.get("x-ratelimit-used"),
            rlRemaining: res.headers.get("x-ratelimit-remaining"),
            rlReset: res.headers.get("x-ratelimit-reset"),
            body: text.slice(0, 4_000_000),
          }
        } catch (e) {
          return { networkError: String(e) }
        }
      }, path)

      const ms = Date.now() - started
      if ("networkError" in raw) {
        return { ok: false, kind: "network_error", message: String(raw.networkError), ms }
      }

      const { status, contentType, finalUrl, retryAfter } = raw
      const rate: RateInfo = {
        used: toNum(raw.rlUsed ?? null),
        remaining: toNum(raw.rlRemaining ?? null),
        resetSeconds: toNum(raw.rlReset ?? null),
        retryAfter: toNum(retryAfter ?? null),
      }
      const body = raw.body ?? ""
      if (/\/login\/?(\?|$)/.test(finalUrl)) {
        return { ok: false, kind: "login_required", status, location: finalUrl, ms }
      }
      if (status === 429) {
        return { ok: false, kind: "rate_limited", status, ms, rate }
      }
      if (status === 403) {
        return contentType.includes("html")
          ? { ok: false, kind: "challenge", status, contentType, ms }
          : { ok: false, kind: "forbidden", status, ms }
      }
      if (status >= 400) return { ok: false, kind: "http_error", status, ms }
      if (!contentType.includes("json")) {
        return { ok: false, kind: "not_json", status, contentType, ms }
      }
      try {
        return { ok: true, kind: "json", status, data: JSON.parse(body) as T, ms, rate }
      } catch {
        return { ok: false, kind: "invalid_json", status, ms }
      }
    } catch (e) {
      return { ok: false, kind: "network_error", message: String(e), ms: Date.now() - started }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    RadarBrowser.#instance = null
    await this.#ctx.close().catch(() => {})
    this.#lock.release()
  }
}

function toNum(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}
