# Kararlar ve Ölçümler

Bu dosya "neden böyle" sorusunun cevabı. Her madde bir ölçüme dayanıyor; tahminler
açıkça tahmin diye işaretli. Bir şeyi değiştirmeden önce buraya bakın — çoğu
"iyileştirme" fikri burada bir kez denenip çürütülmüş.

## Veri kaynağı

**Reddit `.json` yalnız gerçek, headful bir tarayıcıdan alınabiliyor.**

```
curl (residential IP)   → 403 bot-challenge
headless Chrome         → 403
headful Chrome          → 200 JSON
```

Bu yüzden toplama merkezîleştirilemez ve saf URL'li (remote) MCP mümkün değil.
Mimarinin hibrit olmasının tek sebebi bu ölçüm.

**Reddit hesabı gerekmiyor.** Logged-out headful tarayıcıdan 6/6 endpoint 200 döndü.
`radar_login` yalnız kota büyütmek için opsiyonel — erişim için değil.

**`old.reddit` alternatif değil** — logged-out 6/6 login redirect + 404.

## Arama parametreleri

Aynı sorgu (`zendesk alternative`), global arama:

| | item | subreddit | sayfalıyor |
|---|---:|---:|---|
| `sort=new` `t=month` | 14 | 12 | hayır |
| `sort=relevance` `t=month` | 13 | 11 | hayır |
| **`sort=relevance` `t=year`** | **100** | **67** | **evet** |

İlk ölçümde `sort=new&t=month` kullanılıp "global arama işe yaramaz" sonucuna
varılmıştı ve tüm strateji subreddit `/new` listing'lerine kurulmuştu. Yanlıştı.
`/new` konusal olarak rastgele: "destek araçları" sorusuna "Fiverr'da dolandırıldım"
getiriyor — Stage 1'e retrieval'ın işi yaptırılıyordu.

**Kanal sırası: global arama → subreddit-scoped arama → listing (yalnız genişlik).**
Sıra değiştirildiğinde aynı soruda top-5 fırsat skoru 60.6'dan 81.0'e çıktı ve
konu kayması bitti.

## Rate limit

Quota-tabanlı, **~100 istek / ~10 dk**. `x-ratelimit-remaining` istek başına tam 1
azalıyor ve **istek aralığından bağımsız** — yavaşlamak hacim kazandırmaz.

Collector kota eşiğine inince 429 beklemeden kendiliğinden durur. Canlı koşuda
52 istekte sıfır 429.

Asıl darboğaz kota değil **listing derinliği**: subreddit başına ~930-1000 item,
sonrası saf duplicate. 20k hedefi sayfa değil **partition** sayısıyla gelir.

## Sınıflandırma rubriği

Üç kez yanlış yapıldı, dördüncüde prospector'ın kanıtlanmış deseniyle yazıldı.

**1. Kriterler sayılır, tarif edilmez.** `"gerçek bir problem"` gibi soyut bir sıfat
Jev'e tahmin yürüttürür; plandan gelen somut durumlar madde madde listelenince
eşleştirir. Soyut kriterlerle precision %79-84'te takıldı ve FP'lerin hepsi
(kariyer tavsiyesi, listicle, "ben şunu yaptım") `negative_signals`'ta
sayılabilecek şeylerdi.

**2. Ağırlıklı toplam KULLANMAYIN.** Beş boyut ayrı sorulup toplanıyordu:

```
"Small MSP in Sydney - Need white label domain registrar"
  problem_match   0.10   ← Jev doğru: aradığımız problem değil
  persona_match   0.07   ← Jev doğru: aradığımız kişi değil
  concrete_detail 0.95   ← doğru ama KONUDAN BAĞIMSIZ
  intent          2.99   ← doğru ama KONUDAN BAĞIMSIZ
  → 0.53, top-20'de BİRİNCİ
```

Jev her soruya doğru cevap verdi; toplam yanlıştı. Konudan bağımsız boyutlar
iyi yazılmış hemen her Reddit postu için yüksektir ve skorun yarısını konuya
bakmadan dağıtır.

**Doğrusu iki soru:** `disqualified` (tek kavramlı kapı) + `fit` (5 kademeli,
tüm spec'i kendi talimatında taşıyan bütünsel skor).

**3. Kapı DAR olmalı.** `negative_signals`'a "genel iş tavsiyesi", "listicle" gibi
maddeler konunca havuzun **%96'sı** eleniyordu. Kapıya yalnız "ne kadar iyi
eşleşirse eşleşsin kullanılamaz" olan şeyler girer (kendi ürününü tanıtma,
satıcı olma). Konu uyuşmazlığı bir **derece** meselesidir, sıralamanın işidir.
Daraltınca %96 → %29.

**4. Kademe metinleri uzunluğu niyetle karıştırmamalı.** Tek cümlelik
"Zendesk alternative?" mümkün olan en iyi kanıtlardan biridir; kısa olduğu
için daha zayıf değildir.

**5. Kota varken skor tabanına gerek yok** — sırala, üstten kotayı al. Ama
`fit >= 2` tabanı ayrıca durur: havuzda konuyla ilgili hiçbir şey yoksa yalnız
kota olsaydı sistem yine "en iyi 20"yi seçer ve alakasız postları evidence diye
sunardı.

## Skorlama

**Ağırlıklar preset'e özeldir.** Tek tablo tüm preset'lere uygulanıyordu ve
SaaS dışındaki her preset'i sakatlıyordu:

```
geo_seo_opportunities üretir : pain_severity, repeated_need, commercial_question,
                               names_category, answer_would_help_others
eski skorlayıcı arardı       : pain_severity, repeated_need, switching_intent,
                               solution_dissatisfaction, workaround, willingness_to_pay
```

Kesişim iki sinyal. Preset'in asıl sinyalleri skora hiç girmiyordu ve "nerede
yemek yesem" sorusunda `pain_severity` doğal olarak sıfır olduğu için skorlar
11-27'ye çöküyordu. Aynı veriyle yeniden hesaplandığında ortalama 19.3 → 44.3,
≥50 skor alan item 17 → 72.

`signal_coverage` **veri kapsaması değildir** — skor ağırlığının ne kadarının
arkasında sinyal olduğudur. Eski adı `coverage` idi ve bir ajan bunu
"Reddit'in yarısı tarandı" diye kullanıcıya yanlış aktardı.

## Batching

Jev tarafındaki tavan **~3.3 çağrı/sn ve eşzamanlılıktan bağımsız** (12 ve 40
eşzamanlıda aynı ölçüldü). Dokümandaki 1.200 istek/dk pratikte karşılık bulmuyor.
Yani bağlayıcı kısıt token maliyeti değil **çağrı sayısı**.

| item/çağrı | hızlanma | maliyet | karar uyumu | shortlist örtüşme |
|---:|---:|---:|---:|---:|
| 5 | 2.9x | %71 | %94.8 | %100 |
| **10** | **5.6x** | **%67** | %93.0 | **%100** |
| 20 | 10.6x | %66 | %93.8 | %80 ← contamination |

**10 seçildi.** 20'de cross-item contamination sıralamayı bozuyor. Karar uyumu
%93 (konan %95 barajının altında) ama shortlist örtüşmesi %100 — ürünün metriği
precision@**top-k**, yani sıralama. Üretimde ölçülen hızlanma 9.8x.

## Süre

Ölçüm: 1.255 item → 54 sn · 1.400 item → 84 sn (sınıflandırma 1.190'da, yani
toplamayla **paralel**). Toplama ~17-21 item/sn.

| hedef | süre |
|---:|---|
| 1.000 | ~3 dk |
| 5.000 | ~7 dk |
| 10.000 | ~22 dk (10 dk kota beklemesi dahil) |
| 20.000 | ~42 dk (20 dk kota beklemesi dahil) |

Sıçramanın sebebi gerçek: ~9.500 item'da bir 10 dakikalık Reddit kota penceresi.

Eski tahmin formülü (`hedef/200`) batching öncesi ölçüme dayanıyordu ve 4 kat
fazla süre söylüyordu — ürün olduğundan yavaş görünüyordu.

## Dil

**Jev diller arası çalışır.** İngilizce kriterlerle Türkçe postlar doğru sıralandı:

```
fit=3.10  Havalimanı Bölgesinde Restoran Tavsiyesi   ← tam hedef
fit=1.03  "Her şeye karışılması normal oldu"          ← konu dışı
fit=0.01  Liseden beri bitmeyen iletişim              ← alakasız
```

Kriterleri çevirmek fayda getirmez, rubriği dil başına yeniden kalibre etme
yükü getirir. **Kriterler İngilizce kalır.**

Belirleyici olan tek şey **arama sorgularının dili** — Reddit araması metni
harfiyen eşleştirir, İngilizce sorgu Türkçe postu bulmaz. `language` parametresi
derleyiciye **önceden** verilmeli; planı derledikten sonra alanı değiştirmek
sorguları değiştirmez.

Otomatik çıkarım tutarsız: sorguları doğru üretip `language` alanını yanlış
etiketleyebiliyor. Kritikse açıkça verin.

## Güvenlik

**Prompt injection:** Reddit metni LLM'e nonce'lu sınır içinde gider
(`<UNTRUSTED_REDDIT_CONTENT id="a7f3c2">`). Sabit etiket yeterli değildi — post
metnine kapanış etiketi yazarak bloktan kaçılabiliyordu. Jev tarafında zaten
yapısal güvenlik var: kriter güvenilir kanal, state düşman kanal, dönüş tipli
bir değer.

**Path traversal:** `scan_id` şema seviyesinde `^scan_[a-z0-9]{1,32}$`. Bu olmadan
`radar_forget({scan_id:"../../..", scope:"all"})` `/Users` dizinini siliyordu.

**Cookie:** kod Reddit oturumunu `context.cookies()`/`storageState()` ile okumaz,
serialize etmez, loglamaz. Playwright teknik olarak erişebilir; bu bir kod
disiplini kuralıdır, mutlak izolasyon garantisi değil.

## Kalite kapıları

| kapı | hedef | sonuç |
|---|---|---|
| G1 collector | ≥1.000 unique, stop koşulları | 5.022 unique / 52 istek / **0 adet 429** |
| G2 Stage 1 | precision@20 ≥ %90 | **%90.0** (18/20), 49 insan etiketi |
| G3 uçtan uca | top-20 evidence'ın ≥18'i değerli | **20/20** |

G3 iki kez düştü (12/20) — sebebi Jev değil, yukarıdaki retrieval ve skorlama
hatalarıydı.

**Uyarı:** kapılar tek konuda, tek koşuda geçti. İkinci bir konuyla
tekrarlanmadan "precision@20 ≥ %90" pazarlama iddiası kurulmamalı.

## Bilinen eksikler

- **Yorumlar toplanmıyor.** V1 yalnız post. 481 yorumlu bir thread'de asıl değer
  yorumlarda olabilir; "insanlar hangi ürünü övüyor" soruları bu yüzden eksik cevaplanır.
- **Subreddit kuralları ve üye sayısı toplanmıyor.** "Buraya yazabilir miyim"
  sorusunu ürün cevaplayamaz.
- **Stage 1 kesme oranı** kendi etiket setinde kalibre edildi; ayrık örneklemde
  doğrulanmadı (`bench --offset` bunun için var).
- **Ödeme yok.** Kota tanımlı ve zorlanıyor ama `item_quota` elle ayarlanan bir sayı.
- **`packages/core/src/scan.ts`** (local-only tarama) artık MCP tarafından
  kullanılmıyor; CLI hâlâ onu çağırıyor. İki yol paralel duruyor.
