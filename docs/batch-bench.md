# Stage 1 batching benchmark

Tarih: 2026-09-20T10:07:09.716Z · 100 item

Referans (tek tek): **18526 ms**, 100 çağrı, $0.0031

| item/çağrı | süre | hızlanma | çağrı | maliyet | karar uyumu | MAD | shortlist örtüşme | parse hata |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 6350 ms | 2.9x | 20 | $0.0022 | 94.8% | 0.054 | 100% | 0 |
| 10 | 3331 ms | 5.6x | 10 | $0.0021 | 93.0% | 0.056 | 100% | 0 |
| 20 | 1741 ms | 10.6x | 5 | $0.0020 | 93.8% | 0.058 | 80% | 0 |

**Karar ölçütü:** shortlist örtüşmesi ≥ %90 ve karar uyumu ≥ %95 olmadan benimsenmez —
hız uğruna sıralama bozulursa ürünün tek gerçek metriği (precision@top-k) çöker.
