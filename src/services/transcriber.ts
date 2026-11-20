import { formatLrcTime } from '../utils/lrc';

/**
 * Lyric transcription for the user's own files.
 *
 * 1. Decode the file and resample to 16 kHz mono (what Whisper expects); a high-pass filter
 *    removes sub-bass so the vocal dominates a little more.
 * 2. Split into ~20 s sections at quiet moments, the section being listened to first; the
 *    worker gives each 5 s of lead-in context and posts each section back as soon as it's done,
 *    so lyrics appear progressively instead of after the whole song.
 * 3. Whisper returns words with start/end times on the song's clock — on the local Vayro
 *    server (native, multi-threaded, cached by file hash) or, as a fallback, in a Web Worker.
 * 4. Clean known Whisper hallucinations and group words into lines → enhanced LRC
 *    ([line stamp] + <word stamps>), which the existing LRC parser and lyric styles consume.
 *
 * Everything happens on this computer (the server is a local helper on localhost). The result is labelled as a machine transcription.
 */

export type TranscribePhase = 'cache' | 'decode' | 'upload' | 'model' | 'listen';
export interface TranscribeProgress { phase: TranscribePhase; progress: number }
export interface Word { text: string; start: number; end: number }

const SR = 16000;

async function decode16k(url: string): Promise<Float32Array> {
  return decodeBytes(await (await fetch(url)).arrayBuffer());
}

async function decodeBytes(buf: ArrayBuffer): Promise<Float32Array> {
  const tmp = new OfflineAudioContext(1, 1, 44100);
  const decoded = await tmp.decodeAudioData(buf);
  if (decoded.duration > 20 * 60) throw new Error('This file is longer than 20 minutes — too long to transcribe in the browser.');
  const ctx = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 110;
  src.connect(hp).connect(ctx.destination); // stereo → mono downmix happens at the destination
  src.start();
  const out = await ctx.startRendering();
  return out.getChannelData(0);
}

/**
 * Split into 20–25 s sections, cutting at the quietest 50 ms frame so a word is never split. With
 * the worker's 5 s lead-in each section is at most 30 s = exactly one Whisper window (longer
 * would cost a second, overlapping pass). The section containing `startAt` (where the listener is) goes first, then the rest of
 * the song from there, then the part before it.
 */
function makePieces(a: Float32Array, startAt: number): [number, number][] {
  const F = SR / 20;
  const frames = Math.floor(a.length / F);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * F; i < (f + 1) * F; i++) s += a[i] * a[i];
    rms[f] = Math.sqrt(s / F);
  }
  const bounds = [0];
  let start = 0;
  while (frames - start > 27 * 20) {
    let best = start + 25 * 20;
    let bestV = Infinity;
    for (let f = start + 20 * 20; f < start + 25 * 20; f++) {
      if (rms[f] < bestV) {
        bestV = rms[f];
        best = f;
      }
    }
    bounds.push(best * F);
    start = best;
  }
  bounds.push(a.length);
  const pieces: [number, number][] = [];
  for (let i = 0; i < bounds.length - 1; i++) pieces.push([bounds[i], bounds[i + 1]]);
  const at = Math.max(0, startAt * SR);
  let first = pieces.findIndex(([s, e]) => at >= s && at < e);
  if (first < 0) first = 0;
  return [...pieces.slice(first), ...pieces.slice(0, first)];
}

const isSilent = (a: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 8) sum += a[i] * a[i];
  return Math.sqrt(sum / (a.length / 8)) < 0.004;
};

/** rough sung length of a word, used when the aligner stretched its start into a pause */
// letters, digits and combining marks (Devanagari vowel signs are marks, not letters)
const letters = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');
const typicalLength = (w: string) => Math.min(0.9, Math.max(0.25, 0.12 + 0.07 * letters(w).length));

const HALLUCINATION = /^(thank you( (so much|very much))?( for (watching|listening))?|thanks for watching|please subscribe|subtitles by.*|subscribe.*|you|bye\.?)$/i;
const NOISE = /^[\s♪♫*.,!?\-–—…]*$|^[[(].*[\])]$/;

export function cleanWords(raw: Word[]): Word[] {
  let words = raw
    .map((w) => ({ ...w, text: w.text.replace(/\s+/g, ' ').trim() }))
    .filter((w) => w.text && !NOISE.test(w.text) && !/[♪♫]/.test(w.text));
  // drop isolated hallucinated phrases: short word runs separated by > 4 s from anything else
  const runs: Word[][] = [];
  for (const w of words) {
    const r = runs[runs.length - 1];
    if (r && w.start - r[r.length - 1].end < 4) r.push(w);
    else runs.push([w]);
  }
  words = runs
    .filter((r) => !(r.length <= 6 && HALLUCINATION.test(r.map((w) => w.text).join(' ').replace(/[.,!?]+/g, '').trim())))
    .flat();
  // collapse decoder loops: the same word more than 6× in a row
  const out: Word[] = [];
  let rep = 0;
  for (const w of words) {
    const prev = out[out.length - 1];
    const same = prev && letters(prev.text) !== '' && letters(prev.text) === letters(w.text);
    rep = same ? rep + 1 : 0;
    if (rep < 6) out.push(w);
  }
  // Whisper's word END times are reliable, but the first word after a pause gets its START
  // pulled back to the end of the previous word (it "absorbs" the silence). Rebuild those
  // starts from the end time. Then keep everything monotonic.
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    const len = typicalLength(w.text);
    if (w.end - w.start > len + 0.6) w.start = w.end - len;
    if (i > 0 && w.start < out[i - 1].start) w.start = out[i - 1].start;
    w.end = Math.max(w.start + 0.08, w.end);
  }
  return out;
}

/** group into lyric lines: break on pauses, sentence punctuation or length */
export function wordsToLrc(words: Word[], header: string[] = []): string {
  const lines: Word[][] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > 0.7 || (/[.?!।॥؟]$/.test(prev.text) && cur.length >= 2) || (/,$/.test(prev.text) && cur.length >= 4) || cur.length >= 8)) {
      lines.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) lines.push(cur);
  const out = [...header];
  lines.forEach((l, i) => {
    out.push(`[${formatLrcTime(l[0].start)}]` + l.map((w) => `<${formatLrcTime(w.start)}>${w.text}`).join(' '));
    // an empty line marks an instrumental gap, so the display rests instead of holding a word
    const end = l[l.length - 1].end;
    const next = lines[i + 1]?.[0].start ?? Infinity;
    if (next - end > 3) out.push(`[${formatLrcTime(end + 0.6)}]`);
  });
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Two engines, same output:
//   server  — the local Vayro server runs Whisper natively (multi-threaded). Measured on a
//             2-core Ryzen 3: 180 s song in ~41 s (RTF 0.23) vs ~5.5 min in the browser. Results
//             are cached on disk by file hash, shared between requests, and resumable.
//   browser — single-threaded WebAssembly in a Web Worker; used only when the server isn't running.
// ---------------------------------------------------------------------------------------------
export interface TranscribeOptions {
  /** ISO code ('hi', 'en', …) or undefined to auto-detect */
  language?: string;
  model: 'base' | 'small';
  /** seconds: the section being listened to is transcribed first */
  startAt: number;
  /** only listen to the first N seconds (e.g. lining lyrics up with a preview needs ~15 s) */
  maxSeconds?: number;
  header?: string[];
  /** debug/benchmark only: force the in-browser engine, a device and a dtype */
  engine?: 'server' | 'browser';
  device?: 'webgpu' | 'wasm';
  dtype?: string;
}

/** real measurements of one transcription, for the diagnostics panel */
export interface TranscribeDiag {
  engine: string;
  model: string;
  language: string;
  /** writing system of the result (Whisper doesn't report the language it detected) */
  script: string | null;
  audioSeconds: number;
  cacheHit: boolean;
  cacheCheckMs?: number;
  decodeMs?: number;
  uploadMs?: number;
  modelInitMs?: number | null;
  firstLyricsMs?: number;
  recogniseMs?: number;
  totalMs?: number;
  /** total processing time ÷ audio duration (lower = faster) */
  rtf?: number;
}

export interface TranscribeJob {
  promise: Promise<{ lrc: string; words: number } | null>;
  cancel: () => void;
}

type OnPartial = (lrc: string, done: number, total: number) => void;

async function sha(buf: ArrayBuffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d.slice(0, 20), (b) => b.toString(16).padStart(2, '0')).join('');
}

function toInt16(a: Float32Array) {
  const out = new Int16Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const v = a[i] < -1 ? -1 : a[i] > 1 ? 1 : a[i];
    out[i] = Math.round(v * 32767);
  }
  return out;
}

interface ServerView {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  error?: string | null;
  progress: number;
  sectionsDone?: number;
  sectionsTotal?: number;
  version?: number;
  words: Word[];
  script: string | null;
  duration: number;
  engine?: string;
  timings: Record<string, number | null | boolean | undefined>;
}

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(path, init);
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({})))?.error || `HTTP ${r.status}`), { status: r.status });
  return r.json() as Promise<T>;
};

const lrcOf = (raw: Word[], header: string[]) => {
  const words = cleanWords([...raw].sort((a, b) => a.start - b.start));
  return { lrc: words.length ? wordsToLrc(words, header) : '', count: words.length };
};

function viaServer(url: string, opts: TranscribeOptions, onProgress: (p: TranscribeProgress) => void, onPartial: OnPartial, onDiag?: (d: TranscribeDiag) => void): TranscribeJob {
  let cancelled = false;
  let jobId: string | null = null;
  const header = opts.header ?? [];
  const lang = opts.language ?? 'auto';
  const promise = (async () => {
    const t0 = performance.now();
    onProgress({ phase: 'cache', progress: 0 });
    const buf = await (await fetch(url)).arrayBuffer();
    // a clipped transcript is cached under its own key, so it can never stand in for the whole file
    const hash = opts.maxSeconds ? await sha(new TextEncoder().encode(`${await sha(buf)}:first${opts.maxSeconds}s`).buffer as ArrayBuffer) : await sha(buf);
    const q = `hash=${hash}&model=${opts.model}&lang=${lang}`;
    const c = await api<ServerView & { found: boolean }>(`/api/transcribe/cache?${q}`);
    const cacheCheckMs = Math.round(performance.now() - t0);
    const diag = (v: ServerView, extra: Partial<TranscribeDiag> = {}): TranscribeDiag => ({
      engine: v.engine ?? 'local server (native)', model: opts.model, language: lang, script: v.script, audioSeconds: +v.duration?.toFixed?.(1) || 0,
      cacheHit: false, cacheCheckMs, modelInitMs: (v.timings.model_init_ms as number) ?? null, recogniseMs: (v.timings.recognise_ms as number) ?? undefined, ...extra,
    });
    if (c.found && c.status === 'done') {
      const r = lrcOf(c.words, header);
      const totalMs = Math.round(performance.now() - t0);
      onDiag?.(diag(c, { cacheHit: true, totalMs, rtf: c.duration ? +(totalMs / 1000 / c.duration).toFixed(3) : undefined, recogniseMs: 0 }));
      if (r.lrc) onPartial(r.lrc, 1, 1);
      return { lrc: r.lrc, words: r.count };
    }
    if (cancelled) return null;
    let view: ServerView;
    let decodeMs = 0;
    let uploadMs = 0;
    if (c.found) {
      // a job for this file is already running (e.g. prefetched): join it and make it top priority
      view = await api<ServerView>(`/api/transcribe?${q}&priority=0&start=${opts.startAt}`, { method: 'POST', body: new Uint8Array(0) });
    } else {
      onProgress({ phase: 'decode', progress: 0 });
      const d0 = performance.now();
      const full = await decodeBytes(buf);
      const audio = opts.maxSeconds ? full.subarray(0, Math.round(opts.maxSeconds * SR)) : full;
      decodeMs = Math.round(performance.now() - d0);
      if (cancelled) return null;
      if (isSilent(audio)) return { lrc: '', words: 0 };
      onProgress({ phase: 'upload', progress: 0 });
      const u0 = performance.now();
      view = await api<ServerView>(`/api/transcribe?${q}&priority=0&start=${opts.startAt}&decode_ms=${decodeMs}`, {
        method: 'POST', body: toInt16(audio).buffer as ArrayBuffer, headers: { 'Content-Type': 'application/octet-stream' },
      });
      uploadMs = Math.round(performance.now() - u0);
    }
    jobId = view.id;
    let version = -1;
    let first: number | undefined;
    let last = { lrc: '', count: 0 };
    for (;;) {
      if (cancelled) return null;
      if (view.status === 'error') throw new Error(view.error || 'Transcription failed.');
      if (view.status === 'cancelled') return null;
      if ((view.version ?? 0) !== version) {
        version = view.version ?? 0;
        if (view.words.length) {
          last = lrcOf(view.words, header);
          if (last.lrc) {
            first ??= Math.round(performance.now() - t0);
            onPartial(last.lrc, view.sectionsDone ?? 0, view.sectionsTotal ?? 1);
          }
        }
      }
      const loadingModel = view.status === 'running' && !view.sectionsDone && view.timings.model_init_ms == null;
      onProgress({ phase: loadingModel ? 'model' : 'listen', progress: view.progress });
      if (view.status === 'done') break;
      await new Promise((r) => setTimeout(r, 500));
      view = await api<ServerView>(`/api/transcribe/${view.id}`);
    }
    const totalMs = Math.round(performance.now() - t0);
    onDiag?.(diag(view, { decodeMs, uploadMs, firstLyricsMs: first, totalMs, rtf: view.duration ? +(totalMs / 1000 / view.duration).toFixed(3) : undefined }));
    return { lrc: last.lrc, words: last.count };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      // finished sections stay cached on the server, so a later run resumes instead of restarting
      if (jobId) void fetch(`/api/transcribe/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
    },
  };
}

/**
 * Start transcribing an upcoming track in the background (lower priority than the playing one).
 * Nothing is shown; the result lands in the server's cache, so the track has lyrics when played.
 */
export async function prefetchTranscription(url: string, opts: Pick<TranscribeOptions, 'language' | 'model'>): Promise<'cached' | 'started' | 'skipped'> {
  const buf = await (await fetch(url)).arrayBuffer();
  const hash = await sha(buf);
  const q = `hash=${hash}&model=${opts.model}&lang=${opts.language ?? 'auto'}`;
  const c = await api<{ found: boolean; status?: string }>(`/api/transcribe/cache?${q}`);
  if (c.found) return c.status === 'done' ? 'cached' : 'started';
  const audio = await decodeBytes(buf);
  if (isSilent(audio)) return 'skipped';
  await api(`/api/transcribe?${q}&priority=1&start=0`, { method: 'POST', body: toInt16(audio).buffer as ArrayBuffer });
  return 'started';
}

// ---- in-browser fallback (Web Worker, single-threaded WebAssembly) --------------------------
let worker: Worker | null = null;
let seq = 0;

function getWorker() {
  if (!worker) worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function viaBrowser(url: string, opts: TranscribeOptions, onProgress: (p: TranscribeProgress) => void, onPartial: OnPartial, onDiag?: (d: TranscribeDiag) => void): TranscribeJob {
  const id = ++seq;
  let cancelled = false;
  let w: Worker | null = null;
  const header = opts.header ?? [];
  const promise = (async () => {
    const t0 = performance.now();
    onProgress({ phase: 'decode', progress: 0 });
    const full = await decode16k(url);
    const audio = opts.maxSeconds ? full.subarray(0, Math.round(opts.maxSeconds * SR)) : full;
    const decodeMs = Math.round(performance.now() - t0);
    const seconds = audio.length / SR;
    if (cancelled) return null;
    if (isSilent(audio)) return { lrc: '', words: 0 };
    const pieces = makePieces(audio, opts.startAt);
    w = getWorker();
    const raw: Word[] = [];
    let lrc = '';
    let count = 0;
    let first: number | undefined;
    let modelReady: number | undefined;
    const ok = await new Promise<boolean>((resolve, reject) => {
      const onMsg = (e: MessageEvent) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === 'progress') {
          if (m.phase === 'listen' && modelReady === undefined) modelReady = performance.now();
          onProgress({ phase: m.phase, progress: m.progress });
        } else if (m.type === 'partial') {
          raw.push(...(m.words as Word[]));
          const r = lrcOf(raw, header);
          count = r.count;
          lrc = r.lrc;
          if (lrc) {
            first ??= Math.round(performance.now() - t0);
            onPartial(lrc, m.done, m.total);
          }
        } else if (m.type !== 'device' && m.type !== 'language') {
          w!.removeEventListener('message', onMsg);
          w!.removeEventListener('error', onErr);
          if (m.type === 'done') resolve(true);
          else if (m.type === 'cancelled') resolve(false);
          else reject(new Error(m.message));
        }
      };
      const onErr = (e: ErrorEvent) => {
        w!.removeEventListener('message', onMsg);
        worker = null;
        reject(new Error(e.message || 'The transcription worker crashed.'));
      };
      w!.addEventListener('message', onMsg);
      w!.addEventListener('error', onErr);
      w!.postMessage({ type: 'run', id, audio, pieces, language: opts.language, model: opts.model, device: opts.device, dtype: opts.dtype }, [audio.buffer]);
    });
    if (!ok) return null;
    const totalMs = Math.round(performance.now() - t0);
    onDiag?.({
      engine: 'browser (WebAssembly, 1 thread)', model: opts.model, language: opts.language ?? 'auto', script: null, audioSeconds: +seconds.toFixed(1),
      cacheHit: false, decodeMs, modelInitMs: modelReady ? Math.round(modelReady - t0 - decodeMs) : null, firstLyricsMs: first, totalMs, rtf: +(totalMs / 1000 / seconds).toFixed(3),
    });
    return { lrc, words: count };
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      w?.postMessage({ type: 'cancel', id });
    },
  };
}

/** server available? (checked once; the health endpoint says whether it can transcribe) */
let serverOk: Promise<boolean> | null = null;
export const serverAvailable = () =>
  (serverOk ??= fetch('/api/health', { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .then((h: { transcribe?: boolean }) => !!h.transcribe)
    .catch(() => false));

/**
 * Transcribe a file. `onPartial` receives the complete LRC built from every section finished so
 * far (sections arrive in listening order, not song order), so lyrics can be shown right away.
 */
export function transcribe(
  url: string,
  opts: TranscribeOptions,
  onProgress: (p: TranscribeProgress) => void,
  onPartial: OnPartial,
  onDiag?: (d: TranscribeDiag) => void,
): TranscribeJob {
  let inner: TranscribeJob | null = null;
  let cancelled = false;
  const promise = (async () => {
    const useServer = opts.engine === 'server' || (opts.engine !== 'browser' && (await serverAvailable()));
    if (cancelled) return null;
    if (useServer) {
      inner = viaServer(url, opts, onProgress, onPartial, onDiag);
      try {
        return await inner.promise;
      } catch (e) {
        // 403 (not on this computer) or the server went away → fall back to the browser
        if ((e as { status?: number }).status === 400 || opts.engine === 'server') throw e;
        serverOk = null;
      }
      if (cancelled) return null;
    }
    inner = viaBrowser(url, opts, onProgress, onPartial, onDiag);
    return inner.promise;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
      inner?.cancel();
    },
  };
}
