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
/** the same second showing for this long → paused (a second lasts 1000 ms; margin for slow readings) */
const PAUSE_AFTER_MS = 1500;

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
  private canvas = document.createElement('canvas');
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
  /** the current second began no earlier than this (performance.now()) */
  private secSince = 0;
  /** performance.now() at which the song was at `basePos` */
  private baseAt = 0;
  private basePos = 0;
  private total = 0;

  // song
  private title = '';
  private artist = '';
  private pendingTitle = '';
  private lastMetaAt = 0;
  /** the time jumped (likely a new song): the next title read that differs switches at once */
  private jumped = false;
  /** an unconfirmed jump to this second */
  private jumpTo: number | null = null;
  /** readings in a row that say "paused" */
  private stillReads = 0;

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
    const c = this.canvas;
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
    const strip: Box = { x: 0, y: Math.round(H * 0.72), w: W, h: H - Math.round(H * 0.72) };
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

  /** title (first line) and artist (second line) of the player bar */
  private async readMeta(first = false) {
    const L = this.layout!;
    const scale = Math.max(1.5, 60 / Math.max(10, L.meta.h / 6.5));
    const r = await this.meta!.recognize(this.grab(L.meta, scale), {}, { blocks: true, text: false });
    const lines = (r.data.blocks ?? [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .map((l) => ({ text: l.words.filter((w) => w.confidence > 35).map((w) => w.text).join(' ').trim(), y: l.bbox.y0, conf: l.confidence }))
      // \p{M}: Devanagari / Gurmukhi vowel signs (matras) sit between letters
      .filter((l) => /[\p{L}\p{M}]{2,}/u.test(l.text) && !TIME.test(l.text))
      .sort((a, b) => a.y - b.y);
    this.lastMetaAt = performance.now();
    if (!lines.length) return;
    const title = lines[0].text.replace(/^[^\p{L}\p{N}(]+|[^\p{L}\p{M}\p{N})!?.]+$/gu, '');
    const artist = (lines[1]?.text ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N})]+$/gu, '');
    if (!title) return;
    if (first || !this.title) return this.setSong(title, artist);
    if (sameText(title, this.title)) {
      this.pendingTitle = '';
      return;
    }
    // a different title twice in a row, or right after the time jumped: a new song (a single
    // misread mid-song doesn't switch)
    const jumped = this.jumped;
    this.jumped = false;
    if (jumped || (this.pendingTitle && sameText(title, this.pendingTitle))) this.setSong(title, artist);
    else this.pendingTitle = title;
  }

  private setSong(title: string, artist: string) {
    this.title = title;
    this.artist = artist;
    this.pendingTitle = '';
    this.onStatus({ kind: 'following' });
  }

  private async tick() {
    const L = this.layout!;
    const sec = await this.readTime(L.elapsed);
    const now = this.shotAt;
    if (this.stopped) return;
    // the same picture as last time: nothing new. A tab only sends pictures when something on it
    // changes, and a playing song changes its time every second: so no picture for a while = paused
    if (this.framesTimed && now === this.lastReadAt && sec !== null) {
      if (this.title && performance.now() - this.frameArrived > PAUSE_AFTER_MS + 1000)
        this.onState({ app: 'Spotify', title: this.title, artist: this.artist, status: 'Paused', position: sec + 0.5, start: 0, end: this.total || undefined, receivedAt: Date.now(), tolerance: 0.2, fuzzy: true });
      return;
    }
    if (sec === null) {
      // the bar moved (window resized, Spotify's layout changed…): look for it again
      if (++this.misses >= 8) {
        this.layout = null;
        this.onStatus({ kind: 'looking' });
      }
      return;
    }
    this.misses = 0;
    // a jump (seek, new song) is believed once a second reading agrees: one misread digit
    // ("1:28" read as "1:23") mustn't throw the lyrics around
    if (this.lastSec !== null && sec !== this.lastSec && sec !== this.lastSec + 1) {
      const confirmed = this.jumpTo !== null && (sec === this.jumpTo || sec === this.jumpTo + 1);
      if (!confirmed) {
        this.jumpTo = sec;
        return;
      }
    }
    this.jumpTo = null;
    const prevRead = this.lastReadAt;
    this.lastReadAt = now;
    if (this.lastSec === null) {
      // first reading: somewhere within this second
      this.basePos = sec + 0.5;
      this.baseAt = now;
      this.secSince = now;
    } else if (sec !== this.lastSec) {
      if (sec === this.lastSec + 1 && prevRead) {
        // ticked over between the previous reading and this one (and no more than a second ago,
        // or it would show the next number): the second began about halfway through that window
        const earliest = Math.max(prevRead, now - 1000);
        this.basePos = sec + (now - (earliest + now) / 2) / 1000;
        this.secSince = earliest;
      } else {
        // a jump (seek, or a new song starting): phase unknown until the next tick; check the title now
        this.basePos = sec + 0.5;
        this.jumped = true;
        this.lastMetaAt = 0;
        this.secSince = now;
      }
      this.baseAt = now;
    }
    this.lastSec = sec;
    // Paused: the same second has been showing for clearly longer than a second. Judged from the
    // readings themselves, so a slow moment on this computer (readings further apart) isn't mistaken
    // for a pause.
    // …and only after a few such readings in a row, so a single late picture doesn't count
    this.stillReads = now - this.secSince < PAUSE_AFTER_MS ? 0 : this.stillReads + 1;
    const playing = this.stillReads < 3;
    if (this.title) {
      const t = performance.now();
      this.onState({
        app: 'Spotify',
        title: this.title,
        artist: this.artist,
        status: playing ? 'Playing' : 'Paused',
        position: playing ? this.basePos + (t - this.baseAt) / 1000 : sec + 0.5,
        start: 0,
        end: this.total || undefined,
        receivedAt: Date.now(),
        tolerance: 0.2,
        fuzzy: true,
      });
    }
    // the title (new song?) and total now and then; slower, so after the reading is passed on
    if (now - this.lastMetaAt > META_EVERY_MS) {
      await this.readMeta();
      const tot = await this.readTime(L.total);
      if (tot && tot > 0) this.total = tot;
    }
  }

}
