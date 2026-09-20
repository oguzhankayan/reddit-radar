import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { readFileSync, existsSync } from "node:fs"
import { purgeAllExpired as _sweep } from "../../../packages/core/src/retention.ts"
import { join } from "node:path"
import { runHostedScan } from "../../../packages/core/src/hosted-scan.ts"
import { RadarClient } from "../../../packages/radar-client/src/index.ts"
import { estimateScanMinutes } from "../../../packages/shared/src/estimate.ts"
import { checkForUpdate, cachedUpdate } from "../../../packages/shared/src/version-check.ts"
import { detectLanguage } from "../../../packages/shared/src/detect-language.ts"
import { RadarBrowser } from "../../../packages/browser/src/browser.ts"
import { browserMutex } from "../../../packages/shared/src/mutex.ts"
import { PRESETS } from "../../../packages/classifiers/src/stage2.ts"
import { writeState, readState, readResults, listScans, scanDir, isValidScanId, markInterrupted, type ScanState } from "./store.ts"
import { RAW_RETENTION_HOURS } from "../../../packages/core/src/retention.ts"
import { statSync, rmSync } from "node:fs"

/**
 * Reddit Radar MCP — local.
 *
 * İki kural bu dosyanın şeklini belirliyor:
 *
 *  1. **Tarama uzun sürer, tool çağrısı bekleyemez.** `radar_scan` anında
 *     scan_id döner, iş arka planda koşar, durum `radar_scan_status`'tan
 *     poll edilir (v2 §39 status makinesi).
 *  2. **Claude ham post görmez.** Yalnız cluster + count + evidence + confidence
 *     döner (v2 §33). 20k item asla context'e basılmaz.
 */

const running = new Map<string, AbortController>()

/** scan_id düşman girdi — şema seviyesinde kısıtlanır (path traversal savunması). */
const scanIdSchema = z.string().regex(/^scan_[a-z0-9]{1,32}$/, "geçersiz scan_id")

/**
 * Tool cevabı. Güncelleme varsa her cevaba iliştirilir — `instructions` alanı
 * initialize anında sabitlendiği için oraya konamıyor, ajanın göreceği tek
 * güvenilir yer tool çıktısı.
 */
const text = (v: unknown) => {
  const up = cachedUpdate()
  const payload =
    up && typeof v === "object" && v !== null && !Array.isArray(v)
      ? { ...v, update_available: { from: up.current, to: up.latest, run: up.command } }
      : v
  return { content: [{ type: "text" as const, text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] }
}

/** esbuild tarafından package.json'dan enjekte edilir; kaynaktan koşarken yedek. */
declare const __PKG_VERSION__: string | undefined
const VERSION = typeof __PKG_VERSION__ === "string" ? __PKG_VERSION__ : "dev"

const server = new McpServer({ name: "reddit-radar", version: VERSION }, {
  instructions: [
    "Reddit Radar, bir araştırma sorusunu binlerce Reddit postunda semantic olarak tarar ve",
    "her iddianın altında gerçek Reddit kanıtı olan yapılandırılmış sonuç döndürür.",
    "",
    "## Kullanıcının ne istediğine göre hangi tool",
    "",
    "Kullanıcı KİŞİ ya da ULAŞILACAK POST arıyorsa → radar_scan, sonra radar_prospects:",
    "  \"... satabileceğim kişileri bul\" · \"müşteri bul\" · \"kimler X arıyor\"",
    "  \"nerede reklam/tanıtım yapabilirim\" · \"hangi postlara cevap yazayım\"",
    "  \"hangi subreddit'lerde bu konu konuşuluyor\"",
    "  radar_prospects yazar adını, post linkini, postun kaç günlük olduğunu,",
    "  yorum sayısını ve subreddit kırılımını verir. Ulaşım için max_age_days=45 geçin.",
    "",
    "Kullanıcı PAZARI anlamak istiyorsa → radar_scan, sonra radar_results:",
    "  \"insanlar X hakkında ne diyor\" · \"hangi sorunlar tekrar ediyor\"",
    "  \"rakipler hakkında ne şikayet ediliyor\" · \"ne tür ürün fikri çıkar\"",
    "  radar_results temaları cluster hâlinde verir; yazar adı ve post yaşı YOKTUR.",
    "",
    "Emin değilsen ikisini de çağır — aynı taramadan okunurlar, ek maliyeti yok.",
    "",
    "## Bilmen gerekenler",
    "",
    "- Tarama DAKİKALAR sürer: 1.000 item ~3 dk, 5.000 ~7 dk, 20.000 ~42 dk.",
    "  radar_scan hemen döner ve süre tahmini verir; durumu radar_scan_status ile izle.",
    "  Kullanıcıya süreyi baştan söyle ve beklerken başka bir şey sorma zorunluluğu hissetme.",
    "- Dil sorudan OTOMATİK algılanır. Kullanıcı Türkçe sorarsa Türkçe Reddit içeriği aranır.",
    "  `language` parametresini yalnız kullanıcı açıkça başka dilde arama isterse ver.",
    "- Preset de sorudan otomatik seçilir; kullanıcı ısrar etmedikçe elleme.",
    "- İlk çalıştırmada ekranda bir Chrome penceresi açılır. Normaldir, kapatılmamalı.",
    "- Reddit hesabı GEREKMEZ. radar_login yalnız rate limit kotası için opsiyonel.",
    "- Aynı anda tek tarama koşar; ikincisi sıraya girer.",
    "",
    "## Söylememen gerekenler",
    "",
    "- Sonuç `partial` olabilir; bu hata değildir, coverage alanı ne kadarının",
    "  toplandığını söyler. \"Reddit'in tamamını taradım\" DEME.",
    "- Subreddit ÜYE SAYISI ve KURALLARI toplanmıyor. \"Bu subreddit'te tanıtım serbest\"",
    "  gibi bir iddiada bulunma — elinde o veri yok. Yalnız hangi subreddit'te kaç",
    "  yüksek skorlu post çıktığını söyleyebilirsin.",
    "- Yorumlar toplanmıyor, yalnız post gövdeleri. \"İnsanlar yorumlarda şunu övmüş\" deme.",
    "- `signal_coverage` VERİ kapsaması değildir; skor ağırlığının ne kadarının arkasında",
    "  sinyal olduğudur. \"Reddit'in yarısı tarandı\" diye okuma.",
    "- Bir tool cevabında `update_available` görürsen kullanıcıya söyle ve içindeki",
    "  `run` komutunu öner; eski sürüm sessizce yanlış davranabilir.",
  ].join("\n"),
})

server.registerTool("radar_scan", {
  description:
    "Reddit'te bir araştırma taraması başlatır. Kullanıcı Reddit'te bir şey ARAŞTIRMAK, " +
    "MÜŞTERİ/ALICI BULMAK, bir konuda insanların ne dediğini öğrenmek ya da hizmet " +
    "satabileceği kişileri bulmak istediğinde bunu kullanın. " +
    "Hemen döner; tarama arka planda koşar. Sonra radar_scan_status ile bekleyin. " +
    "Dil sorudan otomatik algılanır, parametre vermeniz gerekmez.",
  inputSchema: {
    question: z.string().min(8).describe("Doğal dilde araştırma sorusu"),
    preset: z.enum(PRESETS as [string, ...string[]]).optional().describe("Boş bırakılırsa sorudan otomatik çıkarılır. Verilirse derleyicinin seçimini ezer."),
    target_items: z.number().int().min(100).max(20_000).default(5_000),
    language: z.string().min(2).max(8).optional().describe(
      "GENELDE GEREKMEZ — sorunun dilinden otomatik algılanır. Yalnız kullanıcı açıkça " +
      "başka bir dilde içerik istiyorsa verin (ör. Türkçe soruyor ama İngilizce Reddit " +
      "aranmasını istiyorsa \"en\")."),
  },
}, async ({ question, preset, target_items, language }) => {
  const scanId = `scan_${Date.now().toString(36)}`
  const state: ScanState = {
    scan_id: scanId, status: "planning", question,
    progress: { collected: 0, target: target_items },
    startedAt: new Date().toISOString(),
  }
  writeState(state)
  const ac = new AbortController()
  running.set(scanId, ac)

  // Arka planda koş — tool çağrısını bloklamıyoruz.
    // Dil sorudan otomatik algılanır. Kullanıcının ya da ajanın parametre
  // vermesini beklemek, ürünü talimat ezberletmeye bağlar.
  const effectiveLanguage = language ?? detectLanguage(question)

  void runHostedScan({ question, target: target_items, preset, language: effectiveLanguage, signal: ac.signal }, {
    onPhase: (e) => {
      switch (e.phase) {
        case "planning": state.status = "planning"; break
        case "planned": state.status = "collecting"; break
        case "collecting": state.progress.collected = e.collected; break
        case "collected": state.progress.collected = e.collected; break
        case "finalizing": state.status = "classifying_stage1"; break
        case "cancelled": state.status = "cancelled"; break
      }
      writeState(state)
    },
  }).then((res) => {
    if (res.ok) {
      // Sunucu tarafı devam ediyor; gerçek durum artık API'den okunur.
      state.remoteScanId = res.scanId
      state.status = "classifying_stage1"
    } else {
      state.finishedAt = new Date().toISOString()
      state.status = res.reason === "cancelled" ? "cancelled" : "failed"
      if (res.reason !== "cancelled") state.error = res.reason
      if (res.scanId) state.remoteScanId = res.scanId
    }
    writeState(state)
  }).catch((err) => {
    state.status = "failed"
    state.error = String(err?.message ?? err).slice(0, 300)
    state.finishedAt = new Date().toISOString()
    writeState(state)
  }).finally(() => running.delete(scanId))

  const est = estimateScanMinutes(target_items)
  return text({
    scan_id: scanId,
    status: "planning",
    estimated_minutes: est.minutes,
    estimate_breakdown: est.note,
    language: effectiveLanguage ?? "otomatik (derleyici karar verecek)",
    note:
      `Tarama arka planda başladı. radar_scan_status ile izleyin — ${target_items} item yaklaşık ` +
      `${est.minutes} dakika sürer (${est.note}). Ekranda açılan Chrome penceresini kapatmayın. ` +
      `İptal için radar_cancel.`,
  })
})

server.registerTool("radar_scan_status", {
  description: "Bir taramanın durumu ve ilerlemesi.",
  inputSchema: { scan_id: scanIdSchema },
}, async ({ scan_id }) => {
  const s = readState(scan_id)
  if (!s) return text({ error: "not_found", scan_id })
  if (!s.remoteScanId) return text(s)

  // Toplama bitti; sınıflandırma/sentez sunucuda sürüyor.
  const remote = await new RadarClient().status(s.remoteScanId)
  if (!remote.ok) return text({ ...s, remote_error: remote.error.error })
  const merged = { ...s, status: remote.data.status, partial_reason: remote.data.partial_reason, remote_progress: remote.data.progress }
  if (["completed", "partial", "failed"].includes(remote.data.status) && !s.finishedAt) {
    writeState({ ...s, status: remote.data.status as any, finishedAt: new Date().toISOString() })
  }
  return text(merged)
})

server.registerTool("radar_results", {
  description:
    "PAZAR ÖZETİ: tekrar eden temaları cluster hâlinde döndürür — isim, kaç evidence, " +
    "ortalama fırsat skoru, özet. " +
    "Kullanıcı 'insanlar ne diyor', 'hangi sorunlar tekrar ediyor', 'pazarda ne var', " +
    "'rakipler hakkında ne konuşuluyor' diye soruyorsa bunu kullanın. " +
    "Kullanıcı KİŞİ ya da ulaşılacak POST arıyorsa radar_prospects kullanın. " +
    "Burada yazar adı ve post yaşı YOKTUR.",
  inputSchema: { scan_id: scanIdSchema, limit: z.number().int().min(1).max(50).default(20) },
}, async ({ scan_id, limit }) => {
  const s = readState(scan_id)
  if (!s?.remoteScanId) return text({ error: "not_ready", status: s?.status ?? "not_found" })
  const r = await new RadarClient().results(s.remoteScanId, limit)
  if (!r.ok) return text({ error: r.error.error, status: r.error.status ?? s.status })
  return text({
    ...r.data,
    clusters: r.data.clusters.map((c: any, i: number) => ({ cluster_id: `cluster_${i}`, ...c, evidence: undefined })),
  })
})

server.registerTool("radar_evidence", {
  description: "Bir cluster'ın altındaki gerçek Reddit evidence'ı: URL, subreddit, alıntı, fırsat skoru.",
  inputSchema: {
    scan_id: scanIdSchema,
    cluster_id: z.string().describe("radar_results'tan gelen cluster_id"),
    limit: z.number().int().min(1).max(50).default(10),
  },
}, async ({ scan_id, cluster_id, limit }) => {
  const s = readState(scan_id)
  if (!s?.remoteScanId) return text({ error: "not_ready", status: s?.status ?? "not_found" })
  const r = await new RadarClient().evidence(s.remoteScanId, cluster_id, limit)
  return r.ok ? text(r.data) : text({ error: r.error.error })
})

server.registerTool("radar_prospects", {
  description:
    "KİŞİ ve POST listesi: yazar adı, post linki, subreddit, fırsat skoru, postun kaç günlük " +
    "olduğu, yorum sayısı ve subreddit kırılımı. " +
    "Kullanıcı şunlardan birini istiyorsa BU tool'u kullanın: hizmet/ürün satacağı kişileri " +
    "bulmak, müşteri aramak, reklam ya da tanıtım yapabileceği yerleri bulmak, bir posta " +
    "cevap yazmak, birine ulaşmak, 'kimler şunu arıyor' sorusu, hangi subreddit'lerde " +
    "yoğunlaştığını görmek. " +
    "Kullanıcı 'pazar ne diyor', 'insanlar ne şikayet ediyor', 'hangi sorunlar tekrar ediyor' " +
    "diye soruyorsa radar_results kullanın. " +
    "Ulaşım amacıyla kullanırken max_age_days=45 verin: bir hizmet arayışı hızla soğur, " +
    "aylık postlar genelde çoktan çözülmüştür.",
  inputSchema: {
    scan_id: scanIdSchema,
    limit: z.number().int().min(1).max(200).default(50),
    max_age_days: z.number().int().min(1).max(365).optional().describe("Bundan eski postları ele. Ulaşım için 30 ve altı önerilir."),
    min_opportunity: z.number().int().min(0).max(100).optional(),
    subreddit: z.string().max(21).optional().describe("Tek bir subreddit'e daralt."),
  },
}, async ({ scan_id, limit, max_age_days, min_opportunity, subreddit }) => {
  const s = readState(scan_id)
  if (!s?.remoteScanId) return text({ error: "not_ready", status: s?.status ?? "not_found" })
  const r = await new RadarClient().prospects(s.remoteScanId, {
    limit, maxAgeDays: max_age_days, minOpportunity: min_opportunity, subreddit,
  })
  return r.ok ? text(r.data) : text({ error: r.error.error })
})

server.registerTool("radar_usage", {
  description: "Bu ayki kullanım ve kalan kota.",
  inputSchema: {},
}, async () => {
  const r = await new RadarClient().usage()
  return r.ok ? text(r.data) : text({ error: r.error.error })
})

server.registerTool("radar_cancel", {
  description: "Koşan bir taramayı durdurur. Kısmi sonuç varsa korunur.",
  inputSchema: { scan_id: scanIdSchema },
}, async ({ scan_id }) => {
  const ac = running.get(scan_id)
  if (!ac) {
    const s = readState(scan_id)
    return text({ cancelled: false, reason: s ? `zaten ${s.status}` : "not_found" })
  }
  ac.abort()
  running.delete(scan_id)
  return text({ cancelled: true, scan_id, note: "Durduruluyor; durumu radar_scan_status ile doğrulayın." })
})

server.registerTool("radar_forget", {
  description:
    "Bir taramanın verisini siler. scope='raw' yalnız ham Reddit metnini siler (sonuçlar kalır), " +
    "scope='all' taramayı tamamen kaldırır. Ham metin zaten " + RAW_RETENTION_HOURS + " saat sonra otomatik silinir.",
  inputSchema: { scan_id: scanIdSchema, scope: z.enum(["raw", "all"]).default("raw") },
}, async ({ scan_id, scope }) => {
  if (!isValidScanId(scan_id)) return text({ error: "invalid_scan_id" })
  const dir = scanDir(scan_id)
  if (!readState(scan_id) && !readResults(scan_id)) return text({ error: "not_found", scan_id })
  if (scope === "all") {
    rmSync(dir, { recursive: true, force: true })
    return text({ deleted: "all", scan_id })
  }
  return text({ deleted: "raw", scan_id, note: "Hosted modda ham metin sunucuda tarama biter bitmez silinir." })
})

server.registerTool("radar_export", {
  description: "Taramanın sonucunu JSON olarak döndürür (tüm cluster ve evidence).",
  inputSchema: { scan_id: scanIdSchema },
}, async ({ scan_id }) => {
  const s = readState(scan_id)
  if (!s?.remoteScanId) return text({ error: "not_ready", status: s?.status ?? "not_found" })
  const r = await new RadarClient().results(s.remoteScanId, 50)
  return r.ok ? text(r.data) : text({ error: r.error.error })
})

server.registerTool("radar_version", {
  description:
    "Kurulu sürümü ve npm'deki en son sürümü karşılaştırır. Güncelleme varsa çalıştırılacak " +
    "komutu döndürür. Kullanıcı 'güncel mi', 'yeni sürüm var mı' diye sorduğunda kullanın.",
  inputSchema: {},
}, async () => {
  const up = await checkForUpdate(VERSION)
  if (!up) return text({ current: VERSION, up_to_date: true })
  return text({
    current: up.current,
    latest: up.latest,
    up_to_date: false,
    run: up.command,
    permanent_fix: up.permanentFix,
    why:
      "npx, registry'nin 'latest' cevabını önbelleğe alır ve yeni terminal açmak bunu değiştirmez. " +
      "Cache temizlenip MCP yeniden başlatılmalı.",
  })
})

server.registerTool("radar_scans", {
  description: "Bu makinedeki taramaları listeler (en yeniden eskiye).",
  inputSchema: {},
}, async () => {
  // Dizi yerine nesne: `update_available` yalnız nesnelere iliştirilebiliyor
  // ve bu tool'u kullanan bir ajan uyarıyı hiç görmüyordu.
  const scans = listScans().slice(0, 25)
  return text({ count: scans.length, scans })
})

server.registerTool("radar_login", {
  description:
    "Reddit oturumu açar. ERİŞİM İÇİN GEREKLİ DEĞİL — ölçüldü ki oturum açmadan da JSON geliyor. " +
    "Yalnız rate limit kotasını büyütmek için faydalı olabilir. Bir Chrome penceresi açar ve hemen döner; " +
    "kullanıcı kendi hızında giriş yapar, oturum profilde kalıcı olur. Radar kullanıcının şifresini görmez.",
  inputSchema: {},
}, async () => {
  if (browserMutex.locked) return text({ started: false, reason: "browser_busy", note: "Tarama bitince tekrar deneyin." })

  const already = await browserMutex.run(async () => {
    const b = await RadarBrowser.launch({ headless: false })
    try { return await b.ensureLogin() } finally { await b.close() }
  })
  if (already.loggedIn) return text({ logged_in: true, username: already.username })

  // Pencereyi arka planda açık tut; tool çağrısını bloklama (MCP timeout'u var).
  void browserMutex.run(async () => {
    const b = await RadarBrowser.launch({ headless: false })
    try { await b.waitForLogin(240_000) } finally { await b.close() }
  }).catch(() => {})

  return text({
    started: true,
    logged_in: false,
    note: "Chrome penceresi açıldı. Reddit'e giriş yapın; oturum kalıcı olacak. Doğrulamak için birazdan radar_login'i tekrar çağırın.",
  })
})

_sweep()          // local artık kalmış ham metni sil (v2 §34)
markInterrupted() // önceki süreçten kalan yarım taramaları dürüstçe işaretle
void checkForUpdate(VERSION) // arka planda; başarısız olursa sessizce yok sayılır

await server.connect(new StdioServerTransport())
