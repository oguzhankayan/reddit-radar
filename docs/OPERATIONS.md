# İşletme Kılavuzu

Ürünü çalıştıran, müşteriye anahtar kesen, maliyeti takip eden kişi içindir.

## Canlı sistem

| | |
|---|---|
| API | `https://redditradar.creativefactory.tr` |
| npm | `reddit-radar` (şu an 0.3.0) |
| Cloudflare hesabı | oguzhankayan@outlook.com.tr |
| Worker | `reddit-radar-api` |
| D1 | `reddit-radar` (id `41f65a8c-6837-40b1-bd21-a4c89131703a`) |
| R2 | `reddit-radar-artifacts` |
| Queue | `reddit-radar-classify` (+ `reddit-radar-dlq`) |

`workers.dev` alt alanı **kapalı** — servis yalnız kendi alan adından yayınlanır.

## Müşteri kurulumu

```bash
claude mcp add reddit-radar -e RADAR_API_KEY=rr_xxx -- npx -y --prefer-online reddit-radar
```

`--prefer-online` **zorunlu değil ama şart gibi davranın.** Onsuz npx kurulu paket
ağacını `~/.npm/_npx/<spec-hash>/` altında saklar ve registry'ye hiç sormaz;
yayınladığınız yeni sürüm müşteriye günlerce gitmez. Bu ölçüldü: 0.1.2
yayınlandıktan sonra düz `npx -y reddit-radar` hâlâ 0.1.0 koşuyordu.

Müşterinin ihtiyacı olan tek şey `RADAR_API_KEY`. Reddit hesabı, TypeSafe ya da
DeepSeek anahtarı **gerekmez** — o anahtarlar Worker secret'ı olarak sizde durur.

## Anahtar yönetimi

Sahibin makinesinden, `wrangler` üzerinden D1'e. Bilerek HTTP ucu yapılmadı:
anahtar kesmek için public endpoint açmak korunması gereken yeni bir saldırı
yüzeyi demek, işlem ise seyrek ve yalnız sahibe ait.

```bash
pnpm radar key create --email musteri@x.com --plan starter
pnpm radar key create --email musteri@x.com --quota 250000   # özel kota
pnpm radar key list                                           # kullanım/kota tablosu
pnpm radar key revoke 7d09a1bfa0                              # hash önekiyle iptal
```

Anahtarın kendisi hiçbir yere yazılmaz — yalnız SHA-256 özeti D1'e girer ve
ekranda bir kez görünür. Kaybolursa yenisi kesilir.

**Dikkat:** `key create` aynı e-postayı görünce mevcut hesabı günceller
(`ON CONFLICT(email)`). Aynı e-postaya farklı planla ikinci anahtar keserseniz
o hesabın **eski anahtarları da** yeni plana geçer.

## Paketler ve kota

Birim **sınıflandırılan item** — token değil, post değil, "Stage 1'den geçen item".
Aylık, takvim ayı başında sıfırlanır.

| paket | aylık kota | tek tarama | ≈ tarama sayısı (5.000'lik) |
|---|---:|---:|---:|
| free | 1.000 | 1.000 | 1 |
| starter | 100.000 | 20.000 | 20 |
| pro | 500.000 | 20.000 | 100 |
| agency | 2.000.000 | 20.000 | 400 |
| owner | 5.000.000 | 20.000 | 1.000 |

Tanımlar `packages/shared/src/plans.ts`'te; API oradan okur.

**Rezerve-sonra-harca:** `POST /v1/scans` kotayı `target_items` kadar rezerve eder,
gerçek tüketim sınıflandırılan item sayısıdır. Bilerek muhafazakâr — yarıda kota
biten bir tarama kullanıcıyı yarım sonuçla bırakırdı.

Üç koruma da canlıda doğrulandı:

```
500 kota / 600 item  → 402 {"error":"quota_exceeded","remaining":500,"requested":600}
500 kota / 400 item  → 200 {"scan_id":"...","status":"collecting"}
free paket / 5000    → 400 {"error":"scan_too_large","max_scan_items":1000}
```

## Maliyet

Ölçüm referansı: gerçek bir koşu, 3.022 item → Jev $0.1023 + DeepSeek $0.0116.

| kalem | 100.000 item (≈20 tarama) |
|---|---:|
| Jev (Stage 1 + Stage 2) | $3.39 |
| DeepSeek (plan + sentez) | $0.23 |
| D1 | $0.075 |
| R2 | $0.005 |
| Queues + Workers istek | $0.001 |
| **değişken toplam** | **$3.70** |

Üstüne aylık **$5 sabit** Workers Paid (Queues için zorunlu), tüm müşterilere yayılır.

Ölçekleme iki ayrı eksende: **Jev item başına** ($0.034/1.000 item), **DeepSeek
tarama başına** ($0.0116). Aynı 100.000'i 5 taramada harcamak DeepSeek maliyetini
dörde böler, Jev'i değiştirmez.

Brüt marj: $19'da %80 · $29'da %87 · $49'da %93 · $99'da %96.

**Yapısal avantaj:** Reddit toplama müşterinin makinesinde koşar. Bant genişliği,
tarayıcı, proxy, IP itibarı — hiçbirinin maliyeti sizde değil. Merkezî crawler
kuran rakiplerin en büyük gider kalemi burada sıfır.

**Risk:** Jev'in $0.042/1M girdi fiyatı agresif bir lansman fiyatı olabilir. İki
katına çıksa marjinal maliyet $7'ye çıkar, $49'da marj hâlâ %86.

## Deploy

```bash
pnpm typecheck && pnpm test       # ikisi de geçmeden deploy etmeyin
cd apps/api && wrangler deploy    # ya da: pnpm deploy:api
```

Şema değişikliği:

```bash
cd apps/api && wrangler d1 execute reddit-radar --remote --file=schema.sql
```

Secret güncelleme:

```bash
cd apps/api && wrangler secret put TYPESAFE_API_KEY
cd apps/api && wrangler secret put DEEPSEEK_API_KEY
```

## npm yayınlama

```bash
# apps/mcp/package.json içinde version'ı yükseltin, sonra:
cd apps/mcp && node build.mjs && npm publish --access public
```

Sürüm `package.json`'dan **build sırasında enjekte edilir** (`__PKG_VERSION__`).
Koda gömmeyin — bir kez gömüldü ve 0.1.1 yayınlandığı hâlde sunucu kendini
"0.1.0" diye tanıttı, güncelleme gelmedi sanıldı.

`reddit-radar-mcp` adı **başkasına ait** (sourav28, Ağustos 2026). Paket adı
`reddit-radar`; `reddit-radar-mcp` binary alias olarak da kurulur.

## Sorun giderme

| belirti | sebep | çözüm |
|---|---|---|
| Müşteride eski sürüm | npx paket ağacı cache'i | kurulumda `--prefer-online`; acil ise `npm cache clean --force` |
| `unauthorized` | anahtar iptal ya da yanlış | `pnpm radar key list` ile durumu görün |
| `quota_exceeded` | aylık kota | planı yükseltin ya da `--quota` ile elle artırın |
| `scan_too_large` | paket tek-tarama sınırı | `target_items` düşürün ya da planı yükseltin |
| Tarama `collecting`'te asılı | MCP süreci öldü | sunucu açılışta yarım taramaları `failed` işaretler |
| Sonuç `partial` | `partial_reason` alanına bakın | genelde cluster chunk hatası ya da hedefin altında toplama |
| Tarama hiç başlamıyor | Chrome yok ya da profil başka Chrome'da açık | `browser_failed` sebebi döner |

Tarama durumunu D1'den görmek:

```bash
cd apps/api && wrangler d1 execute reddit-radar --remote \
  --command="SELECT id,status,received,classified,failures,partial_reason FROM scans ORDER BY created_at DESC LIMIT 10"
```

## Saklama

Ham Reddit metni tarama biter bitmez R2'den silinir; süresi dolmuşlar için
ayrıca 48 saatlik süpürme var (`RADAR_RAW_RETENTION_HOURS`). D1'de metin
**hiç** tutulmaz — yalnız kimlik ve skor. Sonuçlar, URL'ler ve alıntılar kalır.

