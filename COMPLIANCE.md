# Reddit Compliance and Legal Notice / Reddit Uyumu ve Yasal Bildirim

**English** · [Türkçe](#türkçe)

---

## English

Reddit Radar accesses Reddit through the user's own browser. It is designed to
stay within Reddit's terms and within normal, human-like use of the site.

### We do not scrape Reddit

- **No HTML scraping.** The project does not parse Reddit HTML pages, does not
  run a headless crawler, and does not use a bot to mass-fetch pages.
- **No bypassing.** It does not defeat bot protections, does not rotate proxies
  or identities to evade blocks, and does not circumvent authentication.
- **No writes.** It never posts or comments, never votes, never sends messages,
  and never performs account actions.
- **No bulk download of user data.** It collects only publicly visible posts for
  the research question at hand.

### How data is actually read

Reddit Radar reads public content from Reddit's own `www.reddit.com/...json`
endpoints **from inside a real, visible, user-controlled browser session and
page context**, exactly as the user's own browser would load a page. This is the
same request the user's browser makes when browsing; there is no separate
crawler infrastructure and no intermediary server.

### Rate limits and volume

- The collector reads Reddit's `x-ratelimit-*` response headers and waits for
  the quota window to reset **before** it would ever receive a `429`.
- Measured in live runs: ~100 requests per ~10 minutes, and a real run of 5,022
  unique items completed in 52 requests with **zero** rate-limit hits.
- Depth per subreddit is naturally capped (~930-1000 unique items); beyond that
  the data is duplicate and is not fetched.

### Data retention and privacy

- Raw Reddit text is deleted after **48 hours** by default
  (`RADAR_RAW_RETENTION_HOURS`). What remains is the URL, the score, and a short
  excerpt.
- The Reddit session cookie is never read, serialized, logged, or transmitted by
  the code; it stays inside the browser profile.
- No data passes through a server operated by this project. Keys travel only
  from the user's machine directly to the providers.

### User responsibility

Collected data is the responsibility of the user. Users must use Reddit Radar in
accordance with Reddit's User Agreement, Reddit's API/developer terms where they
apply, and any other applicable law or platform policy.

### Compliance contact

For **any compliance, legal, privacy, or takedown concern**, contact:

**hi@creativefactory.tr**

We will review and respond.

---

## Türkçe

Reddit Radar, Reddit'e kullanıcının kendi tarayıcısı üzerinden erişir. Reddit
kullanım koşullarına ve sitenin normal, insan benzeri kullanımına uygun kalmak
üzere tasarlanmıştır.

### Reddit'i scrape etmiyoruz

- **HTML kazıma yok.** Proje Reddit HTML sayfalarını ayrıştırmaz, başsız bir
  crawler çalıştırmaz ve toplu sayfa çekmek için bot kullanmaz.
- **Atlama yok.** Bot korumalarını aşmaz, engellerden kaçınmak için proxy ya da
  kimlik döndürmez, kimlik doğrulamayı devre dışı bırakmaz.
- **Yazma yok.** Hiçbir zaman post/yorum göndermez, oy vermez, mesaj atmaz,
  hesap işlemi yapmaz.
- **Toplu kullanıcı verisi indirme yok.** Yalnız eldeki araştırma sorusu için
  herkese açık görünen postları toplar.

### Veri gerçekte nasıl okunuyor

Reddit Radar, herkese açık içeriği Reddit'in kendi `www.reddit.com/...json` uç
noktalarından **gerçek, görünür, kullanıcının denetimindeki bir tarayıcı oturumu
ve sayfa bağlamı içinden** okur; tıpkı kullanıcının tarayıcısının sayfayı
yüklemesi gibi. Bu, kullanıcının tarayıcısının gezinirken yaptığı isteğin
aynısıdır; ayrı bir crawler altyapısı ve arada bir sunucu yoktur.

### Rate limit ve hacim

- Collector, Reddit'in `x-ratelimit-*` yanıt başlıklarını okur ve `429` almadan
  **önce** kota penceresinin sıfırlanmasını bekler.
- Canlı koşularda ölçüldü: ~10 dakikada ~100 istek; 5.022 unique item'lık gerçek
  bir koşu 52 istekle ve **sıfır** rate-limit isabetiyle tamamlandı.
- Subreddit başına derinlik doğal olarak sınırlıdır (~930-1000 unique item);
  sonrası duplicate olduğu için çekilmez.

### Saklama ve gizlilik

- Ham Reddit metni varsayılan olarak **48 saat** sonra silinir
  (`RADAR_RAW_RETENTION_HOURS`). Geriye URL, skor ve kısa alıntı kalır.
- Reddit oturum çerezi kod tarafından hiçbir zaman okunmaz, serialize edilmez,
  loglanmaz ve dışarı gönderilmez; tarayıcı profilinde kalır.
- Hiçbir veri bu projenin işlettiği bir sunucudan geçmez. Anahtarlar yalnız
  kullanıcının makinesinden doğrudan sağlayıcıya gider.

### Kullanıcı sorumluluğu

Toplanan veri kullanıcının sorumluluğundadır. Kullanıcı, Reddit Radar'ı Reddit
Kullanıcı Sözleşmesi'ne, geçerli olduğu yerde Reddit API/geliştirici
koşullarına ve yürürlükteki diğer yasa ya da platform politikalarına uygun
kullanmalıdır.

### Uyum iletişimi

**Her türlü uyum, yasal, gizlilik veya kaldırma (takedown) talebi için:**

**hi@creativefactory.tr**

İnceleyip yanıt vereceğiz.
