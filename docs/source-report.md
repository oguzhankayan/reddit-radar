# G0 — Source Report (konsolide)

Tarih: 2026-09-20 · Ortam: macOS, Chrome kanalı, TR residential IP
Koşumlar: `source-probe` (headful, tam matris) · `--headless --quick` · `--quick` (kontrol)

## Özet: kapı ✅ geçti, ama planın üç varsayımı yanlış çıktı

| Plan v2 varsayımı | Ölçüm | Sonuç |
|---|---|---|
| `.json` için Reddit login'i **gerekli** (§2, §34, §71) | Logged-out, headful browser → 6/6 endpoint **200 JSON** | ❌ Yanlış. Belirleyici olan login değil, **gerçek browser context'i**. |
| Login'den sonra **headless** çalışılabilir (§35) | headless → **403 challenge**; 20 sn sonra headful → **200 JSON** | ❌ Yanlış. Headless bloklanıyor. |
| `old.reddit` `.json` alternatif kaynak (§6) | 6/6 endpoint → login redirect, 404 | ❌ Logged-out kullanılamaz. |

Referans: aynı URL'ler **curl** ile 403 bot-challenge veriyor. Yani zincir `curl ✗ → headless ✗ → headful ✓`.

## Endpoint matrisi (headful, logged-out)

| endpoint | sonuç | status | items | after | ms |
|---|---|---:|---:|---|---:|
| `/r/SaaS/new.json` | `json` | 200 | 100 | var | 1270 |
| `/r/smallbusiness/new.json` | `json` | 200 | 100 | var | 1126 |
| `/r/SaaS/top.json?t=month` | `json` | 200 | 100 | var | 1370 |
| `/search.json?q=…&t=month` | `json` | 200 | **10** | null | 469 |
| `/r/smallbusiness/search.json?q=…` | `json` | 200 | 100 | var | 1312 |
| `/user/spez/submitted.json` | `json` | 200 | **23** | null | 840 |

`old.reddit.com` aynı 6 endpoint: hepsi `login_required` (404, login redirect).

Not: global `/search.json` yalnız **10** item ve `after: null` döndü — subreddit-scoped search 100 dönerken. Partition planner **subreddit-scoped search'e** yaslanmalı, global search'e değil.

## Pagination

`/r/SaaS/new.json` → **4 sayfa, 400 unique item**, duruş sebebi **`rate_limited`**.

Toplam ~16 istek (12 matris + 4 pagination), istekler arası ~1.1 sn, concurrency 2 → 429.
Rate-limit sınırı kasıtlı olarak aranmadı (plan kuralı); bu 429 normal çalışma sırasında oluştu ve kaydedildi.

## Veri şekli — `RadarItem` eşlemesi doğrulandı

`t3_1wkzma6` örneği üzerinden, tüm alanlar karşılığını buluyor:

`name → id` · `subreddit` · `author` · `title` · `selftext → body` · `created_utc → createdAt` · `score` · `num_comments → commentsCount` · `permalink → url`

Fixture'lar: `tests/fixtures/www_*.json` (6 dosya, 3.1 MB)

## G0 kapı değerlendirmesi

- ✅ JSON geliyor (6/6)
- ✅ Pagination ilerliyor (4 sayfa, 400 unique)
- ✅ Veri şekli `RadarItem`'a oturuyor, fixture'lar kayıtlı
- ❌ Headless kullanılamaz → MCP headful çalışmak zorunda
- ⚠️ **Yeni ana risk: throughput.** Logged-out ~16 istekte 429. 5.000 item hedefi ~50+ başarılı sayfa demek.

## G1'e taşınan açık sorular

1. **Login rate limit'i açıyor mu?** Ölçülmedi. `radar_login`'in gerekçesi artık *erişim* değil *throughput*. İlk G1 ölçümü bu olmalı.
2. Sürdürülebilir istek aralığı nedir (2 sn? 4 sn?) — 429 sonrası backoff ile ölçülecek.
3. Headful pencere MCP arka planında nasıl yaşayacak (ör. ekran dışı konumlandırma).
