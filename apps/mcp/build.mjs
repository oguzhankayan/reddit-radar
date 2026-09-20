// MCP'yi tek dosyaya paketler.
//
// Neden bundle: Node'un TypeScript soyma özelliği 22.18'den eski sürümlerde yok
// ve kullanıcıların çoğu orada. Kaynağı olduğu gibi yayınlarsak `npx` çoğu
// makinede patlar. playwright ve MCP SDK external kalır — ikisi de runtime
// bağımlılığı ve bundle edilmeleri doğru değil.
import { build } from "esbuild"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["playwright", "@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"],
  banner: { js: "#!/usr/bin/env node" },
  // Sürüm package.json'dan gelir. Koda gömülüyken 0.1.1 yayınlandı ama sunucu
  // hâlâ "0.1.0" diyordu ve güncellemenin gelmediği sanıldı.
  define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "info",
})
