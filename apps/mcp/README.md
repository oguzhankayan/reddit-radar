# Reddit Radar

Binlerce Reddit konuşmasını tek tek okumayın. Bir araştırma sorusu sorun,
altında gerçek Reddit kanıtı olan yapılandırılmış sonuç alın.

## Kurulum

```bash
claude mcp add reddit-radar -e RADAR_API_KEY=rr_xxx -- npx -y --prefer-online reddit-radar
```

`--prefer-online` bilerek var: onsuz npm, registry'nin "latest hangi sürüm"
cevabını önbelleğe alıyor ve güncellemeler günlerce gelmeyebiliyor.

Gereken tek şey `RADAR_API_KEY`. **Reddit hesabı, OpenAI/Anthropic/TypeSafe/DeepSeek
anahtarı gerekmez.** Chrome kurulu olmalı — ilk taramada bir pencere açılır.

Anahtar için: https://redditradar.creativefactory.tr

## Kullanım

Claude'a normal cümleyle sorun:

> "Reddit Radar ile küçük SaaS kurucularının müşteri destek araçlarıyla
> yaşadığı tekrar eden sorunları araştır."

Tarama arka planda koşar (5.000 item ≈ birkaç dakika). Claude durumu izler ve
bittiğinde cluster'ları, her birinin altında gerçek Reddit postlarıyla döndürür.

## Tool'lar

| tool | ne yapar |
|---|---|
| `radar_scan` | Taramayı başlatır, anında `scan_id` döner |
| `radar_scan_status` | İlerleme ve durum |
| `radar_results` | Cluster'lar + kapsama bilgisi |
| `radar_evidence` | Bir cluster'ın altındaki gerçek postlar |
| `radar_usage` | Bu ayki kullanım ve kalan kota |
| `radar_cancel` | Koşan taramayı durdurur |
| `radar_export` | Tüm sonuç JSON |
| `radar_scans` | Bu makinedeki taramalar |
| `radar_login` | Opsiyonel; erişim için değil, Reddit kotası için |

## Nasıl çalışır

Reddit verisi yalnız gerçek bir tarayıcıdan alınabiliyor, bu yüzden toplama
**sizin makinenizde** koşar. Sınıflandırma, kümeleme ve sentez sunucuda yapılır.

```
Claude ──MCP──► reddit-radar (yerel)        ──►  Radar API (hosted)
                Chrome · toplama · dedupe        sınıflandırma · sentez
```

## Gizlilik

- Reddit oturum çerezi tarayıcı profilinde kalır; okunmaz, dışarı gönderilmez.
- Ham post metni sunucuda tarama biter bitmez silinir; sonuç ve URL'ler kalır.
- Radar hiçbir zaman post/yorum yazmaz, oy vermez, mesaj göndermez.

