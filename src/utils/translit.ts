/**
 * Devanagari → Roman Hindi ("Hinglish" spelling: kaise, tujhse, dil, aankhein).
 *
 * Display-only transliteration — never translation. The stored lyrics keep their original script;
 * this only changes how they're shown when the user turns on "Hindi in Roman letters".
 *
 * Spelling follows common Hinglish rather than ISO-15919 (no diacritics): long ā → "aa",
 * ī → "ee", ū → "oo", श/ष → "sh", छ → "chh". The inherent vowel ("schwa") is dropped at the end of
 * words and in the classic V·C·a·C·V position, scanning right-to-left — so दिल → dil (not "dila"),
 * तुझसे → tujhse, समझना → samajhna.
 */
const CONS: Record<string, string> = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', ळ: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h',
  // precomposed nukta forms
  क़: 'q', ख़: 'kh', ग़: 'gh', ज़: 'z', ड़: 'd', ढ़: 'rh', फ़: 'f', य़: 'y',
};
const NUKTA: Record<string, string> = { क: 'q', ख: 'kh', ग: 'gh', ज: 'z', ड: 'd', ढ: 'rh', फ: 'f', य: 'y' };
const VOWELS: Record<string, string> = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o', ऍ: 'e' };
const MATRAS: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॅ': 'e', 'ॉ': 'o' };
const VIRAMA = '्';
const DIGITS = '०१२३४५६७८९';

interface Unit {
  kind: 'C' | 'V' | 'X';
  text: string;
  /** consonant: explicit vowel ('' = virama), or null = inherent "a" */
  vowel: string | null;
  /** trailing nasal / visarga */
  tail: string;
}

function units(word: string): Unit[] {
  const out: Unit[] = [];
  const ch = [...word.normalize('NFC')];
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (CONS[c] !== undefined) {
      let text = CONS[c];
      if (ch[i + 1] === '़') {
        text = NUKTA[c] ?? text;
        i++;
      }
      out.push({ kind: 'C', text, vowel: null, tail: '' });
    } else if (VOWELS[c] !== undefined) out.push({ kind: 'V', text: VOWELS[c], vowel: '', tail: '' });
    else if (MATRAS[c] !== undefined && out.length && out[out.length - 1].kind === 'C') out[out.length - 1].vowel = MATRAS[c];
    else if (c === VIRAMA && out.length && out[out.length - 1].kind === 'C') out[out.length - 1].vowel = '';
    else if ((c === 'ं' || c === 'ँ') && out.length) out[out.length - 1].tail += 'n';
    else if (c === 'ः' && out.length) out[out.length - 1].tail += 'h';
    else if (DIGITS.includes(c)) out.push({ kind: 'X', text: String(DIGITS.indexOf(c)), vowel: '', tail: '' });
    else if (c === '।' || c === '॥') out.push({ kind: 'X', text: '.', vowel: '', tail: '' });
    else out.push({ kind: 'X', text: c, vowel: '', tail: '' });
  }
  return out;
}

const hasVowel = (u: Unit | undefined, dropped: Set<number>, i: number) =>
  !!u && (u.kind === 'V' || (u.kind === 'C' && (u.vowel ? true : u.vowel === null && !dropped.has(i))));

function romanizeWord(word: string): string {
  const us = units(word);
  const dropped = new Set<number>();
  const letters = us.map((u, i) => (u.kind === 'X' ? -1 : i)).filter((i) => i >= 0);
  const last = letters[letters.length - 1];
  // schwa deletion, right to left
  for (let k = letters.length - 1; k >= 0; k--) {
    const i = letters[k];
    const u = us[i];
    if (u.kind !== 'C' || u.vowel !== null || u.tail) continue;
    if (i === last) {
      if (letters.length > 1) dropped.add(i); // word-final: दिल → dil (but keep single letters: न → na)
      continue;
    }
    const prev = letters[k - 1];
    const next = letters[k + 1];
    if (prev !== undefined && next !== undefined && hasVowel(us[prev], dropped, prev) && us[next].kind === 'C' && hasVowel(us[next], dropped, next)) dropped.add(i);
  }
  // Hinglish spelling at the end of a word: long vowels are written short (itna, koi, hi, tu)
  // and -ें is written "ein" (mein, aankhein); a long ā before another vowel too (duaon)
  const SHORT: Record<string, string> = { aa: 'a', ee: 'i', oo: 'u' };
  const vowelOf = (u: Unit) => (u.kind === 'C' ? u.vowel : u.kind === 'V' ? u.text : null);
  let s = '';
  us.forEach((u, i) => {
    // (a lone vowel letter keeps its length: आ = "aa")
    const final = i === last && (u.kind === 'C' || letters.length > 1);
    let v = vowelOf(u);
    if (v !== null && final) {
      if (v === 'e' && u.tail === 'n') {
        v = 'ei';
      } else if (SHORT[v] && !u.tail) v = SHORT[v];
    }
    if (v === 'aa' && u.kind === 'V' && us[i + 1]?.kind === 'V') v = 'a'; // दुआओं → duaon
    if (u.kind === 'C') s += u.text + (v === null ? (dropped.has(i) ? '' : 'a') : v);
    else if (u.kind === 'V') s += v ?? u.text;
    else s += u.text;
    s += u.tail;
  });
  return s;
}

const DEVA = /[ऀ-ॿ]/;
const DEVA_WORD = /[ऀ-ॿ]+/g;
const GURU = /[਀-੿]/;
const GURU_WORD = /[਀-੿]+/g;

export const hasDevanagari = (text: string) => DEVA.test(text);
export const hasGurmukhi = (text: string) => GURU.test(text);
/** Hindi or Punjabi script: lyrics that can be shown in Roman letters */
export const hasIndicScript = (text: string) => DEVA.test(text) || GURU.test(text);

/**
 * Gurmukhi (Punjabi) → the equivalent Devanagari, so the Hindi rules above romanize it.
 * Unicode lays Gurmukhi out letter-for-letter like Devanagari, 0x100 higher (ਕ U+0A15 ↔ क U+0915,
 * vowel signs, virama, nukta letters and digits alike). Punjabi-only signs are handled first:
 *   ੱ addak  doubles the next consonant (ਪੱਕਾ → पक्का → pakka)
 *   ੰ tippi  is a nasal, like the bindi/anusvara (ਮੁੰਡਾ → मुंडा → munda)
 *   ੲ ੳ      vowel carriers (they take the vowel sign that follows them)
 */
function gurmukhiToDevanagari(word: string): string {
  const ch = [...word.normalize('NFC')];
  let out = '';
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    const code = c.codePointAt(0)!;
    if (c === 'ੱ') {
      // addak: double the following consonant (consonant + virama + consonant)
      const next = ch[i + 1];
      if (next && next >= 'ਕ' && next <= 'ਹ') out += String.fromCodePoint(next.codePointAt(0)! - 0x100) + '्';
      continue;
    }
    // NFC splits ਸ਼ into ਸ + nukta; the Hindi rules only know nukta on क ख ग ज ड ढ फ य, so map it here
    if (c === 'ਸ' && ch[i + 1] === '਼') { out += 'श'; i++; continue; }
    // ਿ + ਆ after a consonant is a "ya" glide: ਪਿਆਰ → प्यार → pyaar (not "piaar")
    if (c === 'ਿ' && ch[i + 1] === 'ਆ' && out && /[क-ह]$/.test(out)) { out += '्या'; i++; continue; }
    if (c === 'ੰ') { out += 'ं'; continue; } // tippi → anusvara
    if (c === 'ੲ') { out += 'इ'; continue; } // iri carrier
    if (c === 'ੳ') { out += 'उ'; continue; } // ura carrier
    if (code >= 0x0A00 && code <= 0x0A6F) out += String.fromCodePoint(code - 0x100);
    else out += c; // ੴ and anything without a counterpart stays as it is
  }
  return out;
}

/**
 * Romanize every Devanagari (Hindi) or Gurmukhi (Punjabi) run in `text`; anything else (English,
 * punctuation) is untouched.
 */
export function romanize(text: string): string {
  if (!DEVA.test(text) && !GURU.test(text)) return text;
  let s = text;
  if (GURU.test(s)) s = s.replace(GURU_WORD, (w) => romanizeWord(gurmukhiToDevanagari(w)));
  if (DEVA.test(s)) s = s.replace(DEVA_WORD, (w) => romanizeWord(w));
  return s;
}
