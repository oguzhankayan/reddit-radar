import { readFileSync } from "node:fs"

/**
 * Ortam değişkeni okuma. Node tarafında `process.env`'den okunur; tek giriş
 * noktası burasıdır ki test edilebilir ve tek biçimli kalsın.
 */
export function envVar(name: string): string | undefined {
  return process.env[name]
}

/**
 * Basit `.env` yükleyici.
 *
 * Neden bağımlılık değil: MCP `npx` ile koşarken `node --env-file` kullanılamaz
 * ve tek bir dosyayı okumak için 40 KB'lık bir paket eklemek anlamsız. Sözdizimi
 * bilerek dar tutuldu: `KEY=value`, `#` yorumu, tırnak soyma.
 *
 * **Var olan ortam değişkeni asla ezilmez.** MCP yapılandırmasında verilen
 * anahtar, `.env` dosyasındakinden her zaman önceliklidir.
 */
export function loadDotEnv(paths: string[]): void {
  for (const path of paths) {
    let raw: string
    try {
      raw = readFileSync(path, "utf8")
    } catch {
      continue
    }
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!match) continue
      const key = match[1]!
      if (process.env[key] !== undefined) continue
      let value = match[2]!
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else {
        value = value.replace(/\s+#.*$/, "").trim()
      }
      process.env[key] = value
    }
  }
}
