# G2 kapı ölçümü — insan etiketli

Tarih: 2026-09-20T10:48:10.585Z · koşu: `/Users/oguzhankayan/Desktop/reddit-mcp/out/stage1-2026-09-20T10-47-56-509Z.json` · konu: "choosing, paying for, or being frustrated by software tools they use in their business"
Etiketli item: **49** (18 shortlist + 31 elenen örneklem)

## Kapı

| kriter | hedef | ölçülen | |
|---|---|---:|---|
| precision@20 | ≥ 90% | 81.3% (13/16) | ⚠️ yetersiz etiket |
| overall precision | ≥ 85% | 83.3% (15/18) | ❌ |

**Sonuç: ❌ GEÇMEDİ**

## Ayrıntı

| metrik | değer |
|---|---:|
| precision@10 | 80.0% (8/10) |
| precision@20 | 81.3% (13/16) |
| TP / FP (shortlist) | 15 / 3 |
| elenen örneklemde kaçan | 19/31 (61.3%) |
| tahmini recall | 6.7% |

> Recall bir **tahmindir**: elenen 475 item'ın 31'i etiketlendi,
> oradaki pozitif oranı tüm elenenlere yansıtıldı.

## Kim insana daha yakın?

| | insanla uyum |
|---|---:|
| Jev shortlist | 55.1% |
| DeepSeek gümüş | 61.2% |

Kapı tutmadı → rubric yeniden yazılır, eşik kalibre edilir, yeniden ölçülür (v2 §55).
