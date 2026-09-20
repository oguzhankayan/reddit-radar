import type { Env, Account } from "./types.ts"

/**
 * API anahtarı doğrulaması.
 *
 * Anahtarın kendisi ASLA saklanmaz — yalnız SHA-256 özeti (v2 §48). Sızan bir
 * veritabanı dökümü kimsenin hesabını açmaz.
 */
export async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function newApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return "rr_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function authenticate(env: Env, header: string | undefined): Promise<Account | null> {
  const token = header?.match(/^Bearer\s+(rr_[a-f0-9]{48})$/i)?.[1]
  if (!token) return null

  const row = await env.DB.prepare(
    `SELECT a.id, a.email, a.plan, a.item_quota
       FROM api_keys k JOIN accounts a ON a.id = k.account_id
      WHERE k.hash = ? AND k.revoked_at IS NULL`,
  ).bind(await sha256(token)).first<Account>()
  if (!row) return null

  // Son kullanım bilgisi best-effort; isteği bloklamaz.
  env.DB.prepare(`UPDATE api_keys SET last_used = datetime('now') WHERE hash = ?`)
    .bind(await sha256(token)).run().catch(() => {})
  return row
}

/** Ay başına sınıflandırılan item kotası. */
export async function usedThisMonth(env: Env, accountId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(units), 0) AS n FROM usage_events
      WHERE account_id = ? AND kind = 'classified_items' AND at >= datetime('now','start of month')`,
  ).bind(accountId).first<{ n: number }>()
  return row?.n ?? 0
}
