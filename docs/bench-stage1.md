# G2 — Stage 1 Benchmark

Tarih: 2026-09-20T10:47:56.501Z · örneklem: 500 item · konu: "choosing, paying for, or being frustrated by software tools they use in their business"

> **Referans gümüş standarttır, insan ground truth DEĞİLDİR.** Etiketler `deepseek-flash`
> tarafından bağımsız üretildi. Aşağıdaki precision/recall "Jev ile DeepSeek ne kadar
> anlaşıyor"u ölçer, "Jev ne kadar doğru"yu değil. Gerçek kapı ölçümü için
> `docs/bench-top20-validate.md` insan tarafından doldurulmalıdır.

## Jev ↔ gümüş etiket karşılaştırması

| metrik | değer |
|---|---:|
| precision | 80.0% |
| recall | 55.6% |
| precision@20 (gümüşe göre) | 90.0% |
| TP / FP / FN / TN | 20 / 5 / 16 / 459 |
| Jev shortlist oranı | 5.0% |
| gümüş shortlist oranı | 7.2% |

## Kriter bazında uyum

| kriter | uyum |
|---|---:|
| problem_match | 95.2% |
| persona_match | 74.0% |
| excluded | 92.0% |
| concrete_detail | 39.6% |

## Maliyet ve hız

| | Jev | DeepSeek (gümüş) |
|---|---:|---:|
| çağrı | 500 | 500 |
| hata | 0 | 0 |
| girdi token | 505969 | 314275 |
| maliyet | $0.0213 | $0.1081 |
| süre | 129.6 sn | — |

Jev: **$0.0425 / 1k item**, 1012 token/item.
20.000 item Stage 1 → **$0.85**, 
40 eşzamanlı ile ~86 dk.
