# Reddit Radar

Doğal dilde bir araştırma sorusunu alıp binlerce Reddit postunu semantic olarak
sınıflandıran, evidence-first structured intelligence üreten local araç.

**Durum:** CANLI · API `https://redditradar.creativefactory.tr` · npm `reddit-radar@0.4.0`
Kapılar: G0 ✅ · G1 ✅ · G2 ✅ %90 · G3 ✅ 20/20 · MCP ✅ · Hosted API ✅


## Kurulum

```bash
claude mcp add reddit-radar -e RADAR_API_KEY=rr_xxx -- npx -y --prefer-online reddit-radar
```

Tek satır. **Reddit hesabı, TypeSafe ya da DeepSeek anahtarı gerekmez** — yalnız
`RADAR_API_KEY`. Chrome kurulu olmalı; ilk taramada bir pencere açılır, kapatmayın.

`--prefer-online` olmadan npx kurulu paketi cache'ler ve güncellemeler günlerce gelmez.

| tool | ne için |
|---|---|
| `radar_scan` | Taramayı başlatır, anında `scan_id` + süre tahmini döner |
| `radar_scan_status` | İlerleme (yerel toplama + sunucu sınıflandırma birlikte) |
| `radar_results` | **Pazar ne diyor** — cluster'lar, coverage, maliyet |
| `radar_prospects` | **Kime yazacağım** — düz sıralı liste: yazar, URL, post yaşı, yorum sayısı, subreddit kırılımı |
| `radar_evidence` | Bir cluster'ın altındaki gerçek postlar |
| `radar_usage` | Bu ayki kullanım ve kalan kota |
| `radar_version` | Sürüm kontrolü ve güncelleme komutu |
| `radar_cancel` | Koşan taramayı durdurur |
| `radar_forget` | Tarama verisini siler |
| `radar_export` | Tüm sonuç JSON |
| `radar_scans` | Bu makinedeki taramalar |
| `radar_login` | Opsiyonel; erişim için değil, Reddit kotası için |

### Kullanıcının hiçbir şey öğrenmesi gerekmez

Normal cümleyle sorar, ajan gerisini tool açıklamalarından çözer:

> "SEO hizmeti satabileceğim kişileri Reddit'te bul"

- **Dil otomatik** — soru Türkçeyse Türkçe Reddit içeriği aranır. `language`
  parametresi var ama normalde gerekmez.
- **Preset otomatik** — sorudan çıkarılır.
- **Tool seçimi otomatik** — sunucu `instructions` alanında kullanıcının
  cümlesine göre yönlendirme tablosu var: "kişi bul / müşteri bul / nerede
  reklam yapayım" → `radar_prospects`, "insanlar ne diyor / hangi sorunlar
  tekrar ediyor" → `radar_results`.
- Ajana ayrıca ne **söylememesi** gerektiği de yazılı: subreddit kuralları ve
  üye sayısı toplanmadığı için "burada tanıtım serbest" iddiası kuramaz,
  yorumlar toplanmadığı için "yorumlarda şunu övmüşler" diyemez.

## Mimari — neden hibrit

Reddit verisi **yalnız gerçek, headful bir tarayıcıdan** alınabiliyor. Ölçüldü:

```
curl (residential IP)  → 403 bot-challenge
headless Chrome        → 403
headful Chrome         → 200 JSON
```

Bu yüzden toplama merkezîleştirilemez ve saf URL'li (remote) MCP mümkün değil.
Toplama kullanıcının makinesinde, zekâ sunucuda:

```
Claude ──MCP(stdio)──► reddit-radar-mcp (kullanıcının makinesi)
                          │  Playwright + gerçek Chrome
                          │  plan · toplama · normalize · dedupe
                          ▼  normalize edilmiş item'lar (200'lük batch)
                       Cloudflare Workers API
                          │  Jev Stage 1/2 · DeepSeek cluster+sentez
                          │  D1 (kimlik, skor, kullanım) · R2 (artefakt)
                          ▼
                       structured evidence
```

Anahtarlar sunucuda kalır; kullanım D1'de ölçülür ve kotalanır.

## Dokümanlar

| dosya | ne var |
|---|---|
| `docs/OPERATIONS.md` | Anahtar kesme, kotalar, maliyet, deploy, sorun giderme |
| `docs/DECISIONS.md` | Her tasarım kararının ölçümü — değiştirmeden önce okuyun |
| `docs/source-report.md` | Reddit erişim ölçümleri (curl/headless/headful) |
| `docs/wall-report.md` | Rate limit ve listing derinliği |
| `docs/bench-gate.md` | G2 precision kapısı |
| `docs/gate-g3.md` | G3 uçtan uca kapısı (20/20) |
| `docs/batch-bench.md` | Batching karşılaştırması |

## Geliştirici kurulumu

```bash
pnpm install
cp .env.example .env    # TYPESAFE_API_KEY, DEEPSEEK_API_KEY
```

Chrome kurulu olmalı (`channel: "chrome"`). Reddit login **gerekmiyor**.

## Geliştirici komutları

```bash
pnpm radar scan --question "..." [--preset ...] [--target 5000]
pnpm radar gate                     # G3 kapısı: evidence'ı elle doğrula
pnpm radar collect --target 5000    # sadece toplama
pnpm radar source-probe             # kaynak sağlık kontrolü
pnpm radar bench -n 500             # Stage 1 benchmark
pnpm radar label --top 25 --sample 10
pnpm radar score                    # G2 kapı ölçümü
pnpm radar                          # komut listesi
```

Komutlar proje dizininin dışından da çalışır — yollar `process.cwd()`'den değil
modülün kendi konumundan türetilir.

Çıktı: `~/.reddit-radar/scans/<scan_id>/{plan,items.ndjson,stage1,stage2,results.json,evidence.csv}`

## Güvenlik ve veri

- **Prompt injection:** Reddit metni LLM'e **nonce'lu** sınır içinde gider (`<UNTRUSTED_REDDIT_CONTENT id="a7f3c2">`).
  Sabit etiket yeterli değildi — post metnine kapanış etiketi yazarak bloktan kaçılabiliyordu.
  Ayrıca sınır benzeri diziler ve satır başı rol işaretleri (`System:`) temizlenir.
  Jev tarafında zaten yapısal güvenlik var: kriter güvenilir kanal, state düşman kanal, dönüş tipli bir değer.
- **Path traversal:** `scan_id` şema seviyesinde `^scan_[a-z0-9]{1,32}$` ile kısıtlı.
  Bu olmadan `radar_forget({scan_id:"../../..", scope:"all"})` `/Users` dizinini siliyordu.
- **Saklama (v2 §34):** ham Reddit metni varsayılan **48 saatte** silinir (`RADAR_RAW_RETENTION_HOURS`),
  silindiğine dair iz bırakılır. Sonuçlar, skorlar, URL'ler kalır. `radar_forget` ile elle de silinir.
  **Sayfa cache'i de bu politikaya dahildir** — tam gövde ve kullanıcı adı tutuyor; dışarıda
  bırakmak politikayı geçersiz kılıyordu (31 MB ham metin süresiz duruyordu).
- **Cookie:** kod Reddit oturumunu `context.cookies()`/`storageState()` ile okumaz, serialize etmez,
  loglamaz, dışarı göndermez. Yalnız persistent profile içinde, page context fetch'inde kullanılır.
- **Sır yönetimi:** anahtarlar `.env`'de (600), repoya girmez. Reddit şifresi hiç alınmaz, OAuth yok.
- **İzolasyon:** `~/.reddit-radar` 700. Aynı anda tek browser (mutex + lock dosyası); ikinci tarama sıraya girer.
- **İptal:** `radar_cancel` toplama, Stage 1 ve Stage 2'nin ortasında çalışır; kısmi sonuç korunur.
- **Dürüst muhasebe:** sınıflandırma hataları sayılır ve %2'yi aşarsa scan `partial` işaretlenir.
  Cache isabetleri canlı isteklerden ayrı raporlanır. Sunucu yarıda ölürse yarım taramalar
  açılışta `failed` olarak işaretlenir — durum sonsuza kadar "collecting" görünmez.

## Ölçülen gerçekler

Hepsi bu repodaki `docs/*.md` raporlarından, tahmin değil.

**Kaynak** (`docs/source-report.md`)
- Anonim `.json` erişimi curl ile **403 bot-challenge**. Headless Chrome de **403**.
  Headful Chrome sayfa bağlamından **200 JSON**. Belirleyici olan login değil, gerçek browser.
- Reddit login **gerekmiyor**. `old.reddit` logged-out kullanılamıyor.
- Global `/search.json` 10 item döndürüyor, subreddit-scoped search 100 → planner subreddit-scoped kullanır.

**Rate limit** (`docs/wall-report.md`)
- Quota-tabanlı: **~100 istek / ~10 dk**, `x-ratelimit-remaining` istek başına 1 azalıyor, aralıktan bağımsız.
- Yavaşlamak hacim kazandırmaz. Collector kotayı okuyup 429 görmeden bekler.
- Asıl darboğaz kota değil **listing derinliği**: subreddit başına ~930-1000 item, sonrası saf duplicate.
  20k hedefi sayfa değil **partition** sayısıyla gelir (~20-25 partition).

**Toplama** (`docs/collection-report.md`)
- 5.022 unique / 52 istek / 306 sn / **0 adet 429** / duplicate %1.3 / 0 bozuk kayıt.
- Search partition'ları listing'den zayıf (10-250 item) ve aynı subreddit'te listing'le **%47 çakışıyor**.

**Sınıflandırma** (`docs/bench-stage1.md`, `docs/bench-gate.md`)
- precision@20 **%90.0** (18/20) ✅ · overall %83.9 (26/31) · 49 insan etiketi.
- Jev insanla %73.5 uyumlu, DeepSeek %63.3 → gümüş etiketleyici gevşek, Jev muhafazakâr.
- 712 token/item, **$0.03 / 1k item**, 20k Stage 1 ≈ $0.60.
- **Hız tavanı ~3.3 çağrı/sn** ve eşzamanlılıktan bağımsız (12 ve 40'ta aynı ölçüldü).
  Dokümandaki 1.200 istek/dk pratikte karşılık bulmuyor → bağlayıcı kısıt maliyet değil **çağrı sayısı**.

**Batching** (`docs/batch-bench.md`) — Stage 1 çağrı başına 10 item:

| item/çağrı | hızlanma | maliyet | karar uyumu | shortlist örtüşme |
|---:|---:|---:|---:|---:|
| 5 | 2.9x | %71 | %94.8 | %100 |
| **10** | **5.6x** | **%67** | %93.0 | **%100** |
| 20 | 10.6x | %66 | %93.8 | %80 ← contamination |

10 seçildi: sıralama birebir korunuyor. 20'de cross-item contamination shortlist'i bozuyor —
planın §24'te uyardığı şey ölçümle görüldü. Tek tek olasılıklar biraz kayıyor (MAD 0.056)
ama ürünün metriği precision@**top-k**, yani sıralama.

## İki yapısal ders

**1. Her kriter tek şey ölçmeli.** `relevant_to_topic`'i problem ifadesiyle sormak
`contains_real_problem`'i ikinci kez uygulamaktı → recall %5.3. Alana indirgemek
konuyu hiç test etmemekti → precision %79.2. `in_domain` + `about_topic` ayrı olunca düzeldi.

**2. Atomik kararları eşikleyip VE'leme.** Dört kriteri 0.8'de eşikleyip çarpmak
shortlist'i %1'e düşürdü (%35 × %2 × %60 × %81). Ham olasılıkların ağırlıklı
geometrik ortalaması + üst %5 kesme doğrusu. Bu zaten plan v2 §28'de yazıyordu —
"atomik kararlar Jev'den, final score kodla".

## Derin denetimde bulunan hatalar

İlk denetim turu yüzeyseldi; ikinci turda kod satır satır okunduğunda dört hata daha çıktı:

1. **Kalıcı deadlock.** `RadarBrowser.launch()` try bloğunun dışındaydı. Fırlatırsa
   (Chrome yok, profil başka Chrome'da açık, disk dolu) browser mutex'i hiç bırakılmıyor
   ve sonraki **her** tarama sessizce sonsuza kilitleniyordu.
2. **Opportunity skoru preset'e göre sakatlanıyordu.** Ağırlıklar sabit toplam üzerinden
   hesaplanıyor, preset'in üretmediği sinyaller sıfır sayılıyordu. `competitor_complaints`
   dissatisfaction/workaround/WTP üretmediği için **%35 ağırlık boşa gidiyor**, skor 65'i
   hiç geçemiyordu. Gerçek koşuda ölçüldü: max 60→92, "high signal" sayısı **24→194**.
   Artık ağırlıklar mevcut sinyaller üzerinden yeniden normalize ediliyor ve
   `score_basis` ile hangi sinyallerin kullanıldığı raporlanıyor.
3. **Cache saklama politikasının dışındaydı** (yukarıda).
4. **Bir test hatanın kendisini doğruluyordu** — `pain_severity: 1.5` için 13 bekliyordu,
   ki bu tam olarak 2 numaralı hatanın çıktısıydı.
5. **Konu-hedefli search'ler hiç koşmuyordu.** Partition sıralamasında listing'ler önceydi;
   6 listing ~5.400 item üretip hedefi doldurunca 18 search partition'ı sıraya bile gelmiyordu.
   Yani ürün, `"zendesk alternative"` gibi tam isabetli sorguları üretip **kullanmıyor**,
   bunun yerine büyük subreddit'lerden genel içerik toplayıp %95'ini eliyordu.
   Search'ler öne alındı; aynı soruda ölçülen fark:

   | | önce | sonra |
   |---|---:|---:|
   | koşan search sorgusu | 0 | 6 |
   | top-5 ortalama fırsat skoru | 60.6 | **81.0** |

   Nitelik farkı daha büyük: 1. cluster *"Cold outreach and lead-gen tools don't convert"*
   (konu dışı) yerine *"Zendesk and Intercom are too expensive and their AI resolution
   pricing is unsustainable"* (rakip adı + fiyat şikâyeti, tam hedef).

## İki kök neden (prospector karşılaştırmasından)

Kapılar üst üste düşünce sorunun Jev'de değil kurguda olduğu anlaşıldı. İki temel hata:

### 1. Retrieval parametreleri yanlıştı

G0'da global aramayı `sort=new&t=month` ile ölçüp "yalnız 10 item döndürüyor" diye eledim
ve tüm stratejiyi subreddit `/new` listing'leri üzerine kurdum. Aynı sorgu, doğru parametrelerle:

| | item | subreddit | sayfalıyor |
|---|---:|---:|---|
| `sort=new` `t=month` | 14 | 12 | hayır |
| `sort=relevance` `t=month` | 13 | 11 | hayır |
| **`sort=relevance` `t=year`** | **100** | **67** | **evet** |

`/new` listing'leri konusal olarak rastgele: "destek araçları" sorusuna "Fiverr'da dolandırıldım"
getiriyorlar. Stage 1'e, retrieval'ın yapması gereken işi yaptırıyordum. Kanallar yeniden
sıralandı: **global arama → subreddit-scoped arama → listing (yalnız genişlik)**.

### 2. Ağırlıklı toplam, konudan bağımsız sinyallerin alakasız postu taşımasına izin veriyordu

Beş boyutu ayrı sorup ağırlıklı topluyordum. Gerçek bir örnek:

```
"Small MSP in Sydney - Need white label domain registrar"
  problem_match   0.10   ← Jev doğru: aradığımız problem değil
  persona_match   0.07   ← Jev doğru: SaaS kurucusu değil
  concrete_detail 0.95   ← doğru ama KONUDAN BAĞIMSIZ
  intent          2.99   ← doğru ama KONUDAN BAĞIMSIZ
  → 0.53, top-20'de BİRİNCİ
```

Jev her soruya doğru cevap verdi; toplam yanlıştı. `concrete_detail` ve `intent` iyi yazılmış
hemen her Reddit postu için yüksek, yani skorun yarısı konuya bakmadan dağıtılıyordu.

Rubrik iki soruya indirildi: **`disqualified`** (tek kavramlı kapı) ve **`fit`** (5 kademeli,
tüm spec'i kendi talimatında taşıyan, bütünsel tek skor). Kademe metinleri uzunluğu niyetle
karıştırmaz — tek cümlelik "Zendesk alternative?" en iyi kanıtlardan biridir.

Sonuç, aynı soruda top-10 evidence:

| önce | sonra |
|---|---|
| Small MSP — white label domain registrar | gorgias ticket volume pricing is killing our shopify store |
| Cold outreach and lead-gen tools don't convert | Migrating from Zendesk + Intercom. Anyone using AI deflection? |
| Founder-led sales collapses | how do I stop 2 agents replying to the same email? |

## Sıradaki iş

- G3 kapısı: uçtan uca tarama sonucu, top 20 evidence'ın ≥18'i değerli mi.
- Stage 2 batching (şu an tek tek; havuz küçük olduğu için öncelik düşük).
- Stage 1 kesme oranı ayrık örneklemde doğrulanmalı (`bench --offset`).
- Stage 1 kesme oranı (%5) aynı etiket setinde kalibre edildi; ayrık örneklemde doğrulanmalı.
