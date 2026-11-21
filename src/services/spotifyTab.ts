import type { SystemState } from '../engine/systemPlayer';
import type Tesseract from 'tesseract.js';

/**
 * "Sync lyrics" on the website: follow Spotify playing in another browser tab (or the Spotify app's
 * window) by READING its player bar, the way a person would.
 *
 * A web page can't see other tabs or apps. What the browser does allow is sharing one, with the
 * listener's say-so (the standard "Choose what to share" window, as in video calls). Vayro looks at
 * that picture only, on this computer, a few times a second:
 *
 *   ┌──────────────────────────────────────────────────────────────────────────┐
 *   │ [art] Song title          ⇄  ⏮  ▶  ⏭  ⟳                                  │
 *   │       Artist        1:23 ━━━━━━━━━━●──────────────── 3:45                 │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * - finds the elapsed / total times (two "m:ss" texts on one row) and the title + artist to their
 *   left, at the bottom of the shared picture (Spotify's player bar, web player and app alike);
 * - reads the elapsed time ~4× a second. Spotify shows whole seconds; the moment the number ticks
 *   over pins the position to ±0.15 s. It stops ticking → paused; jumps → seek;
 * - re-reads the title every 2 s: a new title (seen twice, so one misread can't switch songs) → new
 *   song.
 *
 * Text recognition: tesseract.js (WebAssembly), served from this site (/ocr/). Nothing about the
 * shared picture leaves the computer; only the song's name is used to look up its lyrics.
 */

export type TabStatus =
  | { kind: 'preparing' } // shared; the text reader is still loading (first time: a ~10 MB download)
  | { kind: 'looking' } // sharing, but no Spotify player bar found yet
  | { kind: 'notFound' } // still no player bar after a while: show what to check
  | { kind: 'following' }
  | { kind: 'ended' }; // the listener stopped sharing

type Box = { x: number; y: number; w: number; h: number };
type Layout = { elapsed: Box; total: Box; meta: Box };

const TIME = /^-?(\d{1,2}):([0-5]\d)$/;
const TICK_MS = 250;
const META_EVERY_MS = 2000;

const parseTime = (t: string) => {
  const m = t.trim().replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').match(TIME);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** close enough to be the same title, allowing for a misread letter or two */
export function sameText(a: string, b: string, maxDiff = 0.25) {
  const n = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
  const x = n(a);
  const y = n(b);
  if (!x || !y) return x === y;
  if (x === y) return true;
  // Levenshtein distance relative to length
  const d: number[] = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[y.length] / Math.max(x.length, y.length) <= maxDiff;
}

/** can this browser share a tab / window? (desktop Chrome, Edge, Firefox, Safari: yes; phones: no) */
export const canShareTab = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

let tesseract: Promise<typeof Tesseract> | null = null;
const loadTesseract = () => (tesseract ??= import('tesseract.js').then((m) => (m.default ?? m) as typeof Tesseract));

async function makeWorker(langs: string[], params: Partial<Tesseract.WorkerParams>) {
  const T = await loadTesseract();
  const w = await T.createWorker(langs, T.OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr',
    langPath: '/ocr',
    gzip: false, // served as-is (hosts may compress it themselves)
    workerBlobURL: false,
  });
  await w.setParameters(params);
  return w;
}

type Workers = { digits: Tesseract.Worker; text: Tesseract.Worker; meta: Tesseract.Worker };
let workers: Promise<Workers> | null = null;
/**
 * Loads the text reader (once per visit; the browser caches its files after the first time). Called
 * as soon as the listener points at Sync lyrics, so it's usually ready before they've picked a tab.
 * - digits: the times · text: finding the player bar · meta: the song's title and artist, in English,
 *   Hindi (Devanagari) or Punjabi (Gurmukhi) script
 */
export function preloadReader(): Promise<Workers> {
  if (!workers) {
    const p = (async () => {
      const [digits, text, meta] = await Promise.all([
        makeWorker(['eng'], { tessedit_pageseg_mode: '7' as Tesseract.PSM, tessedit_char_whitelist: '0123456789:-' }),
        makeWorker(['eng'], { tessedit_pageseg_mode: '11' as Tesseract.PSM }),
        makeWorker(['eng', 'hin', 'pan'], { tessedit_pageseg_mode: '11' as Tesseract.PSM }),
      ]);
      return { digits, text, meta };
    })();
    workers = p;
    p.catch(() => {
      if (workers === p) workers = null; // try again next time (e.g. was offline)
    });
  }
  return workers;
}
let workersReady = false;

export class SpotifyTabReader {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private digits: Tesseract.Worker | null = null;
  private text: Tesseract.Worker | null = null;
  private meta: Tesseract.Worker | null = null;
  private lookingSince = 0;
  private toldNotFound = false;
  private stopped = false;
  private layout: Layout | null = null;
  private misses = 0;

  // timing
  private lastSec: number | null = null;
  private lastReadAt = 0;
  /** when the newest frame of the shared picture was captured, and when it arrived (performance.now()) */
  private frameAt = 0;
  private frameArrived = 0;
  private framesTimed = false;
  private total = 0;

  // song
  private title = '';
  private artist = '';
  private pendingTitle = '';
  private lastMetaAt = 0;

  constructor(
    private onState: (s: SystemState) => void,
    private onStatus: (s: TabStatus) => void,
  ) {}

  /** must be called straight from a click: the browser only opens its share window for one */
  async start() {
    // the reader loads while the listener picks a tab (the share window is opened first: a browser
    // only opens it straight from a click)
    const ready = preloadReader();
    // Chrome / Edge switch to the shared tab by default; keep the listener here, on the lyrics
    type Controller = { setFocusBehavior(b: string): void };
    const W = window as unknown as { CaptureController?: new () => Controller };
    const controller = W.CaptureController ? new W.CaptureController() : undefined;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      ...(controller ? { controller } : {}),
      // full resolution: Spotify's times are small text
      video: { displaySurface: 'browser', frameRate: { ideal: 8, max: 15 }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
      // offer tabs and windows (the Spotify app), not this tab and not whole screens
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'exclude',
      surfaceSwitching: 'include',
    } as DisplayMediaStreamOptions);
    try {
      // only allowed right after sharing starts, and only for tabs / windows
      controller?.setFocusBehavior('no-focus-change');
    } catch { /* not supported for this surface */ }
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (this.stopped) return;
      this.stop();
      this.onStatus({ kind: 'ended' });
    });
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play().catch(() => {});
    // time readings by when their picture was captured, not when they were read: if this page is busy
    // for a moment, an older picture doesn't look like a paused song
    type FrameMeta = { captureTime?: number; presentationTime?: number };
    const rv = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: FrameMeta) => void) => number };
    if (rv.requestVideoFrameCallback) {
      this.framesTimed = true;
      const onFrame = (t: number, m: FrameMeta) => {
        this.frameAt = m.captureTime || m.presentationTime || t;
        this.frameArrived = performance.now();
        if (!this.stopped && this.video === v) rv.requestVideoFrameCallback!(onFrame);
      };
      rv.requestVideoFrameCallback(onFrame);
    }
    this.video = v;
    // ?debug: inspect the reader from the console (window.__tabReader)
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __tabReader: this });
    if (!workersReady) this.onStatus({ kind: 'preparing' });
    let w: Workers;
    try {
      w = await Promise.race([ready, new Promise<never>((_, no) => setTimeout(() => no(new Error('the text reader took too long to load — check your internet connection')), 90_000))]);
    } catch (e) {
      this.stop();
      throw e;
    }
    workersReady = true;
    if (this.stopped) return;
    ({ digits: this.digits, text: this.text, meta: this.meta } = w);
    this.lookingSince = performance.now();
    this.onStatus({ kind: 'looking' });
    void this.loop();
  }

  stop() {
    this.stopped = true;
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    // the text reader stays loaded: the next Sync lyrics starts instantly
    this.digits = this.text = this.meta = null;
  }

  private async loop() {
    while (!this.stopped) {
      const t0 = performance.now();
      try {
        if (!this.layout) {
          await this.findLayout();
          if (!this.layout && !this.toldNotFound && performance.now() - this.lookingSince > 15_000) {
            this.toldNotFound = true;
            this.onStatus({ kind: 'notFound' });
          }
        } else await this.tick();
      } catch {
        /* a frame that couldn't be read: try the next one */
      }
      const wait = (this.layout ? TICK_MS : 900) - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }

  /**
   * Copies part of the current frame, scaled up and turned into dark text on white (what the
   * recogniser reads best — Spotify's text is light on dark).
   */
  private grab(box: Box, scale: number) {
    const v = this.video!;
    // a fresh canvas per read: the time and the title are read at the same time
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(box.w * scale));
    c.height = Math.max(1, Math.round(box.h * scale));
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(v, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    const img = g.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    // average brightness decides which way round the text is (light or dark theme)
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const dark = sum / (d.length / 4) < 128;
    for (let i = 0; i < d.length; i += 4) {
      let y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
      if (dark) y = 255 - y;
      // stretch contrast so grey (artist, times) text reads as dark as white text does
      y = y > 205 ? 255 : y * 0.55;
      d[i] = d[i + 1] = d[i + 2] = y;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** looks for Spotify's player bar in the bottom part of the shared picture */
  private async findLayout() {
    const v = this.video;
    if (!v || !this.text || !v.videoWidth) return;
    const W = v.videoWidth;
    const H = v.videoHeight;
    const strip: Box = { x: 0, y: Math.round(H * 0.8), w: W, h: H - Math.round(H * 0.8) };
    // Spotify's times are ~12 px: enlarge so they're ~30 px tall for the recogniser
    const scale = Math.min(3, Math.max(1.6, 3600 / W));
    const r = await this.text.recognize(this.grab(strip, scale), {}, { blocks: true, text: false });
    if (this.stopped) return;
    const words = (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
    const toFrame = (bb: Tesseract.Bbox): Box => ({ x: strip.x + bb.x0 / scale, y: strip.y + bb.y0 / scale, w: (bb.x1 - bb.x0) / scale, h: (bb.y1 - bb.y0) / scale });
    const times = words.filter((w) => parseTime(w.text) !== null).map((w) => ({ w, b: toFrame(w.bbox) }));
    // elapsed and total: two times on one row, the widest apart (the progress bar between them)
    let best: [typeof times[0], typeof times[0]] | null = null;
    for (const a of times)
      for (const b of times) {
        if (b.b.x <= a.b.x + a.b.w) continue;
        const sameRow = Math.abs(a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2)) < Math.max(a.b.h, b.b.h) * 0.8;
        if (sameRow && b.b.x - a.b.x > W * 0.15 && (!best || b.b.x - a.b.x > best[1].b.x - best[0].b.x)) best = [a, b];
      }
    if (!best) return;
    const [el, tot] = best;
    const rowH = Math.max(el.b.h, tot.b.h);
    const pad = (b: Box, px: number, py: number): Box => ({ x: Math.max(0, b.x - px), y: Math.max(0, b.y - py), w: Math.min(W, b.w + 2 * px), h: Math.min(H, b.h + 2 * py) });
    // title + artist: left of the controls, around the times' row (the bar is ~4 rows tall)
    const metaTop = Math.max(strip.y, el.b.y - rowH * 4);
    const meta: Box = { x: 0, y: metaTop, w: Math.max(W * 0.12, el.b.x - W * 0.04), h: Math.min(H - metaTop, rowH * 6.5) };
    this.layout = {
      // room for "10:00" when the time grows a digit
      elapsed: pad({ ...el.b, x: el.b.x - el.b.w * 0.5, w: el.b.w * 1.5 }, rowH * 0.3, rowH * 0.35),
      total: pad({ ...tot.b, w: tot.b.w * 1.5 }, rowH * 0.3, rowH * 0.35),
      meta,
    };
    this.misses = 0;
    this.total = parseTime(tot.w.text) ?? 0;
    await this.readMeta(true);
    this.lastMetaAt = performance.now();
  }

  /** reads a time; `at`: when the picture it was read from was captured */
  private shotAt = 0;
  private async readTime(box: Box) {
    this.shotAt = this.framesTimed ? this.frameAt : performance.now();
    const r = await this.digits!.recognize(this.grab(box, Math.max(2, 36 / box.h)), {}, { text: true });
    const t = r.data.text.replace(/\s+/g, '');
    const m = t.match(/(\d{1,2}):([0-5]\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** title (first line) and artist (second line) from one OCR result */
  private static lines(r: Tesseract.RecognizeResult) {
    const lines = (r.data.blocks ?? [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .map((l) => ({ text: l.words.filter((w) => w.confidence > 35).map((w) => w.text).join(' ').trim(), y: l.bbox.y0, conf: l.confidence }))
      // \p{M}: Devanagari / Gurmukhi vowel signs (matras) sit between letters
      .filter((l) => /[\p{L}\p{M}]{2,}/u.test(l.text) && !TIME.test(l.text))
      .sort((a, b) => a.y - b.y);
    if (!lines.length) return null;
    const title = lines[0].text.replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{M}\p{N})!?.]+$/gu, '');
    const artist = (lines[1]?.text ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N})]+$/gu, '');
    return title ? { title, artist, conf: lines[0].conf } : null;
  }

  /**
   * The player bar's title and artist. Read with the quick English reader first; only when that
   * can't make sense of it (a title in Devanagari / Gurmukhi) with the slower English + Hindi +
   * Punjabi one.
   */
  private async readNames(full = false) {
    const L = this.layout!;
    // enlarged so the title is ~34 px tall: what the reader needs, no more (bigger is just slower)
    const scale = Math.min(3, Math.max(1, 34 / Math.max(8, L.meta.h / 6.5)));
    const read = (w: Tesseract.Worker) => w.recognize(this.grab(L.meta, scale), {}, { blocks: true, text: false }).then(SpotifyTabReader.lines);
    if (!full) {
      const quick = await read(this.text!);
      // still the same song: done (the common case, and the cheap one)
      if (quick && this.title && sameText(quick.title, this.title)) return quick;
    }
    // A (possibly) new title: read it both ways and keep the more confident reading. The English
    // reader turns Hindi / Punjabi letters into confident-looking nonsense ("get et"), and the
    // English + Hindi + Punjabi one sometimes reads a Latin title as Gurmukhi: each is right where
    // the other is unsure.
    const [en, all] = await Promise.all([read(this.text!), read(this.meta!)]);
    if (!en || !all) return en ?? all;
    const indic = /[\u0900-\u097F\u0A00-\u0A7F]/.test(all.title);
    // a Latin title read equally well by both: the English reading (its spelling is the better one)
    if (!indic) return en.conf >= all.conf - 5 ? en : all;
    return all.conf > en.conf ? all : en;
  }


  /**
   * Is a different song playing? A different title read twice in a row switches; once is enough
   * right after the time jumped (back to the start, usually) or when the length changed too. A
   * single misread mid-song never switches.
   */
  private async readMeta(first = false) {
    const shot = this.framesTimed ? this.frameAt : performance.now();
    const [names, total] = await Promise.all([this.readNames(first || !this.title), first ? Promise.resolve(null) : this.readTotal().catch(() => null)]);
    this.lastMetaAt = performance.now();
    if (!names) return;
    const { title, artist } = names;
    if (first || !this.title) return await this.setSong(title, artist);
    if (sameText(title, this.title)) {
      this.pendingTitle = '';
      if (total && total > 0) this.total = total;
      return;
    }
    const afterJump = this.jumpAt > this.songAt && shot >= this.jumpAt;
    const newLength = !!total && !!this.total && Math.abs(total - this.total) > 2;
    if (afterJump || newLength || (this.pendingTitle && sameText(title, this.pendingTitle))) await this.setSong(title, artist, total);
    else this.pendingTitle = title;
  }

  private async setSong(title: string, artist: string, total?: number | null) {
    this.pendingTitle = '';
    // title, artist and length switch together: a stale length from the previous song makes the
    // lyrics lookup reject every version of the new one as "a different edit"
    const t = total ?? (await this.readTotal().catch(() => null));
    this.total = t && t > 0 ? t : 0;
    this.title = title;
    this.artist = artist;
    this.songAt = this.framesTimed ? this.frameAt : performance.now();
    this.onStatus({ kind: 'following' });
  }
  /** when the current song was recognised, and when the time last jumped (picture times) */
  private songAt = 0;
  private jumpAt = 0;
  private metaWanted = false;

  /**
   * One reading of Spotify's elapsed time, turned into the song's position.
   *
   * Spotify shows whole seconds, so a reading "1:23" taken from a picture captured at time t means:
   * at t the song was somewhere in [83, 84). Vayro keeps its own running clock (position + whether
   * it's playing) and only corrects it when a reading says it's outside that range — by the least
   * amount needed. Readings tighten the estimate as they come in (the moment the number ticks over
   * pins the position to within the gap between two readings), and none of this depends on how
   * often the readings come: a slow computer gives fewer, later readings, never a frozen clock.
   */
  private clock: { pos: number; at: number; playing: boolean } | null = null;
  /** when the number now showing was first seen, and the reading before that */
  private secFirstSeen = 0;
  private prevReadAt = 0;
  /** a reading far from the clock (seek / new song / misread), waiting for a second one to agree */
  private farReading: { sec: number; at: number } | null = null;
  /** readings in a row that found no new picture */
  private samePicture = 0;

  private predict(at: number) {
    const c = this.clock!;
    return c.playing ? c.pos + (at - c.at) / 1000 : c.pos;
  }

  private async tick() {
    const L = this.layout!;
    const sec = await this.readTime(L.elapsed);
    const at = this.shotAt; // when the picture was captured
    if (this.stopped) return;
    if (sec === null) {
      // the bar moved (window resized, Spotify's layout changed…): look for it again
      if (++this.misses >= 8) {
        this.layout = null;
        this.onStatus({ kind: 'looking' });
      }
      return;
    }
    this.misses = 0;
    // The same picture as last time: no new information. A tab only sends pictures when something
    // on it changes, and a playing song's time changes every second: no new picture for a good while
    // means it's paused.
    if (this.framesTimed && at === this.lastReadAt) {
      // each such reading proves this page was free to receive a new picture and none came; a page
      // that was busy (loading lyrics…) gets no pictures either, so a few late ones alone don't count
      this.samePicture++;
      if (this.clock?.playing && this.samePicture >= 10 && performance.now() - this.frameArrived > 4000) {
        this.clock = { pos: sec + 0.5, at, playing: false };
        this.emit();
      }
      return;
    }
    this.samePicture = 0;

    const prev = this.lastReadAt;
    this.lastReadAt = at;
    if (sec !== this.lastSec) {
      this.prevReadAt = prev;
      this.secFirstSeen = at;
    }
    const ticked = this.lastSec !== null && sec === this.lastSec + 1 && prev > 0 && at - prev < 1500;
    this.lastSec = sec;

    // the range this reading allows: [sec, sec + 1) — narrower right after the number ticked over
    // (it changed between the previous reading and this one)
    const lo = sec;
    const hi = ticked ? sec + Math.min(0.999, (at - this.prevReadAt) / 1000) : sec + 0.999;
    // the number hasn't changed for over a second (plus slack for picture timing): paused
    const still = at - this.secFirstSeen > 1250;

    if (!this.clock) {
      this.clock = { pos: (lo + hi) / 2, at, playing: true };
    } else {
      const pred = this.predict(at);
      const off = pred < lo ? pred - lo : pred > hi ? pred - hi : 0;
      if (Math.abs(off) > 2.5) {
        // far off: a seek, a new song — or a misread digit. Believe it when a second reading agrees
        // (allowing for the time that passed between them)
        const f = this.farReading;
        const agrees = f && Math.abs(sec - (f.sec + (at - f.at) / 1000)) <= 1.5;
        if (!agrees) {
          this.farReading = { sec, at };
          return this.emit();
        }
        this.farReading = null;
        this.clock = { pos: (lo + hi) / 2, at, playing: !still };
        this.jumpAt = at; // check the title now (a new song?)
        this.metaWanted = true;
      } else {
        this.farReading = null;
        // inside the range: the clock is right — keep it (it's more precise than one reading)
        // outside: move it just inside
        // playing unless the number has stood still; a paused clock resumes when the number moves
        const playing = still ? false : this.clock.playing || this.secFirstSeen === at;
        let pos = off === 0 ? pred : off < 0 ? lo + 0.02 : hi - 0.02;
        // stopped somewhere within the second showing: its middle is never more than 0.5 s off
        if (!playing) pos = this.clock.playing ? lo + 0.5 : Math.min(Math.max(pos, lo), hi - 0.02);
        this.clock = { pos, at, playing };
      }
    }
    this.emit();
    // the title (new song?) and the total length now and then — on their own, so the time keeps
    // being read meanwhile (the title reader is the slowest part)
    if (!this.metaBusy && (this.metaWanted || performance.now() - this.lastMetaAt > this.metaEvery)) void this.refreshMeta();
  }

  private metaBusy = false;
  /** how often to re-read the title: every 2 s, less often when reading it is slow (slow computer) */
  private metaEvery = META_EVERY_MS;
  private async refreshMeta() {
    this.metaBusy = true;
    this.metaWanted = false;
    const t0 = performance.now();
    try {
      await this.readMeta();
    } catch {
      /* next time */
    } finally {
      this.metaBusy = false;
      this.metaEvery = Math.max(META_EVERY_MS, (performance.now() - t0) * 1.5);
    }
  }

  /** the total length, read with its own worker (the time worker stays free for the elapsed time) */
  private async readTotal() {
    const L = this.layout;
    if (!L || !this.text) return null;
    const r = await this.text.recognize(this.grab(L.total, Math.max(2, 36 / L.total.h)), {}, { text: true });
    const m = r.data.text.replace(/\s+/g, '').match(/(\d{1,2}):([0-5]\d)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  /** passes the clock on to the player (extrapolated to this moment) */
  private emit() {
    if (!this.title || !this.clock) return;
    const now = performance.now();
    this.onState({
      app: 'Spotify',
      title: this.title,
      artist: this.artist,
      status: this.clock.playing ? 'Playing' : 'Paused',
      position: this.predict(now),
      start: 0,
      end: this.total || undefined,
      receivedAt: Date.now(),
      tolerance: 0.15,
      fuzzy: true,
    });
  }
}
