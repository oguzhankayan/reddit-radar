import { execFileSync } from "node:child_process"
import { fromRoot } from "../../../../packages/shared/src/paths.ts"
import { PLANS, PLAN_NAMES, scansPerMonth, type PlanName } from "../../../../packages/shared/src/plans.ts"

/**
 * API anahtarı yönetimi — sahibin makinesinden, D1'e doğrudan.
 *
 * Bilerek HTTP ucu değil: anahtar kesmek için public bir endpoint açmak,
 * korunması gereken yeni bir saldırı yüzeyi demek. Bu işlem seyrek ve
 * yalnız sahibe ait, o yüzden wrangler üzerinden yapılır.
 *
 * Anahtarın kendisi hiçbir yere yazılmaz — yalnız SHA-256 özeti D1'e girer.
 * Ekranda bir kez görünür; kaybolursa yenisi kesilir (v2 §48).
 */
const DB = "reddit-radar"

function d1(sql: string): any {
  const out = execFileSync(
    "wrangler",
    ["d1", "execute", DB, "--remote", "--json", "--command", sql],
    { cwd: fromRoot("apps/api"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  )
  const json = out.slice(out.indexOf("["))
  return JSON.parse(json)[0]?.results ?? []
}

const esc = (s: string) => s.replace(/'/g, "''")

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

function newKey(): string {
  return "rr_" + [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function keyCommand(argv: string[]): Promise<void> {
  const sub = argv[0]
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }

  if (sub === "create") {
    const email = flag("email")
    const plan = (flag("plan") ?? "starter") as PlanName
    const label = flag("label") ?? "cli"
    if (!email) return usage("--email gerekli")
    if (!PLANS[plan]) return usage(`--plan şunlardan biri olmalı: ${PLAN_NAMES.join(", ")}`)

    const p = PLANS[plan]
    const quota = Number(flag("quota") ?? p.itemQuota)
    const accountId = `acc_${[...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("")}`
    const key = newKey()
    const hash = await sha256(key)

    d1(
      `INSERT INTO accounts (id,email,plan,item_quota) VALUES ('${accountId}','${esc(email)}','${plan}',${quota})
       ON CONFLICT(email) DO UPDATE SET plan='${plan}', item_quota=${quota};` +
      `INSERT INTO api_keys (hash,account_id,label) VALUES ('${hash}',(SELECT id FROM accounts WHERE email='${esc(email)}'),'${esc(label)}');`,
    )

    console.log(`\n  hesap   ${email}`)
    console.log(`  paket   ${p.label}`)
    // Küçük deneme kotalarında "5.000'lik tarama" ölçüsü anlamsız kalıyordu ("≈ 0 tarama").
    const typical = quota < 10_000 ? Math.max(500, Math.round(quota / 2 / 500) * 500) : 5_000
    const n = scansPerMonth({ ...p, itemQuota: quota }, typical)
    console.log(`  kota    ${quota.toLocaleString("tr-TR")} item/ay  ≈ ${n} tarama (${typical.toLocaleString("tr-TR")}'lik)`)
    console.log(`\n  ANAHTAR (bir kez gösterilir, saklayın):\n\n    ${key}\n`)
    console.log(`  Kurulum:\n\n    claude mcp add reddit-radar -e RADAR_API_KEY=${key} -- npx -y reddit-radar\n`)
    return
  }

  if (sub === "list") {
    const rows = d1(
      `SELECT a.email, a.plan, a.item_quota, substr(k.hash,1,10) AS hash_prefix, k.label, k.last_used,
              CASE WHEN k.revoked_at IS NULL THEN 'aktif' ELSE 'iptal' END AS durum,
              COALESCE((SELECT SUM(units) FROM usage_events u
                         WHERE u.account_id = a.id AND u.kind='classified_items'
                           AND u.at >= datetime('now','start of month')), 0) AS used
         FROM api_keys k JOIN accounts a ON a.id = k.account_id
        ORDER BY a.email`,
    )
    if (!rows.length) return void console.log("Anahtar yok.")
    console.log(`\n  ${"e-posta".padEnd(34)} ${"paket".padEnd(9)} ${"kullanım / kota".padEnd(22)} ${"durum".padEnd(7)} ${"anahtar".padEnd(12)} son kullanım`)
    for (const r of rows) {
      const usage = `${Number(r.used).toLocaleString("tr-TR")} / ${Number(r.item_quota).toLocaleString("tr-TR")}`
      console.log(`  ${String(r.email).padEnd(34)} ${String(r.plan).padEnd(9)} ${usage.padEnd(22)} ${String(r.durum).padEnd(7)} ${r.hash_prefix}… ${r.last_used ?? "hiç"}`)
    }
    console.log()
    return
  }

  if (sub === "revoke") {
    const prefix = flag("hash") ?? argv[1]
    if (!prefix || prefix.length < 6) return usage("revoke için anahtar özetinin ilk 10 hanesi gerekli (key list'te görünür)")
    d1(`UPDATE api_keys SET revoked_at = datetime('now') WHERE hash LIKE '${esc(prefix)}%' AND revoked_at IS NULL`)
    console.log(`  ${prefix}… iptal edildi.`)
    return
  }

  usage()
}

function usage(err?: string): void {
  if (err) console.error(`\n  ${err}`)
  console.log(`
  radar key create --email <e-posta> [--plan ${PLAN_NAMES.join("|")}] [--quota N] [--label X]
  radar key list
  radar key revoke <hash-öneki>

  Paketler:`)
  for (const n of PLAN_NAMES) console.log(`    ${n.padEnd(8)} ${PLANS[n].label}`)
  console.log()
}
