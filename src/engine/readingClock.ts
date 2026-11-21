/**
 * The song's position, worked out from readings of a time display that shows whole seconds
 * (Spotify's "1:23" next to its progress bar, read off a shared tab).
 *
 * While the song plays, its position is `t + offset` (t = the time of the picture, in s). A reading
 * "83" from a picture captured at t says 83 ≤ t + offset < 84, i.e. the offset lies in a range one
 * second wide. Every reading narrows the range further (the overlap of all of them) and the clock
 * sits in its middle — so it gets more precise the longer it runs, never drifts (every reading
 * bounds it), and doesn't care how often or how regularly readings come: a slow computer gives
 * fewer, later readings, never a frozen clock.
 *   - A reading that contradicts the range by a little (picture timing jitter) restarts the range
 *     from that reading; by a lot (a seek, a new song — or a misread digit) it's believed only once
 *     a second reading agrees with it, allowing for the time that passed between them.
 *   - The number standing still for over a second = paused; moving again = playing.
 *
 * Pure logic (no timers, no DOM): the caller supplies the times. Tested in readingClock.test.ts.
 */
export interface ClockState {
  /** position (s) at `at` */
  pos: number;
  /** performance.now()-style time (ms) */
  at: number;
  playing: boolean;
}

export type Observation = 'start' | 'ok' | 'corrected' | 'paused' | 'resumed' | 'jump' | 'unconfirmed';

/** a reading this far (s) outside the clock's range is a jump (or a misread) */
const FAR = 2.5;
/** the same number showing for longer than this (ms; a second plus slack for picture timing) = paused */
const STILL_MS = 1250;
/** picture times aren't exact: each range is widened this much (s) so jitter can't over-narrow it */
const SLACK = 0.03;

export class ReadingClock {
  state: ClockState | null = null;
  /** the range the offset (position − time) lies in, while playing */
  private range: [number, number] | null = null;
  private lastSec: number | null = null;
  private lastAt = 0;
  /** when the number now showing was first seen */
  private secFirstSeen = 0;
  private far: { sec: number; at: number } | null = null;
  /** how far (s) the last reading moved the clock (diagnostics; 0 = it agreed) */
  lastCorrection = 0;

  reset() {
    this.state = null;
    this.range = null;
    this.lastSec = null;
    this.lastAt = 0;
    this.far = null;
    this.lastCorrection = 0;
  }

  /** how precisely (s) the clock knows the position: the width of its range (1 = one reading) */
  get uncertainty() {
    return this.range ? this.range[1] - this.range[0] : 1;
  }

  /** the position at time `at` (ms) */
  predict(at: number): number {
    const c = this.state;
    if (!c) return 0;
    return c.playing ? c.pos + (at - c.at) / 1000 : c.pos;
  }

  private play(range: [number, number], at: number) {
    this.range = range;
    const pos = at / 1000 + (range[0] + range[1]) / 2;
    this.lastCorrection = this.state ? pos - this.predict(at) : 0;
    this.state = { pos, at, playing: true };
  }

  /** a reading: the display showed `sec` in the picture captured at `at` (ms) */
  observe(sec: number, at: number): Observation {
    if (at <= this.lastAt) return 'ok'; // not a newer picture than one already read: nothing new
    this.lastAt = at;
    if (sec !== this.lastSec) this.secFirstSeen = at;
    const moved = this.secFirstSeen === at;
    this.lastSec = sec;
    const t = at / 1000;
    const reading: [number, number] = [sec - t - SLACK, sec + 1 - t + SLACK];

    if (!this.state) {
      this.play(reading, at);
      return 'start';
    }
    const pred = this.predict(at);
    // far from what the clock says: a seek or a new song, or a misread — believe it on agreement
    if (pred < sec - FAR || pred > sec + 1 + FAR) {
      const f = this.far;
      if (!(f && Math.abs(sec - (f.sec + (at - f.at) / 1000)) <= 1.5)) {
        this.far = { sec, at };
        return 'unconfirmed';
      }
      this.far = null;
      this.play(reading, at);
      // a jump while the number stands still (seeking while paused): still paused
      if (at - this.secFirstSeen > STILL_MS) this.state = { pos: sec + 0.5, at, playing: false };
      return 'jump';
    }
    this.far = null;

    if (!this.state.playing) {
      if (moved) {
        this.play(reading, at); // the number moves again: playing, from here
        return 'resumed';
      }
      return 'ok';
    }
    if (at - this.secFirstSeen > STILL_MS) {
      // stopped somewhere within the second showing: its middle is never more than 0.5 s off
      this.lastCorrection = sec + 0.5 - pred;
      this.state = { pos: sec + 0.5, at, playing: false };
      this.range = null;
      return 'paused';
    }
    const r = this.range!;
    const lo = Math.max(r[0], reading[0]);
    const hi = Math.min(r[1], reading[1]);
    if (lo > hi) {
      this.play(reading, at); // contradicts what came before: start over from this reading
      return 'corrected';
    }
    const narrower = lo !== r[0] || hi !== r[1];
    this.play([lo, hi], at);
    return narrower ? 'corrected' : 'ok';
  }

  /** no new picture has come for a long while (a static, i.e. paused, page): stop at `sec` */
  stall(sec: number, at: number) {
    if (!this.state?.playing) return;
    this.state = { pos: sec + 0.5, at, playing: false };
    this.range = null;
  }

  /**
   * How long (ms, from `now`) to wait before the next reading. While the song plays and the clock
   * knows its position closely, two readings a second are enough — one just before the expected
   * tick and one just after, which keeps it exact. Otherwise (just started, after a jump, paused)
   * read often to find out.
   */
  nextReadIn(now: number, often = 250): number {
    const c = this.state;
    if (!c || !c.playing || this.uncertainty > 0.35) return often;
    const margin = 110;
    // the last reading was taken just before a tick that has happened since (a reading takes a while
    // on a slow computer): read again straight away, so the tick is caught between the two
    const last = this.predict(this.lastAt);
    if (last - Math.floor(last) > 0.5 && Math.floor(this.predict(now)) > Math.floor(last)) return 0;
    const pred = this.predict(now);
    const toTick = (Math.ceil(pred + 1e-6) - pred) * 1000;
    return toTick > margin + 40 ? toTick - margin : toTick + margin;
  }
}
