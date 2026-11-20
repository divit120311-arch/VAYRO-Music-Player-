/**
 * Devanagari (Hindi) and Gurmukhi (Punjabi) → Latin letters, the way song titles are usually written
 * in Latin ("तुम ही हो" → "tum hi ho", "ਬ੍ਰਾਊਨ ਮੁੰਡੇ" → "braun munde"). Used to look a song read off the
 * screen up in the catalogue and lyrics library, which mostly list these songs in Latin letters.
 * Approximate on purpose: a search key, not a scholarly transliteration.
 */
const CONS: Record<string, string> = {
  // Devanagari
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n',
  त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n', प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  // Gurmukhi
  ਕ: 'k', ਖ: 'kh', ਗ: 'g', ਘ: 'gh', ਙ: 'n', ਚ: 'ch', ਛ: 'chh', ਜ: 'j', ਝ: 'jh', ਞ: 'n', ਟ: 't', ਠ: 'th', ਡ: 'd', ਢ: 'dh', ਣ: 'n',
  ਤ: 't', ਥ: 'th', ਦ: 'd', ਧ: 'dh', ਨ: 'n', ਪ: 'p', ਫ: 'ph', ਬ: 'b', ਭ: 'bh', ਮ: 'm', ਯ: 'y', ਰ: 'r', ਲ: 'l', ਵ: 'v', ੜ: 'r',
  ਸ: 's', ਹ: 'h',
};
/** consonant + nukta (dot below): the Persian / Urdu sounds */
const NUKTA: Record<string, string> = { क: 'q', ख: 'kh', ग: 'gh', ज: 'z', ड: 'r', ढ: 'rh', फ: 'f', य: 'y', ਸ: 'sh', ਖ: 'kh', ਗ: 'gh', ਜ: 'z', ਫ: 'f', ਲ: 'l' };
const VOWEL: Record<string, string> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o',
  ਅ: 'a', ਆ: 'aa', ਇ: 'i', ਈ: 'i', ਉ: 'u', ਊ: 'u', ਏ: 'e', ਐ: 'ai', ਓ: 'o', ਔ: 'au',
};
const SIGN: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o',
  'ਾ': 'a', 'ਿ': 'i', 'ੀ': 'i', 'ੁ': 'u', 'ੂ': 'u', 'ੇ': 'e', 'ੈ': 'ai', 'ੋ': 'o', 'ੌ': 'au',
};
const NASAL = new Set(['ं', 'ँ', 'ੰ', 'ਂ']);
const VIRAMA = new Set(['्', '੍']);
const NUKTA_SIGN = new Set(['़', '਼']);
const ADDAK = 'ੱ'; // Gurmukhi: doubles the next consonant

export const hasIndicScript = (s: string) => /[ऀ-ॿ਀-੿]/.test(s);

export function romanize(text: string): string {
  const ch = [...text.normalize('NFD')];
  let out = '';
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (CONS[c]) {
      let k = CONS[c];
      if (NUKTA_SIGN.has(ch[i + 1] ?? '')) {
        k = NUKTA[c] ?? k;
        i++;
      }
      const next = ch[i + 1] ?? '';
      if (SIGN[next] !== undefined) {
        out += k + SIGN[next];
        i++;
      } else if (VIRAMA.has(next)) {
        out += k;
        i++;
      } else {
        // the inherent "a", dropped at the end of a word (हम → ham, not hama)
        const after = ch[i + 1] ?? '';
        const wordEnd = !after || /[\s\p{P}]/u.test(after);
        out += wordEnd ? k : k + 'a';
      }
    } else if (VOWEL[c]) out += VOWEL[c];
    else if (NASAL.has(c)) out += 'n';
    else if (c === 'ः') out += 'h';
    else if (c === ADDAK) {
      // doubles a plain consonant (ਪੱਗ → pagg); not an aspirated one (ਪਿੱਛੇ → pichhe)
      const n = CONS[ch[i + 1] ?? ''] ?? '';
      if (n.length === 1) out += n;
    }
    else if (NUKTA_SIGN.has(c) || VIRAMA.has(c) || SIGN[c] !== undefined) continue;
    else out += c;
  }
  // "aa" reads as "a" in most Latin song titles (Saathiya / Sathiya both exist; search is fuzzy)
  return out.replace(/aa/g, 'a').replace(/\s+/g, ' ').trim();
}
