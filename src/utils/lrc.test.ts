import { describe, expect, it } from 'vitest';
import { activeLineIndex, looksLikeLrc, parseLrc, wordTimings } from './lrc';

describe('parseLrc', () => {
  it('reads line timestamps, sorted, each line ending where the next starts', () => {
    const lines = parseLrc('[00:16.20] Second line\n[00:12.40] First line\n[00:20.00] Third');
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [12.4, 'First line'],
      [16.2, 'Second line'],
      [20, 'Third'],
    ]);
    expect(lines[0].end).toBeCloseTo(16.2);
    expect(lines[1].end).toBeCloseTo(20);
  });

  it('repeats a line that has several timestamps (choruses)', () => {
    const lines = parseLrc('[00:10.00][01:10.00] Chorus\n[00:20.00] Verse');
    expect(lines.map((l) => [l.t, l.text])).toEqual([
      [10, 'Chorus'],
      [20, 'Verse'],
      [70, 'Chorus'],
    ]);
  });

  it('ignores metadata tags and applies [offset:] (positive = lyrics earlier)', () => {
    const lines = parseLrc('[ar:Someone]\n[ti:Song]\n[offset:+500]\n[00:10.00] Hello');
    expect(lines).toHaveLength(1);
    expect(lines[0].t).toBeCloseTo(9.5);
  });

  it('accepts mm:ss:xx and three-digit fractions', () => {
    expect(parseLrc('[01:02:50] A')[0].t).toBeCloseTo(62.5);
    expect(parseLrc('[00:03.250] B')[0].t).toBeCloseTo(3.25);
  });

  it('reads enhanced (word-timed) LRC', () => {
    const [l] = parseLrc('[00:12.00]<00:12.00>Hello <00:12.40>bright <00:12.90>world');
    expect(l.text).toBe('Hello bright world');
    expect(l.words?.map((w) => [w.t, w.text])).toEqual([
      [12, 'Hello'],
      [12.4, 'bright'],
      [12.9, 'world'],
    ]);
  });

  it('recognises LRC text', () => {
    expect(looksLikeLrc('[00:01.00] hi')).toBe(true);
    expect(looksLikeLrc('just words')).toBe(false);
  });
});

describe('activeLineIndex (binary search over line starts)', () => {
  const lines = parseLrc('[00:05.00] a\n[00:10.00] b\n[00:15.00] c\n[00:20.00] d');
  it('is −1 before the first line', () => expect(activeLineIndex(lines, 4.99)).toBe(-1));
  it('switches exactly at a timestamp', () => {
    expect(activeLineIndex(lines, 5)).toBe(0);
    expect(activeLineIndex(lines, 9.999)).toBe(0);
    expect(activeLineIndex(lines, 10)).toBe(1);
  });
  it('stays on the last line after it starts', () => expect(activeLineIndex(lines, 999)).toBe(3));
  it('handles seeking backwards and forwards (pure function of time)', () => {
    expect(activeLineIndex(lines, 17)).toBe(2);
    expect(activeLineIndex(lines, 6)).toBe(0);
    expect(activeLineIndex(lines, 21)).toBe(3);
  });
  it('agrees with a linear scan on a large song', () => {
    const big = parseLrc(Array.from({ length: 500 }, (_, i) => `[${String(Math.floor((i * 3.1) / 60)).padStart(2, '0')}:${((i * 3.1) % 60).toFixed(2).padStart(5, '0')}] line ${i}`).join('\n'));
    for (const t of [0, 1.5, 100.3, 777.7, 1549, 2000]) {
      let lin = -1;
      for (let i = 0; i < big.length; i++) if (big[i].t <= t) lin = i;
      expect(activeLineIndex(big, t)).toBe(lin);
    }
  });
});

describe('wordTimings', () => {
  it('uses real word stamps untouched and says so', () => {
    const [l] = parseLrc('[00:12.00]<00:12.00>Hello <00:12.40>world');
    const r = wordTimings(l);
    expect(r.estimated).toBe(false);
    expect(r.words.map((w) => w.t)).toEqual([12, 12.4]);
  });

  it('estimates line-only timing inside the line, in order, and flags it as estimated', () => {
    const [l] = parseLrc('[00:10.00] the quick brown fox, jumps over\n[00:14.00] next');
    const r = wordTimings(l);
    expect(r.estimated).toBe(true);
    expect(r.words.map((w) => w.text)).toEqual(['the', 'quick', 'brown', 'fox,', 'jumps', 'over']);
    expect(r.words[0].t).toBe(10);
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].t).toBeGreaterThan(r.words[i - 1].t);
    expect(r.words.at(-1)!.t).toBeLessThan(14);
  });
});
