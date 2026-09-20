/**
 * Sürüm kontrolü.
 *
 * Neden gerekli: kurulum `npx -y reddit-radar` ise npm, registry'nin "latest
 * hangi sürüm" cevabını önbelleğe alır ve TTL dolana kadar eski sürümü
 * çalıştırır. Yeni terminal açmak bunu değiştirmez — cache disk üzerindedir.
 * Ölçüldü: 0.1.2 yayınlandıktan sonra `npx -y reddit-radar` hâlâ 0.1.0
 * koşuyordu; `--prefer-online` ya da `npm cache clean --force` çözüyordu.
 *
 * Bu yüzden sunucu kendi sürümünü registry ile karşılaştırır ve eskiyse
 * ajana görünür bir yerde söyler. Kontrol ASLA açılışı bloklamaz ve
 * başarısız olursa sessizce yok sayılır — ağı olmayan bir makinede
 * ürünün çalışmaması saçma olur.
 */
const REGISTRY = "https://registry.npmjs.org/reddit-radar/latest"
const TIMEOUT_MS = 3_000

export type UpdateInfo = {
  current: string
  latest: string
  /** Şimdi güncellemek için. */
  command: string
  /** Sorunun bir daha çıkmaması için kurulumu kalıcı düzelten komut. */
  permanentFix: string
}

let cached: UpdateInfo | null = null
/**
 * Bayrak değil PROMISE tutulur.
 *
 * İlk sürümde `checked = true` await'ten ÖNCE set ediliyordu. Açılıştaki
 * fire-and-forget çağrı bayrağı kaldırıyor, hemen ardından gelen
 * `radar_version` ise "zaten bakıldı" deyip henüz dolmamış cache'i (null)
 * döndürüyordu — eski sürüm kendini güncel sanıyordu. Ölçüldü: 0.0.1
 * sürümü `up_to_date: true` diyordu.
 */
let inFlight: Promise<UpdateInfo | null> | null = null

/** Semver karşılaştırması — yalnız x.y.z, ön-sürüm etiketi yok. */
function isOlder(a: string, b: string): boolean {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}

export function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  inFlight ??= runCheck(current)
  return inFlight
}

async function runCheck(current: string): Promise<UpdateInfo | null> {
  if (current === "dev") return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const res = await fetch(REGISTRY, { signal: ctrl.signal, headers: { accept: "application/json" } })
    clearTimeout(t)
    if (!res.ok) return null
    const latest = String((await res.json() as { version?: string })?.version ?? "")
    if (!/^\d+\.\d+\.\d+$/.test(latest) || !isOlder(current, latest)) return null
    cached = {
      current, latest,
      // `claude mcp restart` diye bir komut YOK. Cache temizlenir, sonra
      // Claude Code oturumu yeniden başlatılınca MCP süreci de yeniden doğar.
      command: "npm cache clean --force   # sonra Claude Code'u kapatıp açın",
      // Kalıcı çözüm: --prefer-online ile npx her açılışta registry'ye sorar,
      // bu da metadata cache sorununu tamamen ortadan kaldırır.
      permanentFix:
        "claude mcp remove reddit-radar && " +
        "claude mcp add reddit-radar -e RADAR_API_KEY=<anahtarınız> -- npx -y --prefer-online reddit-radar",
    }
    return cached
  } catch {
    return null // ağ yoksa ürün yine çalışır
  }
}

export function cachedUpdate(): UpdateInfo | null {
  return cached
}

export { isOlder }
