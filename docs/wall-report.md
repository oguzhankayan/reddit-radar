# Rate-limit duvar raporu (logged-out, headful, concurrency 1)

Tarih: 2026-09-20 · origin `www.reddit.com` · 120 istek · 3 subreddit partition seti

## Sonuç: duvar beklediğimiz yerde değil — asıl kısıt kota değil, **listing derinliği**

429 **hiç görülmedi**. Bunun yerine limitin şekli header'lardan doğrudan okundu.

### Kota: ~100 istek / ~10 dk, istek başına tam 1 azalıyor

`x-ratelimit-remaining` seyri (her 10. istek):

```
#1:92  #11:82  #21:72  #31:62  #41:52  #51:42  #61:32  #71:22  #81:94  #91:84  #101:74  #111:64
```

- Aralıktan (1000 ms / 2500 ms) **bağımsız** olarak istek başına 1 azalıyor → limit **quota-tabanlı**, rate-tabanlı değil. Yavaşlamak toplam hacmi artırmaz.
- #71 → #81 arasında 22'den 94'e sıçradı → **pencere yenilendi**, yaklaşık 10 dakikalık pencere.
- Pratik tavan: **~100 istek / 10 dk ≈ 10 istek/dk**, istek başına 100 item → teorik **~10.000 item / pencere**.

### Gerçek darboğaz: `/new.json` listing'i subreddit başına ~1000 item'da tükeniyor

| basamak | aralık | istek | yeni unique |
|---|---:|---:|---:|
| 1 | 1000 ms | 60 | **4.887** |
| 2 | 2500 ms | 60 | **1** |

120 isteğin **68'i sıfır yeni item** döndürdü. Basamak 2 tamamen boşa gitti: 60 istek → 1 item.

Subreddit başına toplanan: SaaS 994 · smallbusiness 1001 · Entrepreneur 928 · startups 995 · marketing 970 — hepsi ~1000'de duruyor.

## Ürün açısından ne demek

1. **Planın "tek listing yetmez, partition şart" tezi ölçümle doğrulandı** (v2 §15).
2. **Sayfa sayısını değil partition sayısını artırmak gerekir.** 20k hedefi ≈ **20–25 ayrı partition** (subreddit × query), partition başına ~10 sayfa tavanı.
3. **Kota kıt kaynak; derinliği tükenmiş listing'e istek atmak doğrudan israf.** `no_new_unique` durma koşulu bu yüzden opsiyonel değil, zorunlu.
4. 20k item ≈ 200+ istek ≈ **2–3 pencere ≈ 20–30 dakika**. 5k tek pencerede rahat.
5. Login'in kotayı büyütüp büyütmediği hâlâ ölçülmedi — logged-out zaten yeterli olduğu için aciliyeti düşük.

## Toplanan veri

`tests/fixtures/collected.ndjson` — **4.888 unique item**, 4.888 unique ID (çakışma yok), %98'inde 50+ karakter gövde, ortalama ~262 token/item.
