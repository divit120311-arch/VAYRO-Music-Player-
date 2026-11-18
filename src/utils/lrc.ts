import type { LyricLine, LyricWord } from '../types/lyrics';
import { syllables } from './phonetic';

/**
 * Lyrics parsers.
 *  - LRC:  [mm:ss.xx] line text   (multiple stamps per line, [offset:±ms], metadata tags)
 *  - Enhanced LRC word stamps:  [00:12.00]<00:12.00>Hello <00:12.40>world
 *  - LRCLIB "Lyricsfile" YAML (lines[].start_ms / end_ms / words[].start_ms)
 */

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_STAMP = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;
const HAS_WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/;

function toSeconds(min: string, sec: string) {
  return Number(min) * 60 + Number(sec.replace(':', '.'));
}

export function looksLikeLrc(text: string) {
  return /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(text);
}

export function parseLrc(text: string): LyricLine[] {
  let offset = 0; // LRC [offset:+500] means lyrics should appear 0.5 s EARLIER
  const raw: { t: number; text: string; words?: LyricWord[] }[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const off = line.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = Number(off[1]) / 1000;
      continue;
    }
    const stamps: number[] = [];
    STAMP.lastIndex = 0;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = STAMP.exec(line)) && m.index === lastEnd) {
      stamps.push(toSeconds(m[1], m[2]));
      lastEnd = STAMP.lastIndex;
    }
    if (!stamps.length) continue; // metadata ([ar:], [ti:]…) or junk
    const body = line.slice(lastEnd);
    // enhanced word stamps
    let words: LyricWord[] | undefined;
    if (HAS_WORD_STAMP.test(body)) {
      words = [];
      const parts = body.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
      let cur: number | null = null;
      for (const p of parts) {
        const wm = p.match(/^<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>$/);
        if (wm) cur = toSeconds(wm[1], wm[2]);
        else if (cur !== null && p.trim()) words.push({ t: cur, text: p.trim() });
      }
      if (!words.length) words = undefined;
    }
    const clean = body.replace(WORD_STAMP, '').replace(/\s+/g, ' ').trim();
    for (const t of stamps) raw.push({ t: Math.max(0, t - offset), text: clean, words: words?.map((w) => ({ t: Math.max(0, w.t - offset), text: w.text })) });
  }
  return finalize(raw);
}

/** Minimal reader for LRCLIB's Lyricsfile YAML (only the fields we need). */
export function parseLyricsfile(yaml: string): LyricLine[] {
  const out: { t: number; end?: number; text: string; words: LyricWord[] }[] = [];
  let line: (typeof out)[number] | null = null;
  let word: LyricWord | null = null;
  let inWords = false;
  const unquote = (v: string) => {
    v = v.trim();
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        return JSON.parse(v) as string;
      } catch {
        return v.slice(1, -1);
      }
    }
    return v;
  };
  let inLines = false;
  for (const rawLine of yaml.replace(/\r/g, '').split('\n')) {
    if (/^lines:\s*$/.test(rawLine)) {
      inLines = true;
      continue;
    }
    if (!inLines) continue;
    if (/^[A-Za-z_]/.test(rawLine)) break; // next top-level key
    let m: RegExpMatchArray | null;
    if ((m = rawLine.match(/^- text:\s?(.*)$/))) {
      line = { t: 0, text: unquote(m[1]), words: [] };
      out.push(line);
      inWords = false;
      word = null;
    } else if (line && (m = rawLine.match(/^ {2}start_ms:\s*(\d+)/))) line.t = Number(m[1]) / 1000;
    else if (line && (m = rawLine.match(/^ {2}end_ms:\s*(\d+)/))) line.end = Number(m[1]) / 1000;
    else if (line && /^ {2}words:\s*$/.test(rawLine)) inWords = true;
    else if (line && inWords && (m = rawLine.match(/^ {2}- text:\s?(.*)$/))) {
      word = { t: line.t, text: unquote(m[1]) };
      line.words.push(word);
    } else if (word && inWords && (m = rawLine.match(/^ {4}start_ms:\s*(\d+)/))) word.t = Number(m[1]) / 1000;
  }
  return finalize(
    out.map((l) => ({
      t: l.t,
      end: l.end,
      text: l.text,
      words: l.words.filter((w) => w.text.trim()).map((w) => ({ t: w.t, text: w.text.trim() })),
    })),
  );
}

function finalize(raw: { t: number; end?: number; text: string; words?: LyricWord[] }[]): LyricLine[] {
  const sorted = raw.sort((a, b) => a.t - b.t);
  return sorted.map((l, i) => {
    const next = sorted[i + 1]?.t;
    const end = l.end && l.end > l.t ? l.end : next ?? l.t + 6;
    return { t: l.t, end: Math.min(end, next ?? end), text: l.text, words: l.words?.length ? l.words : undefined };
  });
}

/** Index of the line active at time t (−1 before the first line). Binary search. */
export function activeLineIndex(lines: LyricLine[], t: number) {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Word timing for a line. Uses real word stamps when present; otherwise spreads the
 * words across the line's duration weighted by length and flags them as estimated.
 */
export function wordTimings(line: LyricLine): { words: LyricWord[]; estimated: boolean } {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  if (line.words?.length) return { words: line.words, estimated: false };
  if (!tokens.length) return { words: [], estimated: true };
  // leave a little tail so the last word isn't crushed against the next line
  const span = Math.max(0.4, (line.end - line.t) * 0.92);
  // Words take time by syllables, not letters ("strengths" isn't sung longer than "area"; Hindi /
  // Punjabi vowel signs inflate letter counts), and singers breathe at commas and phrase breaks.
  // Weights tuned on 2,281 lines with real word timestamps (LRCLIB): median error 0.18 s → 0.14 s on
  // songs held out of the tuning, vs the old letter-count estimate
  const weights = tokens.map((w) => 0.2 + 0.3 * Math.min(syllables(w), 6));
  const pauses: number[] = tokens.map((w, i) => (i < tokens.length - 1 && /[,;:—–…!?]$/.test(w) ? 0.6 : 0));
  const total = weights.reduce((a, b) => a + b, 0) + pauses.reduce((a, b) => a + b, 0);
  let acc = 0;
  const words = tokens.map((text, i) => {
    const t = line.t + (acc / total) * span;
    acc += weights[i] + pauses[i];
    return { t, text };
  });
  return { words, estimated: true };
}

export function formatLrcTime(s: number) {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}
