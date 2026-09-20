import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

/**
 * Proje kökü — çalışma dizininden DEĞİL, modülün kendi konumundan türetilir.
 *
 * CLI komutları `process.cwd()` kullanıyordu; kullanıcı ev dizininden
 * çağırınca `docs/`, `out/`, `tests/fixtures/` yolları tutmuyor ve komut
 * anlaşılmaz bir hatayla düşüyordu. Artık nereden çağrılırsa çağrılsın çalışır.
 */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

export const fromRoot = (...parts: string[]): string => join(PROJECT_ROOT, ...parts)
