import { RadarBrowser } from "../../../packages/browser/src/browser.ts"
import { sourceProbe } from "./commands/source-probe.ts"
import { wallProbe } from "./commands/wall-probe.ts"
import { collect } from "./commands/collect.ts"
import { bench } from "./commands/bench.ts"
import { label } from "./commands/label.ts"
import { score } from "./commands/score.ts"
import { scan } from "./commands/scan.ts"
import { batchBench } from "./commands/batch-bench.ts"
import { gate } from "./commands/gate.ts"
import { keyCommand } from "./commands/key.ts"

const [cmd, ...rest] = process.argv.slice(2)
const headless = rest.includes("--headless") || process.env.RADAR_HEADFUL === "0"

switch (cmd) {
  case "login": {
    const b = await RadarBrowser.launch({ headless: false })
    try {
      const pre = await b.ensureLogin()
      if (pre.loggedIn) {
        console.log(`Zaten giriş yapılmış: ${pre.username} (via ${pre.via})`)
        break
      }
      console.log("Açılan browser'da Reddit'e giriş yap. Bekliyorum (5 dk)...")
      const st = await b.waitForLogin()
      console.log(st.loggedIn ? `Login ✓ ${st.username}` : `Login ✗ ${st.reason}`)
    } finally {
      await b.close()
    }
    break
  }
  case "source-probe":
    await sourceProbe({ headless, quick: rest.includes("--quick") })
    break
  case "wall-probe":
    await wallProbe()
    break
  case "collect": {
    const tIdx = rest.indexOf("--target")
    await collect(tIdx >= 0 ? Number(rest[tIdx + 1]) : 5_000, rest.includes("--searches"))
    break
  }
  case "bench": {
    const nIdx = rest.indexOf("-n")
    const topicIdx = rest.indexOf("--topic")
    await bench(
      nIdx >= 0 ? Number(rest[nIdx + 1]) : 300,
      topicIdx >= 0 ? rest[topicIdx + 1]! : "choosing, paying for, or being frustrated by software tools they use in their business",
      rest.indexOf("--offset") >= 0 ? Number(rest[rest.indexOf("--offset") + 1]) : 0,
    )
    break
  }
  case "label": {
    const t = rest.indexOf("--top"), sm = rest.indexOf("--sample")
    await label({
      top: t >= 0 ? Number(rest[t + 1]) : 25,
      sample: sm >= 0 ? Number(rest[sm + 1]) : 10,
      file: rest.find((a) => a.endsWith(".json")),
    })
    break
  }
  case "score":
    score(rest.find((a) => a.endsWith(".json")))
    break
  case "scan": {
    const g = (f: string) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined }
    const question = g("--question")
    if (!question) { console.error('--question gerekli'); break }
    await scan({ question, preset: g("--preset") as any, target: Number(g("--target") ?? 5_000) })
    break
  }
  case "batch-bench": {
    const nIdx = rest.indexOf("-n")
    await batchBench(nIdx >= 0 ? Number(rest[nIdx + 1]) : 100, [5, 10, 20])
    break
  }
  case "gate": {
    const nIdx = rest.indexOf("-n")
    await gate(rest.find((a) => a.startsWith("scan_")), nIdx >= 0 ? Number(rest[nIdx + 1]) : 20)
    break
  }
  case "key":
    await keyCommand(rest)
    break
  default:
    console.log(`Reddit Radar CLI

  pnpm radar <komut>          (proje dizininden)
  node --env-file=.env apps/cli/src/index.ts <komut>

Komutlar
  scan --question "..." [--preset P] [--target N]   uçtan uca tarama
  gate [scan_id] [-n 20]                            G3 kapısı: evidence'ı elle doğrula
  key create --email X [--plan starter] [--quota N]  API anahtarı kes
  key list | key revoke <hash-öneki>                anahtarları yönet
  collect [--target N] [--searches]                 sadece toplama
  source-probe [--headless] [--quick]               kaynak sağlık kontrolü
  wall-probe                                        rate limit ölçümü
  bench [-n 300] [--topic "..."] [--offset N]       Stage 1 benchmark
  batch-bench [-n 100]                              batching karşılaştırması
  label [--top 25] [--sample 10]                    insan etiketleme
  score                                             G2 kapı ölçümü
  login                                             opsiyonel Reddit oturumu

Preset: saas_opportunities buyer_intent competitor_complaints
        alternatives feature_requests geo_seo_opportunities`)
}
