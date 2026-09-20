/**
 * Sorunun dilini metinden çıkar.
 *
 * Neden gerekli: `language` parametresi doğru çalışıyor ama KULLANICININ ya da
 * ajanın onu vermesi gerekiyordu. Kullanıcı "İstanbul'daki restoranları bul"
 * diye yazıp Türkçe sonuç bekliyor; ajanın bunu parametreye çevirmesini ummak
 * ürünü kullanıcıya talimat ezberletmeye bağlar.
 *
 * Basit ve dürüst bir sezgi: yalnız yüksek güvenli durumlarda karar verir,
 * emin değilse `undefined` döner ve derleyicinin kendi çıkarımına bırakır.
 */
const MARKERS: Record<string, { chars?: RegExp; words: RegExp }> = {
  tr: {
    chars: /[çğıöşüÇĞİÖŞÜ]/,
    words: /\b(bul|bana|için|nasıl|nedir|hangi|insanlar|kişiler|arayan|isteyen|hakkında|şikayet|öneri|müşteri|satabileceğim|yapabileceğim|konuşan|diyor)\b/i,
  },
  de: { chars: /[äöüßÄÖÜ]/, words: /\b(finde|suchen|über|welche|menschen|kunden|beschwerden)\b/i },
  es: { chars: /[ñáéíóúÁÉÍÓÚ]/, words: /\b(buscar|encontrar|sobre|quiénes|personas|clientes|quejas)\b/i },
  fr: { chars: /[àâçéèêëîïôûùüÿœ]/i, words: /\b(trouver|cherche|sur|quels|personnes|clients|plaintes)\b/i },
  pt: { chars: /[ãõçáéíóúâê]/i, words: /\b(encontrar|buscar|sobre|quais|pessoas|clientes|reclamações)\b/i },
  it: { chars: /[àèéìòù]/i, words: /\b(trovare|cerca|riguardo|quali|persone|clienti|lamentele)\b/i },
}

/** İngilizce olduğunu gösteren yaygın kelimeler. */
const EN = /\b(find|people|who|asking|looking|complaining|about|need|want|posts|threads|customers)\b/i

export function detectLanguage(text: string): string | undefined {
  if (!text || text.length < 8) return undefined

  for (const [code, m] of Object.entries(MARKERS)) {
    const hasChars = m.chars?.test(text) ?? false
    const hasWords = m.words.test(text)
    // İki sinyal birden: tek bir aksanlı harf ya da tek kelime yeterli değil.
    if (hasChars && hasWords) return code
    // Aksansız yazılmış olabilir ("Istanbulda restoran bul") — kelime sinyali
    // güçlüyse ve İngilizce işaret yoksa yine karar ver.
    if (hasWords && !EN.test(text)) {
      const hits = text.match(m.words)?.length ?? 0
      if (hits >= 1 && (text.match(m.words) ?? []).length >= 1 && countMatches(text, m.words) >= 2) return code
    }
  }
  return undefined
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) ?? []).length
}
