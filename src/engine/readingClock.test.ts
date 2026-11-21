import { describe, expect, it } from 'vitest';
import { ReadingClock } from './readingClock';

/**
 * A simulated Spotify display: the song is at `start` s at time 0 and plays at normal speed (with
 * pauses / seeks applied by the tests). `shown(t)` is the whole second the display shows at t (ms).
 */
class Song {
  private base: number;
  private baseAt = 0;
  playing = true;
  constructor(start: number) {
    this.base = start;
  }
  pos(t: number) {
    return this.playing ? this.base + (t - this.baseAt) / 1000 : this.base;
  }
  shown(t: number) {
    return Math.floor(this.pos(t));
  }
  pause(t: number) {
    this.base = this.pos(t);
    this.baseAt = t;
    this.playing = false;
  }
  resume(t: number) {
    this.baseAt = t;
    this.playing = true;
  }
  seek(t: number, to: number) {
    this.base = to;
    this.baseAt = t;
  }
}

/** read the display every `every` ms from `from` to `to`; returns the clock's error at the end */
function run(clock: ReadingClock, song: Song, from: number, to: number, every: number, misread?: (t: number) => number | null) {
  let t = from;
  for (; t <= to; t += every) {
    const bad = misread?.(t);
    clock.observe(bad ?? song.shown(t), t);
  }
  return clock.predict(t) - song.pos(t);
}

describe('ReadingClock (lyrics follow a whole-seconds time display)', () => {
  it('locks on to within a fraction of a second from four readings a second', () => {
    const c = new ReadingClock();
    const err = run(c, new Song(83.37), 0, 6000, 250);
    expect(Math.abs(err)).toBeLessThan(0.15);
  });

  it('stays accurate on a slow computer (one late reading every 1.7 s)', () => {
    const c = new ReadingClock();
    const err = run(c, new Song(40.81), 0, 30_000, 1700);
    expect(Math.abs(err)).toBeLessThan(0.5);
    expect(c.state?.playing).toBe(true);
  });

  it('does not drift over a long song', () => {
    const c = new ReadingClock();
    const err = run(c, new Song(5.5), 0, 240_000, 537);
    expect(Math.abs(err)).toBeLessThan(0.1);
  });

  it('readings that always land at the same moment in the second still stay within 0.3 s', () => {
    // every 500 ms exactly: the readings only ever see two points of each second, so ±0.25 s is the
    // best anything can know — the clock must not do worse
    const c = new ReadingClock();
    expect(Math.abs(run(c, new Song(5.5), 0, 60_000, 500))).toBeLessThanOrEqual(0.3);
  });

  it('pauses when the number stands still and resumes from the right place', () => {
    const c = new ReadingClock();
    const s = new Song(60.2);
    run(c, s, 0, 5000, 250);
    s.pause(5100);
    run(c, s, 5250, 9000, 250);
    expect(c.state?.playing).toBe(false);
    expect(Math.abs(c.predict(9000) - s.pos(9000))).toBeLessThanOrEqual(0.5);
    s.resume(9100);
    const err = run(c, s, 9250, 14_000, 250);
    expect(c.state?.playing).toBe(true);
    expect(Math.abs(err)).toBeLessThan(0.3);
  });

  it('follows a seek forward and a seek backward (after a second reading confirms it)', () => {
    const c = new ReadingClock();
    const s = new Song(30);
    run(c, s, 0, 4000, 250);
    s.seek(4100, 150.4);
    expect(Math.abs(run(c, s, 4250, 7000, 250))).toBeLessThan(0.3);
    s.seek(7100, 12.7);
    expect(Math.abs(run(c, s, 7250, 10_000, 250))).toBeLessThan(0.3);
  });

  it('ignores a single misread digit ("1:28" read as "1:23")', () => {
    const c = new ReadingClock();
    const s = new Song(85.3);
    run(c, s, 0, 4000, 250);
    const before = c.predict(4250);
    expect(c.observe(s.shown(4250) - 5, 4250)).toBe('unconfirmed');
    expect(Math.abs(c.predict(4250) - before)).toBeLessThan(0.01);
    expect(Math.abs(run(c, s, 4500, 6000, 250))).toBeLessThan(0.2);
  });

  it('a new song from 0:00 is a confirmed jump', () => {
    const c = new ReadingClock();
    const s = new Song(170);
    run(c, s, 0, 3000, 250);
    s.seek(3100, 0);
    const results = [c.observe(s.shown(3250), 3250), c.observe(s.shown(3500), 3500)];
    expect(results).toEqual(['unconfirmed', 'jump']);
  });

  it('reads twice a second once it knows where the seconds tick over', () => {
    const c = new ReadingClock();
    const s = new Song(20.4);
    run(c, s, 0, 3000, 250);
    // scheduled reading: just before or just after the next tick, never more than a second away
    const wait = c.nextReadIn(3000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(1000);
    // and the schedule keeps the clock exact
    let t = 3000;
    for (let i = 0; i < 40; i++) {
      t += c.nextReadIn(t);
      c.observe(s.shown(t), t);
    }
    expect(Math.abs(c.predict(t) - s.pos(t))).toBeLessThan(0.15);
  });

  it('a static page (no new pictures) counts as paused', () => {
    const c = new ReadingClock();
    run(c, new Song(50.6), 0, 2000, 250);
    c.stall(52, 6000);
    expect(c.state?.playing).toBe(false);
    expect(c.predict(9000)).toBeCloseTo(52.5, 5);
  });
});
