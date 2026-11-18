import { parseLrc, wordTimings } from '../utils/lrc';
import { serverAvailable, transcribe } from './transcriber';
import { soundKey } from '../utils/phonetic';
import type { LyricLine, LyricsDoc } from '../types/lyrics';
import type { Track } from '../types/music';

/**
 * Lining up full-song lyrics with a 30-second preview.
 *
 * Apple's previews are cut from somewhere in the middle of the song, so LRCLIB's timestamps (for
 * the full song) don't fit them. We listen to the first seconds of the clip with the local speech
 * recogniser and find where in the song those words are sung:
 *   1. every heard word that also appears in the lyrics votes for an offset ("sung at 1:12 in the
 *      song, heard at 0:04 in the clip" → the clip starts at 1:08);
 *   2. the best few offsets are compared by WORD ORDER: the longest run of heard words that appear
 *      in the same order in the lyrics there. A repeated chorus fits two places by vocabulary, but
 *      the verse around it only fits one;
 *   3. the exact offset is the median over those in-order matches.
 * If no place clearly wins (and the rivals wouldn't show the same lines anyway), nothing is
 * shifted and the lyrics stay as plain text: never guessed.
 */
export interface PreviewAlignment {
  /** seconds into the full song where the preview starts */
  offset: number;
  /** heard words matched in order at that offset */
  matched: number;
  /** words heard */
  heard: number;
  /** the best-supported place, but a close rival exists (e.g. a repeated chorus) */
  guess?: boolean;
}

const LISTEN = 12; // seconds of the clip to transcribe: one short recogniser pass
const CLIP = 30;
// v6: looser acceptance + a small-model pass, so earlier "couldn't line up" results are retried
const CACHE = 'afterglow:preview-offset:v7:';
// words are compared by sound, across scripts and spellings (ਪਿਆਰ = प्यार = pyaar = pyar): see phonetic.ts
const norm = soundKey;

function readCache(id: string): PreviewAlignment | 'none' | null {
  try {
    const v = localStorage.getItem(CACHE + id);
    if (!v) return null;
    return v === 'none' ? 'none' : (JSON.parse(v) as PreviewAlignment);
  } catch {
    return null;
  }
}
function writeCache(id: string, v: PreviewAlignment | 'none') {
  try {
    localStorage.setItem(CACHE + id, v === 'none' ? 'none' : JSON.stringify(v));
  } catch { /* storage full: recompute next time */ }
}
export const cachedAlignment = (id: string) => readCache(id);

interface W { key: string; t: number }

/** longest common subsequence of heard words vs lyric words; returns the matched pairs */
function lcs(h: W[], l: W[]) {
  const n = h.length;
  const m = l.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = h[i].key === l[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: [W, W][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (h[i].key === l[j].key) {
      pairs.push([h[i], l[j]]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** the lines shown during part of the clip (clip seconds from → to), as text, for a given offset */
const shownText = (lines: LyricLine[], offset: number, from = 0, to = CLIP) =>
  lines.filter((l) => l.end > offset + from && l.t < offset + to && l.text.trim()).map((l) => norm(l.text)).join('|');

// words too common to place a clip in a song (they appear everywhere in every lyric)
const FILLER = new Set(
  (
    'the a an and or but so to of in on at for with from by it its is are was were be been am i im me my mine you your youre ' +
    'yours we us our he she his her they them their this that these those what when where who how why not no yes yeah oh ooh ' +
    'ah uh hey la na da baby like just got get gonna wanna dont cant its all can will would do did does go one up down out now ' +
    'then if as too ill ive id know ya yo mmm ' +
    // Hindi / Punjabi function words: they occur in every line, so they can't place a clip either
    'hai hain main mein mai me tu tun tum ki ka ke ko se te di de ne ho je vich ve ni nahi nai haan jo ae ah ek koi kya kyun ' +
    'mera meri mere tera teri tere sada sadi tuhada mainu tainu'
  )
    .split(' ')
    .map((w) => soundKey(w)),
);
const meaningful = (k: string) => k.length >= 3 && !FILLER.has(k);

export function scoreAlignment(heard: W[], lyric: W[], lines: LyricLine[], wholeClip = true) {
  // only meaningful words place a clip: common filler matches everywhere and produced a confident
  // wrong answer in testing (Yellow: "you", "all", "the" agreed on 0:25; the clip starts at 0:43)
  const usable = heard.filter((h) => meaningful(h.key));
  const lyr = lyric.filter((l) => meaningful(l.key));
  if (usable.length < 4) return null;
  // 1. vocabulary votes for offsets (0.5 s bins, smeared: line-level lyric times are estimates)
  const BIN = 0.5;
  const bins = new Map<number, Set<number>>();
  usable.forEach((h, i) => {
    for (const l of lyr) {
      if (l.key !== h.key) continue;
      const b = Math.round((l.t - h.t) / BIN);
      for (const d of [-2, -1, 0, 1, 2]) {
        const set = bins.get(b + d) ?? new Set<number>();
        set.add(i);
        bins.set(b + d, set);
      }
    }
  });
  // the strongest few candidates, at least 3 s apart
  const ranked = [...bins].map(([b, set]) => ({ off: b * BIN, n: set.size })).sort((x, y) => y.n - x.n);
  const cands: number[] = [];
  for (const r of ranked) {
    if (cands.length >= 6 || r.n < 3) break;
    if (cands.every((c) => Math.abs(c - r.off) > 3)) cands.push(r.off);
  }
  // 2. word order decides; the in-order matches must also agree on the offset
  const span = (usable[usable.length - 1]?.t ?? LISTEN) + 4;
  const scored = cands
    .map((off) => {
      const window = lyr.filter((l) => l.t >= off - 3 && l.t <= off + span);
      const good = lcs(usable, window).filter(([h, l]) => Math.abs(l.t - h.t - off) <= 4);
      const offs = good.map(([h, l]) => l.t - h.t).sort((a, b) => a - b);
      const med = offs[Math.floor(offs.length / 2)] ?? off;
      const spread = offs.length ? offs.map((o) => Math.abs(o - med)).sort((a, b) => a - b)[Math.floor(offs.length / 2)] : 99;
      return { off: med, n: good.length, keys: new Set(good.map(([h]) => h.key)).size, spread };
    })
    .sort((a, b) => b.n - a.n);
  const best = scored[0];
  if (!best) return null;
  const second = scored[1];
  const need = Math.max(4, Math.ceil(usable.length * 0.4));
  // Fast rap trips the recogniser on many words, so 40% is too strict there. A place that many
  // distinct words agree on in order, tightly, with no real rival, is just as conclusive
  // (Timeless: 12 of 37 heard words, spread 0.3 s, no other candidate).
  const unambiguous = best.n >= 8 && best.keys >= 6 && best.spread <= 1 && (!second || second.n <= best.n * 0.4);
  let ok = (best.n >= need || unambiguous) && best.keys >= 3 && best.spread <= 1.5;
  // a rival close behind (a repeated chorus) is acceptable only if, while the singing we heard
  // happens, both places would show exactly the same lines
  // happens, both places would show exactly the same lines. Only decidable once the whole clip has
  // been heard: on a partial listen the two places can diverge later (Royals did, in testing).
  if (ok && second && second.n > best.n * 0.7) {
    const from = usable[0].t;
    const to = usable[usable.length - 1].t + 1;
    ok = wholeClip && shownText(lines, best.off, from, to) === shownText(lines, second.off, from, to);
  }
  return { ok, offset: best.off, matched: best.n, heard: usable.length, need, rival: second?.n ?? 0, spread: +best.spread.toFixed(2), keys: best.keys };
}

/**
 * The song's language, read from the script its lyrics are written in, for the recogniser: a few
 * seconds of a clip aren't enough for it to tell Punjabi from Hindi or Urdu on its own, and a wrong
 * guess gives words in the wrong script/language. Lyrics in English letters: let it detect.
 */
export function languageHint(texts: string[]): string | undefined {
  const all = texts.join(' ');
  if (/[਀-੿]/.test(all)) return 'pa'; // Gurmukhi
  if (/[ऀ-ॿ]/.test(all)) return 'hi'; // Devanagari
  if (/[؀-ۿ]/.test(all)) return 'ur'; // Arabic script (Urdu / Shahmukhi)
  return undefined;
}

/** words recognised in the first `seconds` of a clip (memoised per track+model+length+language) */
const heardMemo = new Map<string, W[]>();
async function hear(track: Track, model: 'base' | 'small', seconds: number, signal: { cancelled: boolean }, language?: string): Promise<W[] | null> {
  const k = `${track.id}|${model}|${seconds}|${language ?? 'auto'}`;
  const memo = heardMemo.get(k);
  if (memo) return memo;
  const job = transcribe(track.streamUrl, { model, startAt: 0, maxSeconds: seconds, language }, () => {}, () => {});
  const poll = setInterval(() => signal.cancelled && job.cancel(), 200);
  let lrc = '';
  try {
    lrc = (await job.promise)?.lrc ?? '';
  } finally {
    clearInterval(poll);
  }
  if (signal.cancelled) return null;
  const heard = wordsOfLrc(lrc);
  heardMemo.set(k, heard);
  return heard;
}

/** timed words of an LRC (a transcription), keyed for matching */
export const wordsOfLrc = (lrc: string): W[] => parseLrc(lrc).flatMap((l) => wordTimings(l).words).map((w) => ({ key: norm(w.text), t: w.t }));

export async function alignPreview(track: Track, doc: LyricsDoc, signal: { cancelled: boolean }): Promise<PreviewAlignment | null> {
  const cached = readCache(track.id);
  if (cached) return cached === 'none' ? null : cached;
  if (!track.streamUrl || !(await serverAvailable())) return null; // the browser engine is too slow for this
  const lyric = doc.lines.flatMap((l) => wordTimings(l).words).map((w) => ({ key: norm(w.text), t: w.t }));
  const language = languageHint(doc.lines.map((l) => l.text));
  // a short first pass is quick; if it can't decide (an instrumental intro, a repeated chorus), a
  // second pass over the whole clip gives more words — and more word order — to decide with
  let result: PreviewAlignment | null = null;
  // the best-supported place even when a rival comes close: synced lyrics that may need a nudge
  // with the Sync buttons beat untimed text
  let guess: ReturnType<typeof scoreAlignment> = null;
  // last resort: the larger model over the whole clip hears fast or mumbled vocals far better
  const passes = [
    { seconds: LISTEN, model: 'base' },
    { seconds: CLIP, model: 'base' },
    { seconds: CLIP, model: 'small' },
  ] as const;
  for (const { seconds, model } of passes) {
    const heard = await hear(track, model, seconds, signal, language);
    if (!heard) return null;
    const s = scoreAlignment(heard, lyric, doc.lines, seconds >= CLIP);
    if (s?.ok && s.offset > -2) {
      result = { offset: Math.max(0, s.offset), matched: s.matched, heard: s.heard };
      break;
    }
    if (s && s.offset > -2 && s.matched >= 4 && s.keys >= 3 && s.spread <= 1.5 && (!guess || s.matched > guess.matched)) guess = s;
  }
  if (!result && guess) result = { offset: Math.max(0, guess.offset), matched: guess.matched, heard: guess.heard, guess: true };
  writeCache(track.id, result ?? 'none');
  return result;
}

// ---------------------------------------------------------------------------------------------
// Timing UNTIMED lyrics by listening.
//
// When the only lyrics are plain text (no timestamps on LRCLIB, or a file's untimed tag), the
// words the recogniser hears are matched to the real lyric words in order (longest common
// subsequence over the meaningful words). Each matched word pins a lyric word to a moment; the
// words in between are spread evenly between those pins, and each line starts at its first word.
// The real lyrics are shown, only their timing comes from listening.
// ---------------------------------------------------------------------------------------------
const WORDS_PER_SEC = 2.5; // typical sung pace, only used beyond the first / last pinned word

export function timePlainLines(heard: W[], texts: string[], clip?: number): LyricLine[] | null {
  const lw: { key: string; line: number }[] = [];
  texts.forEach((text, line) => text.split(/\s+/).forEach((w) => { const key = norm(w); if (key) lw.push({ key, line }); }));
  const mh = heard.filter((h) => meaningful(h.key));
  // lyric words as W with t = their index in lw (lcs only compares keys)
  const ml: W[] = [];
  lw.forEach((w, i) => meaningful(w.key) && ml.push({ key: w.key, t: i }));
  if (mh.length < 4 || ml.length < 4) return null;
  let pairs: [W, W][] = [];
  if (clip) {
    // a clip covers one stretch of the song: find the stretch of lyrics it fits best
    const span = Math.max(40, mh.length * 3);
    for (let s = 0; s < ml.length; s += 8) {
      const p = lcs(mh, ml.slice(s, s + span));
      if (p.length > pairs.length) pairs = p;
      if (s + span >= ml.length) break;
    }
  } else pairs = lcs(mh, ml);
  // drop pins that imply an impossible pace to both neighbours (a stray common word)
  const pace = (a: [W, W], b: [W, W]) => (b[1].t - a[1].t) / Math.max(0.01, b[0].t - a[0].t);
  const sane = (r: number) => r >= 0.15 && r <= 10;
  const pins = pairs.filter((p, i) => {
    const prev = pairs[i - 1];
    const next = pairs[i + 1];
    return (prev && sane(pace(prev, p))) || (next && sane(pace(p, next))) || (!prev && !next);
  });
  if (pins.length < (clip ? 6 : 8) || new Set(pins.map(([h]) => h.key)).size < 4) return null;
  // a time for every lyric word: interpolate between pins, extrapolate at a sung pace beyond them
  const at = new Float64Array(lw.length);
  let k = 0;
  for (let i = 0; i < lw.length; i++) {
    while (k < pins.length - 1 && pins[k + 1][1].t <= i) k++;
    const [ha, la] = pins[k];
    const nb = pins[k + 1];
    if (i <= la.t || !nb) at[i] = ha.t + (i - la.t) / WORDS_PER_SEC;
    else at[i] = ha.t + ((i - la.t) / (nb[1].t - la.t)) * (nb[0].t - ha.t);
  }
  const lines: LyricLine[] = [];
  let wi = 0;
  texts.forEach((text, line) => {
    const first = wi;
    while (wi < lw.length && lw[wi].line === line) wi++;
    if (wi === first || !text.trim()) return;
    const t = Math.max(at[first], (lines[lines.length - 1]?.t ?? -Infinity) + 0.05);
    lines.push({ t, end: 0, text: text.trim() });
  });
  lines.forEach((l, i) => (l.end = lines[i + 1]?.t ?? l.t + 4));
  return clip ? lines.filter((l) => l.end > -8 && l.t < clip + 15) : lines;
}

const PLAIN_CACHE = 'afterglow:preview-plain:v2:';

/** untimed lyrics + a 30-second preview → lines timed to the preview's clock, or null */
export async function timePreviewPlain(track: Track, texts: string[], signal: { cancelled: boolean }): Promise<LyricLine[] | null> {
  try {
    const c = localStorage.getItem(PLAIN_CACHE + track.id);
    if (c) return c === 'none' ? null : (JSON.parse(c) as LyricLine[]);
  } catch { /* recompute */ }
  if (!track.streamUrl || !(await serverAvailable())) return null;
  const language = languageHint(texts);
  let lines: LyricLine[] | null = null;
  for (const model of ['base', 'small'] as const) {
    const heard = await hear(track, model, CLIP, signal, language);
    if (!heard) return null;
    lines = timePlainLines(heard, texts, CLIP);
    if (lines) break;
  }
  try {
    localStorage.setItem(PLAIN_CACHE + track.id, lines ? JSON.stringify(lines) : 'none');
  } catch { /* storage full */ }
  return lines;
}

/** the full-song lyrics moved onto the preview's clock */
export function shiftDoc(doc: LyricsDoc, a: PreviewAlignment, attribution: string): LyricsDoc {
  const lines = doc.lines
    .map((l) => ({
      ...l,
      t: l.t - a.offset,
      end: l.end - a.offset,
      words: l.words?.map((w) => ({ ...w, t: w.t - a.offset })),
    }))
    // keep what's around the clip (lines long before it would only clutter the line lists)
    .filter((l) => l.end > -8 && l.t < 45);
  return { ...doc, kind: 'synced', lines, attribution };
}
