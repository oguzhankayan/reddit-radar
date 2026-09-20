# Reddit Radar

[![CI](https://github.com/oguzhankayan/reddit-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/oguzhankayan/reddit-radar/actions/workflows/ci.yml)
[![Lisans: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![npm](https://img.shields.io/npm/v/reddit-radar.svg)](https://www.npmjs.com/package/reddit-radar)
[![MCP](https://img.shields.io/badge/MCP-server-blue.svg)](https://modelcontextprotocol.io)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Doğal dilde bir araştırma sorusunu alıp binlerce Reddit postunu semantic olarak
sınıflandıran, **her iddianın altında gerçek Reddit kanıtı olan** yapılandırılmış
pazar zekâsı üreten, tamamen yerel bir MCP sunucusu.

Kendi bilgisayarınızda çalışır. Merkezî sunucu, hesap, kota yok; yalnız kendi
API anahtarlarınız ve sisteminizdeki Chrome gerekir.

[English](README.md) · **Türkçe**

## Ne işe yarar

İki soruyu kanıtla birlikte cevaplar:

- **"Pazar ne diyor?"** — Tekrar eden temalar cluster hâlinde, her birinin altında
  o temayı üreten gerçek postlar.
- **"Kime yazacağım?"** — Düz sıralı kişi listesi: yazar, post linki, postun kaç
  günlük olduğu, yorum sayısı, subreddit kırılımı.

```
"SEO hizmeti satabileceğim kişileri Reddit'te bul"
"Küçük SaaS kurucuları müşteri destek araçlarıyla ilgili ne şikayet ediyor?"
"Zendesk alternatifi arayanlar hangi subreddit'lerde yoğunlaşıyor?"
```

## Özellikler

- **Kanıt zorunlu.** Sonuçlar post URL'si, alıntı ve skorla gelir; modelin
  özetine güvenmeniz gerekmez.
- **Prompt injection'a karşı yapısal savunma.** Reddit metni LLM'e nonce'lu
  sınırlar içinde ve yalnız `state` kanalından girer; soruları değiştiremez.
- **Dürüst kapsama.** Sınıflandırma hataları sayılır; `%2`'yi aşarsa sonuç
  `partial` işaretlenir. Cache isabetleri canlı isteklerden ayrı raporlanır.
- **Saklama politikası.** Ham Reddit metni varsayılan 48 saatte silinir; geriye
  URL, skor ve kısa alıntı kalır.
- **Düşük maliyet.** Sınıflandırma çağrı başına 10 item'da batch'lenir: 5,6x
  hızlanma, %33 daha ucuz, shortlist sıralaması birebir korunur.

## Kurulum

Gereksinimler: **Node.js 20+** (MCP'nin kendisi için), **Google Chrome**
(sistemde kurulu). Katkı için ayrıca **Node.js 22+** ve **pnpm** gerekir
(workspace araç zinciri) — bkz. [CONTRIBUTING.md](CONTRIBUTING.md).

### 1. API anahtarları

İki anahtar gerekir:

| değişken | ne için | nereden |
|---|---|---|
| `TYPESAFE_API_KEY` | Stage 1/2 sınıflandırma | https://typesafe.ai |
| `DEEPSEEK_API_KEY` | plan derleme + cluster sentezi | https://platform.deepseek.com |

LLM anahtarı OpenAI-uyumlu herhangi bir sağlayıcı olabilir; `.env` içinde
`LLM_BASE_URL` ve `LLM_MODEL` ile değiştirin (OpenRouter, yerel vLLM, ...).

### 2. MCP'yi Claude'a ekleyin

```bash
claude mcp add reddit-radar \
  -e TYPESAFE_API_KEY=ts_xxx \
  -e DEEPSEEK_API_KEY=sk-xxx \
  -- npx -y --prefer-online reddit-radar
```

`--prefer-online` bilerek var: onsuz npm, "latest hangi sürüm" cevabını
önbelleğe alıyor ve güncellemeler gecikebiliyor.

Alternatif olarak anahtarları `~/.reddit-radar/.env` içine koyabilirsiniz; MCP
açılışta bu dosyayı okur. Var olan ortam değişkeni asla ezilmez.

Reddit hesabı **gerekmez**. İlk taramada bir Chrome penceresi açılır; normaldir,
kapatmayın.

## Kullanım

Claude'a normal cümleyle sorun. Dil, preset ve doğru tool otomatik seçilir:

> "Reddit Radar ile küçük SaaS kurucularının müşteri destek araçlarıyla yaşadığı
> tekrar eden sorunları araştır."

Tarama arka planda koşar (5.000 item ≈ 7 dakika). Claude durumu izler, bittiğinde
cluster'ları gerçek postlarla birlikte döndürür.

### Tool'lar

| tool | ne için |
|---|---|
| `radar_scan` | Taramayı başlatır, anında `scan_id` + süre tahmini döner |
| `radar_scan_status` | İlerleme |
| `radar_results` | **Pazar ne diyor** — cluster'lar, coverage, maliyet |
| `radar_prospects` | **Kime yazacağım** — düz sıralı kişi/post listesi |
| `radar_evidence` | Bir cluster'ın altındaki gerçek postlar |
| `radar_usage` | Bu makinede biriken tahmini API harcaması |
| `radar_export` | Tüm sonuç JSON |
| `radar_scans` | Bu makinedeki taramalar |
| `radar_cancel` | Koşan taramayı durdurur (kısmi sonuç korunur) |
| `radar_forget` | Tarama verisini siler |
| `radar_version` | Sürüm kontrolü ve güncelleme komutu |
| `radar_login` | Opsiyonel; erişim için değil, Reddit kotası için |

### Ajanın bilmesi gerekenler

Tool açıklamaları ve sunucu `instructions` alanı, ajanı doğru tool'a yönlendirir
ve **yanlış iddialardan korur**: subreddit kuralları/üye sayısı ve yorumlar
toplanmadığı için ajan bunlar hakkında konuşamaz, `signal_coverage`'ı veri
kapsaması gibi sunamaz.

## Mimari — neden yerel

Reddit verisi **yalnız gerçek, penceresi olan bir Chrome'dan** alınabiliyor.
Ölçüldü (`docs/source-report.md`):

```
curl (residential IP)  → 403 bot-challenge
headless Chrome        → 403
headful Chrome (sayfa bağlamından fetch) → 200 JSON
```

Belirleyici olan login değil, gerçek tarayıcıdır. Bu yüzden toplama
merkezîleştirilemez; ürün baştan yerel olmak zorundaydı. 0.5.0 ile sınıflandırma
ve sentez de aynı sürece alındı:

```
Claude ──MCP(stdio)──► reddit-radar  (tek Node süreci, kullanıcının makinesi)
                         │ Playwright + Chrome   → Reddit toplama
                         │ TYPESAFE_API_KEY      → Stage 1/2 sınıflandırma
                         │ DEEPSEEK_API_KEY      → plan + cluster sentezi
                         ▼
                       ~/.reddit-radar/scans/<scan_id>/
                         plan.json · items.ndjson · stage1.ndjson
                         stage2.ndjson · results.json · evidence.csv
```

Hiçbir veri arada bir sunucuya uğramaz; anahtarlar yalnız kendi makinenizden
doğrudan sağlayıcıya gider.

## Maliyet

Ölçülen değerler (`docs/bench-stage1.md`):

- Stage 1: 712 token/item, **~$0.03 / 1.000 item**.
- DeepSeek: tarama başına ~$0.01.
- Tipik 5.000 item'lık tarama: kabaca **$0.15**.

`radar_usage` bu makinede biriken tahmini toplamı verir; gerçek fatura anahtar
sağlayıcılarınızdadır.

## Reddit uyumu ve yasal

Tam metin: [COMPLIANCE.md](COMPLIANCE.md). Özetle:

- Bu proje Reddit'i **scrape etmez**: HTML kazımaz, bot korumasını atlatmaz,
  kimlik doğrulamayı aşmaz.
- Herkese açık içeriği `www.reddit.com/...json` uç noktalarından **kullanıcının
  kendi gerçek tarayıcı oturumu ve sayfa bağlamı içinden** okur; tıpkı
  kullanıcının tarayıcıda sayfayı açması gibi.
- Hiçbir zaman yazmaz: post/yorum göndermez, oy vermez, mesaj atmaz, hesap
  işlemi yapmaz.
- Rate limit'e saygı gösterir: `x-ratelimit-*` başlıklarını okur, 429 görmeden
  bekler. Yalnız herkese açık içerik toplanır.
- Ham metin varsayılan 48 saatte silinir; bkz. `SECURITY.md`.
- Toplanan veri kullanıcının sorumluluğundadır; Reddit kullanım koşullarına
  uygun kullanılmalıdır.

**Uyum ve yasal iletişim:** uyum, yasal ya da kaldırma (takedown) talepleri için
**hi@creativefactory.tr** adresine yazın.

## Geliştirici kurulumu

```bash
pnpm install
cp .env.example .env     # TYPESAFE_API_KEY, DEEPSEEK_API_KEY
```

Chrome kurulu olmalı (`channel: "chrome"`). Reddit login gerekmiyor.

### Komutlar

```bash
pnpm radar scan --question "..." [--preset ...] [--target 5000] [--language en]
pnpm radar gate                     # G3 kapısı: evidence'ı elle doğrula
pnpm radar collect --target 5000    # yalnız toplama
pnpm radar source-probe             # kaynak sağlık kontrolü
pnpm radar bench -n 500             # Stage 1 benchmark
pnpm radar label --top 25 --sample 10
pnpm radar score                    # G2 kapı ölçümü
pnpm radar                          # komut listesi
```

Komutlar proje dizininin dışından da çalışır: yollar `process.cwd()`'den değil
modülün kendi konumundan türetilir.

### Doğrulama

```bash
pnpm typecheck && pnpm test && pnpm build:mcp
```

## Ölçülen gerçekler

Hepsi bu repodaki `docs/*.md` raporlarından; tahmin değil.

**Kaynak** (`docs/source-report.md`)
- Anonim `.json` erişimi curl ile **403 bot-challenge**, headless Chrome da
  **403**. Headful Chrome sayfa bağlamından **200 JSON**. Belirleyici olan login
  değil, gerçek browser.
- Reddit login **gerekmiyor**. `old.reddit` logged-out kullanılamıyor.
- Global `/search.json` 10 item döndürüyor; subreddit-scoped search 100 →
  planner subreddit-scoped kullanır.

**Rate limit** (`docs/wall-report.md`)
- Quota-tabanlı: **~100 istek / ~10 dk**; yavaşlamak hacim kazandırmaz.
  Collector kotayı okuyup 429 görmeden bekler.
- Asıl darboğaz kota değil **listing derinliği**: subreddit başına ~930-1000
  item, sonrası saf duplicate. 20k hedefi partition sayısıyla gelir.

**Toplama** (`docs/collection-report.md`)
- 5.022 unique / 52 istek / 306 sn / **0 adet 429** / duplicate %1.3 / 0 bozuk kayıt.

**Sınıflandırma** (`docs/bench-stage1.md`, `docs/bench-gate.md`)
- precision@20 **%90.0** (18/20) · overall %83.9 (26/31) · 49 insan etiketi.
- Jev insanla %73.5 uyumlu, DeepSeek %63.3 → gümüş etiketleyici gevşek, Jev
  muhafazakâr.
- **Hız tavanı ~3.3 çağrı/sn** ve eşzamanlılıktan bağımsız → bağlayıcı kısıt
  maliyet değil **çağrı sayısı**.

**Batching** (`docs/batch-bench.md`) — Stage 1 çağrı başına item:

| item/çağrı | hızlanma | maliyet | karar uyumu | shortlist örtüşme |
|---:|---:|---:|---:|---:|
| 5 | 2.9x | %71 | %94.8 | %100 |
| **10** | **5.6x** | **%67** | %93.0 | **%100** |
| 20 | 10.6x | %66 | %93.8 | %80 ← contamination |

10 seçildi: sıralama birebir korunuyor. 20'de cross-item contamination
shortlist'i bozuyor.

## Tasarım dersleri

İki hata ölçümle bulundu ve düzeltildi (`docs/DECISIONS.md`):

1. **Her kriter tek şey ölçmeli.** `relevant_to_topic`'i problem ifadesiyle
   sormak `contains_real_problem`'i ikinci kez uygulamaktı → recall %5.3.
   `in_domain` + `about_topic` ayrı sorulunca düzeldi.
2. **Atomik kararları eşikleyip VE'leme.** Dört kriteri 0.8'de eşikleyip çarpmak
   shortlist'i %1'e düşürdü. Ham olasılıkların ağırlıklı geometrik ortalaması +
   üst %5 kesme doğrusu doğru yol.

Retrieval parametreleri de yanlıştı: global aramayı yanlış `sort`/`t` ile ölçüp
"yalnız 10 item döndürüyor" diye elemiştim. Doğru parametrelerle
(`sort=relevance&t=year`) 100 item / 67 subreddit dönüyor. Kanallar yeniden
sıralandı: **global arama → subreddit-scoped arama → listing (yalnız genişlik)**.

## Dokümanlar

| dosya | ne var |
|---|---|
| `docs/OPERATIONS.md` | Anahtarlar, maliyet, saklama, sorun giderme, yayınlama |
| `docs/DECISIONS.md` | Her tasarım kararının ölçümü — değiştirmeden önce okuyun |
| `docs/source-report.md` | Reddit erişim ölçümleri (curl/headless/headful) |
| `docs/wall-report.md` | Rate limit ve listing derinliği |
| `docs/bench-gate.md` | G2 precision kapısı |
| `docs/gate-g3.md` | G3 uçtan uca kapısı |
| `docs/batch-bench.md` | Batching karşılaştırması |
| `COMPLIANCE.md` | Reddit uyumu ve yasal bildirim |
| `SECURITY.md` | Tehdit modeli ve açık bildirimi |
| `CONTRIBUTING.md` | Katkı rehberi ve ölçüm disiplini |

## Güvenlik ve veri

- **Prompt injection:** Reddit metni LLM'e nonce'lu sınır içinde gider; sabit
  etiket yetmiyordu. Bkz. `SECURITY.md`.
- **Path traversal:** `scan_id` şema seviyesinde `^scan_[a-z0-9]{1,32}$`.
- **Cookie:** kod Reddit oturumunu okumaz, serialize etmez, loglamaz, dışarı
  göndermez.
- **Saklama:** ham Reddit metni varsayılan 48 saatte silinir; iz bırakılır.
- **Sır yönetimi:** anahtarlar `.env`'de (600), repoya girmez.
- Radar hiçbir zaman post/yorum yazmaz, oy vermez, mesaj göndermez.

## Katkı

Katkılar memnuniyetle karşılanır. Önce `CONTRIBUTING.md`'yi, sınıflandırma veya
skorlama değiştiriyorsanız `docs/DECISIONS.md`'yi okuyun. Ölçümsüz optimizasyon
kabul edilmez.

## Lisans

MIT — bkz. [LICENSE](LICENSE).
