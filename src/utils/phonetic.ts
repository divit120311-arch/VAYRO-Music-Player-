import { romanize } from './translit';

/**
 * A "sound key" for a word, so the same word matches however it's written:
 *   - any script → English letters (Gurmukhi/Devanagari via translit; accents dropped)
 *   - spellings that sound alike are folded together:
 *       long vowels  aa → a, ee/ii → i, oo/uu → u      (pyaar = pyar, deewana = diwana)
 *       aspiration   bh dh gh jh kh ph th → b d g j k f t (Roman Hindi/Punjabi drop the h freely)
 *       letters      w → v, z → j, q → k, c(k) → k       (zindagi = jindagi, wafa = vafa)
 *       doubled letters collapse                          (gall = gal, pakka = paka)
 * Used to match what the speech recogniser heard (often in Gurmukhi/Devanagari) against lyrics
 * typed in English letters, and vice versa. Never shown to the listener.
 */
export function soundKey(word: string): string {
  let s = romanize(word)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, ''); // accents
  // keep letters and digits of any script (Arabic/Cyrillic/CJK words still match themselves)
  s = s.replace(/[^\p{L}\p{N}]+/gu, '');
  if (!/^[a-z0-9]+$/.test(s)) return s; // not Latin after romanizing: compare as written
  s = s
    .replace(/ph/g, 'f')
    .replace(/([bdgjkt])h/g, '$1')
    .replace(/ck/g, 'k')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/ee|ii/g, 'i')
    .replace(/oo|uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1')
    // the short "a" inside a word is often dropped in Hindi/Punjabi spelling (zindagi = zindgi):
    // drop it between two consonants (past the first letter) on both sides of every comparison
    .replace(/(?<=.[^aeiou])a(?=[^aeiou])/g, '');
  return s;
}

/** rough syllable count: vowel groups in the word's English-letter form (at least 1) */
export function syllables(word: string): number {
  const s = romanize(word).toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '');
  if (!s) return Math.max(1, Math.round([...word].length / 3)); // other scripts: ~3 characters per syllable
  const groups = s.match(/[aeiouy]+/g)?.length ?? 1;
  // a silent final "e" in English ("make", "time") isn't its own syllable
  const silentE = groups > 1 && /[^aeiouy]e$/.test(s) && !/le$/.test(s) ? 1 : 0;
  return Math.max(1, groups - silentE);
}
