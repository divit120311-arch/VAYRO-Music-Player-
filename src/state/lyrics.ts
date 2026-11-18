import { createStore } from '../store';
import { playerStore, currentTrack, seek, setPlaybackGate } from './player';
import { settingsStore } from './settings';
import { audioEngine } from '../engine/audioEngine';
import { lightingEngine } from '../engine/lightingEngine';
import { alignPreview, cachedAlignment, shiftDoc, timePlainLines, timePreviewPlain, wordsOfLrc } from '../services/previewAlign';
import { cleanTitle, docFromUserText, lookupLyrics, lyricsTextById, reliableArtist } from '../services/lyricsProvider';
import { demoLyricsLrc } from '../services/demoLyrics';
import { prefetchTranscription, transcribe, type TranscribeDiag, type TranscribeJob, type TranscribePhase } from '../services/transcriber';
import { formatLrcTime, parseLrc } from '../utils/lrc';
import type { LyricsDoc, LyricsStatus, UserLyricsSource } from '../types/lyrics';
import type { Track } from '../types/music';

export interface LyricsState {
  trackId: string | null;
  status: LyricsStatus;
  doc: LyricsDoc | null;
  error: string | null;
  /** seconds added to the playback clock when looking up the active line */
  offset: number;
  /** true when the doc is user-supplied (or transcribed) and saved on this device */
  saved: boolean;
  /** on-device transcription in progress */
  job: { phase: TranscribePhase; progress: number } | null;
  /** measurements of the last transcription (diagnostics panel) */
  diag: TranscribeDiag | null;
  /** listening to a preview to time its lyrics (playback waits for this) */
  syncing: boolean;
  /** playback is being held until the lyrics are synced */
  waiting: boolean;
}

export const lyricsStore = createStore<LyricsState>({
  trackId: null, status: 'idle', doc: null, error: null, offset: 0, saved: false, job: null, diag: null, syncing: false, waiting: false,
});

const set = lyricsStore.setState;
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** stable key per song (local files get new ids each upload, so key by artist+title) */
export const lyricsKey = (t: Track) => `${norm(t.artist)}|${norm(t.title)}`;
/** only the user's own files are transcribed (we can read their samples, and it's their copy) */
export const canTranscribe = (t: Track | null | undefined) => !!t && t.provider === 'local';

const LS_DOC = 'afterglow:lyrics:';
const LS_OFF = 'afterglow:lyrics-offset:';
const read = (k: string) => {
  try { return localStorage.getItem(k); } catch { return null; }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* storage full/blocked: lyrics just won't persist */ }
};

let token = 0;
let abort: AbortController | null = null;
let job: TranscribeJob | null = null;

function stopJob() {
  job?.cancel();
  job = null;
}

async function loadFor(track: Track | null, force = false, noTranscribe = false) {
  const my = ++token;
  abort?.abort();
  abort = null;
  stopJob();
  if (!track) return set({ trackId: null, status: 'idle', doc: null, error: null, offset: 0, saved: false, job: null, syncing: false });
  if (!force && lyricsStore.getState().trackId === track.id && lyricsStore.getState().status !== 'error') return;

  if (!settingsStore.getState().lyricsEnabled) return set({ trackId: track.id, status: 'off', doc: null, error: null, saved: false, job: null });
  // Spotify's developer terms don't allow syncing its recordings with lyrics: none while it plays
  if (track.provider === 'spotify') {
    return set({ trackId: track.id, status: 'unavailable', doc: null, saved: false, job: null, error: 'Lyrics are off while Spotify plays: Spotify’s developer terms don’t allow syncing its recordings with lyrics.' });
  }
  const key = lyricsKey(track);
  const offset = Number(read(LS_OFF + key)) || 0;
  set({ trackId: track.id, status: 'loading', doc: null, error: null, offset, saved: false, job: null, syncing: false });

  // 1. lyrics the user supplied (or a transcription made earlier) for this song
  const saved = read(LS_DOC + key);
  if (saved) {
    try {
      const { text, source } = JSON.parse(saved) as { text: string; source: UserLyricsSource };
      const doc = docFromUserText(text, source);
      if (doc) return set({ status: 'ready', doc, saved: true });
    } catch { /* corrupt entry: ignore */ }
  }
  // 2. sample lyrics for the built-in demo
  if (track.provider === 'demo') {
    const lines = parseLrc(demoLyricsLrc());
    return set({ status: 'ready', doc: { kind: 'synced', lines, hasWordSync: true, source: 'sample', attribution: 'Sample lyrics written for the Vayro demo' } });
  }
  // 3. lyrics inside the file (ID3 SYLT/USLT) or a matching .lrc dropped with it
  let fallback: LyricsDoc | null = null;
  if (track.embeddedLyrics) {
    const doc = docFromUserText(track.embeddedLyrics.text, track.embeddedLyrics.from === 'sidecar' ? 'file' : 'embedded');
    if (doc?.kind === 'synced') return set({ status: 'ready', doc });
    fallback = doc;
  }
  const settings = settingsStore.getState();
  const transcribable = canTranscribe(track) && settings.transcribeUploads;

  // 4. online lookup (exact synced lyrics beat a machine transcription)
  // untagged files are searchable by title: the server matches on duration to pick the right version
  const reliable = !!cleanTitle(track.title) && (reliableArtist(track.artist) || track.provider === 'local');
  if (settings.onlineLyrics && playerStore.getState().backend.ok && reliable) {
    const ac = new AbortController();
    abort = ac;
    try {
      // the duration is the strongest match signal — wait briefly for the media to report it
      // a full-length stand-in for a library song is matched on the album recording's length
      let duration = track.catalogDuration ?? track.duration ?? 0;
      for (let i = 0; i < 20 && !duration && my === token; i++) {
        await new Promise((r) => setTimeout(r, 150));
        duration = audioEngine.duration;
      }
      const r = await lookupLyrics(track, duration, settings.lyricsScript, ac.signal);
      if (my !== token) return;
      // a 30-second preview starts somewhere in the middle of the song: listen to it, find where it
      // sits in the song, and shift the lyrics onto it. Until then (or if that can't be confirmed)
      // the words are shown as text, never as falsely synced lines.
      if (r.kind === 'doc' && r.doc.kind === 'synced' && track.preview) return linePreview(track, r.doc, my);
      // only untimed text exists for this song: time it by listening to the preview
      if (r.kind === 'doc' && r.doc.kind === 'plain' && track.preview && r.doc.plain?.length) return timePlainPreview(track, r.doc, r.doc.plain, my);
      if (r.kind === 'doc' && r.doc.kind === 'synced') return set({ status: 'ready', doc: r.doc });
      if (r.kind === 'instrumental') return set({ status: 'instrumental' });
      if (r.kind === 'doc') fallback ??= r.doc;
    } catch (e) {
      if (my !== token || (e as Error).name === 'AbortError') return;
      if (!transcribable && !fallback) return set({ status: 'error', error: (e as Error).message });
    }
  }

  // 5. transcribe the user's own file on this device → word-synced lyrics
  if (transcribable && !noTranscribe) return runTranscription(track, my, fallback);

  // 6. unsynced text, clearly labelled
  if (fallback) return set({ status: 'ready', doc: fallback });
  if (!settings.onlineLyrics && !canTranscribe(track)) return set({ status: 'disabled' });
  if (!playerStore.getState().backend.ok && !canTranscribe(track)) {
    return set({ status: 'unavailable', error: 'The Vayro server isn’t running, so online lyrics can’t be looked up.' });
  }
  if (!reliable && !canTranscribe(track)) return set({ status: 'unavailable', error: 'This track has no reliable artist/title to search with.' });
  set({ status: 'unavailable' });
}

/** full-song lyrics for a preview clip: the words, without timing */
function previewText(doc: LyricsDoc, note: string): LyricsDoc {
  return { kind: 'plain', lines: [], plain: doc.lines.map((l) => l.text), hasWordSync: false, source: doc.source, attribution: `${doc.attribution ?? 'LRCLIB'} · ${note}` };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function linePreview(track: Track, doc: LyricsDoc, my: number) {
  set({ status: 'ready', doc: previewText(doc, 'listening to the 30-second preview to line the lyrics up…'), syncing: true });
  const sig = { cancelled: false };
  const watch = setInterval(() => my !== token && (sig.cancelled = true), 250);
  try {
    const a = await alignPreview(track, doc, sig);
    if (my !== token) return;
    if (a) {
      const how = a.guess
        ? `best guess where this 30-second preview starts (${mmss(a.offset)} into the song) · use Sync if it's off`
        : `lined up with this 30-second preview by listening (it starts ${mmss(a.offset)} into the song)`;
      set({ status: 'ready', doc: shiftDoc(doc, a, `${doc.attribution ?? 'LRCLIB'} · ${how}`) });
    } else {
      // the song's own timestamps couldn't be placed: time the words from what the clip sings instead
      clearInterval(watch);
      return await timePlainPreview(track, doc, doc.lines.map((l) => l.text), my);
    }
  } catch {
    if (my === token) set({ status: 'ready', doc: previewText(doc, "this 30-second preview couldn't be lined up with the lyrics, so they're shown as text") });
  } finally {
    clearInterval(watch);
    if (my === token) set({ syncing: false });
  }
  if (my === token) void prepareNextPreview();
}

/** untimed lyrics for a preview: listen to the clip and time each line from the words heard */
async function timePlainPreview(track: Track, doc: LyricsDoc, texts: string[], my: number) {
  const base = doc.kind === 'plain' ? doc : previewText(doc, '');
  set({ status: 'ready', doc: { ...base, attribution: `${doc.attribution ?? 'LRCLIB'} · listening to the 30-second preview to time the lyrics…` }, syncing: true });
  const sig = { cancelled: false };
  const watch = setInterval(() => my !== token && (sig.cancelled = true), 250);
  try {
    const lines = await timePreviewPlain(track, texts, sig);
    if (my !== token) return;
    if (lines?.length) {
      return set({
        status: 'ready',
        doc: { kind: 'synced', lines, hasWordSync: false, source: doc.source, attribution: `${doc.attribution ?? 'LRCLIB'} · timed by listening to this 30-second preview` },
      });
    }
    set({ status: 'ready', doc: { ...base, attribution: `${doc.attribution ?? 'LRCLIB'} · no singing in this preview could be matched to the lyrics, so they're shown as text` } });
  } catch {
    if (my === token) set({ status: 'ready', doc: base });
  } finally {
    clearInterval(watch);
    if (my === token) {
      set({ syncing: false });
      void prepareNextPreview();
    }
  }
}

// ---- hold playback until the lyrics are synced ----------------------------------------------
// A library preview doesn't start until its lyrics are timed (usually 10–50 s the first time,
// instant afterwards). Never longer than WAIT_MAX, and "Play now" skips the wait.
const WAIT_MAX = 120_000;
let skipWait: (() => void) | null = null;

/** start the held song now, without waiting for the lyrics */
export function playWithoutWaiting() {
  skipWait?.();
}

setPlaybackGate((track) => {
  const s = settingsStore.getState();
  if (!track.preview || !s.lyricsEnabled || !s.onlineLyrics || !playerStore.getState().backend.ok) return null;
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      if (skipWait === finish) skipWait = null;
      set({ waiting: false });
      resolve();
    };
    const check = () => {
      if (currentTrack()?.id !== track.id) return finish(); // moved on to another song
      const st = lyricsStore.getState();
      if (st.trackId !== track.id || st.syncing || st.status === 'loading' || st.status === 'idle') return;
      finish();
    };
    const unsub = lyricsStore.subscribe(check);
    const timer = setTimeout(finish, WAIT_MAX);
    skipWait = finish;
    set({ waiting: true });
    check();
  });
});

/** line up the next queued preview in the background, so its lyrics animate from the first second */
async function prepareNextPreview() {
  const s = playerStore.getState();
  const next = s.queue[s.index + 1];
  const settings = settingsStore.getState();
  if (!next?.preview || !settings.onlineLyrics || cachedAlignment(next.id) || !reliableArtist(next.artist)) return;
  try {
    const r = await lookupLyrics(next, next.duration ?? 0, settings.lyricsScript);
    if (r.kind !== 'doc') return;
    const sig = { cancelled: false };
    // the same steps the song will take when it plays, so it starts without waiting
    if (r.doc.kind === 'synced') {
      if (!(await alignPreview(next, r.doc, sig))) await timePreviewPlain(next, r.doc.lines.map((l) => l.text), sig);
    } else if (r.doc.plain?.length) await timePreviewPlain(next, r.doc.plain, sig);
  } catch { /* it will be tried again when the song plays */ }
}

async function runTranscription(track: Track, my: number, fallback: LyricsDoc | null) {
  set({ status: 'transcribing', job: { phase: 'decode', progress: 0 } });
  // let playback start first: decoding the whole file competes with the media element's own load
  for (let i = 0; i < 30 && audioEngine.paused && my === token; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 400));
  if (my !== token) return;
  const s = settingsStore.getState();
  const language = s.transcribeLanguage === 'auto' ? undefined : s.transcribeLanguage;
  const header = [`[ti:${track.title}]`, `[ar:${track.artist}]`, `[re:Vayro on-device transcription (Whisper ${s.transcribeModel})]`];
  const j = transcribe(
    track.streamUrl,
    { language, model: s.transcribeModel, startAt: audioEngine.currentTime, header },
    (p) => my === token && set({ job: { ...lyricsStore.getState().job, ...p } }),
    // show each finished section immediately: the lyrics fill in while the rest is processed
    (lrc, done, total) => {
      if (my !== token) return;
      const doc = docFromUserText(lrc, 'transcribed');
      if (doc) set({ status: 'ready', doc, job: done >= total ? null : { phase: 'listen', progress: done / total } });
    },
    (diag) => set({ diag }),
  );
  job = j;
  try {
    const r = await j.promise;
    if (my !== token || !r) return;
    job = null;
    if (!r.lrc) {
      if (fallback) return set({ status: 'ready', doc: fallback, job: null });
      return set({ status: 'unavailable', job: null, error: 'No singing was recognised in this file. If it does have vocals, you can paste or load lyrics instead.' });
    }
    // the real (untimed) lyrics are known: show THEM, timed by the transcription, rather than the
    // recogniser's own words (which mishear)
    if (fallback?.kind === 'plain' && fallback.plain?.length) {
      const lines = timePlainLines(wordsOfLrc(r.lrc), fallback.plain);
      if (lines?.length) {
        const lrc = lines.map((l) => `[${formatLrcTime(Math.max(0, l.t))}]${l.text}`).join('\n');
        const source = fallback.source === 'lrclib' || fallback.source === 'embedded' || fallback.source === 'file' ? fallback.source : 'manual';
        write(LS_DOC + lyricsKey(track), JSON.stringify({ text: lrc, source }));
        set({
          status: 'ready',
          doc: { kind: 'synced', lines, hasWordSync: false, source, attribution: `${fallback.attribution ?? 'Lyrics'} · timed by listening to your file` },
          saved: true,
          job: null,
        });
        void prefetchNext();
        return;
      }
    }
    write(LS_DOC + lyricsKey(track), JSON.stringify({ text: r.lrc, source: 'transcribed' }));
    const doc = docFromUserText(r.lrc, 'transcribed');
    set({ status: 'ready', doc, saved: true, job: null });
    void prefetchNext();
  } catch (e) {
    if (my !== token) return;
    job = null;
    const msg = (e as Error).message || String(e);
    if (fallback) return set({ status: 'ready', doc: fallback, job: null });
    set({ status: 'error', job: null, error: `Transcription failed: ${msg}` });
  }
}

/**
 * After the playing track is done, transcribe the NEXT queued upload in the background (lower
 * priority on the server), so it already has lyrics when it starts. Skipped when that track has
 * lyrics of its own, saved lyrics, or synced lyrics on LRCLIB. Never touches the whole library.
 */
const prefetched = new Set<string>();
async function prefetchNext() {
  const s = settingsStore.getState();
  const { queue, index } = playerStore.getState();
  const next = queue[index + 1];
  if (!s.lyricsEnabled || !s.transcribeUploads || !next || !canTranscribe(next) || prefetched.has(next.id)) return;
  prefetched.add(next.id);
  if (read(LS_DOC + lyricsKey(next)) || (next.embeddedLyrics && /^\s*\[\d/m.test(next.embeddedLyrics.text))) return;
  try {
    if (s.onlineLyrics && playerStore.getState().backend.ok && cleanTitle(next.title)) {
      const r = await lookupLyrics(next, next.duration ?? 0, s.lyricsScript);
      if (r.kind === 'doc' && r.doc.kind === 'synced') return;
    }
    if (job) return; // something more important started meanwhile
    await prefetchTranscription(next.streamUrl, { language: s.transcribeLanguage === 'auto' ? undefined : s.transcribeLanguage, model: s.transcribeModel });
  } catch {
    /* prefetch is best-effort (server not running, network error…) */
  }
}

// While a transcription runs, ease the lighting to 30 fps so the speech model gets the CPU
// (2-core machines: the renderer and the model otherwise compete for the same cores).
const easeLighting = () => {
  lightingEngine.maxFps = lyricsStore.getState().job && settingsStore.getState().transcribeEaseLighting ? 30 : 0;
};
lyricsStore.subscribe(easeLighting);
settingsStore.subscribe(easeLighting);

// follow the current track
let lastId: string | null = null;
playerStore.subscribe(() => {
  const t = currentTrack();
  // the same song can switch source (preview → its full-length Spotify stand-in): the
  // lyrics clock and rules differ per source, so a source change reloads them
  const id = t ? `${t.id}|${t.provider}` : null;
  if (id !== lastId) {
    lastId = id;
    void loadFor(t, true);
  }
});
let lastOnline = settingsStore.getState().onlineLyrics;
let lastTranscribe = settingsStore.getState().transcribeUploads;
let lastEnabled = settingsStore.getState().lyricsEnabled;
settingsStore.subscribe(() => {
  const s = settingsStore.getState();
  if (s.lyricsEnabled !== lastEnabled) {
    lastEnabled = s.lyricsEnabled;
    void loadFor(currentTrack(), true);
    return;
  }
  if (s.onlineLyrics !== lastOnline || s.transcribeUploads !== lastTranscribe) {
    lastOnline = s.onlineLyrics;
    lastTranscribe = s.transcribeUploads;
    const st = lyricsStore.getState().status;
    if (st === 'disabled' || st === 'unavailable' || st === 'error' || (st === 'transcribing' && !s.transcribeUploads)) void loadFor(currentTrack(), true);
  }
  if (s.lyricsScript !== lastScript) {
    lastScript = s.lyricsScript;
    // online lyrics in the other script (e.g. Devanagari ↔ Roman Hindi) — refetch unless the user saved their own
    const st = lyricsStore.getState();
    if (!st.saved && (st.doc?.source === 'lrclib' || st.status === 'unavailable' || st.status === 'transcribing')) void loadFor(currentTrack(), true);
  }
});
let lastScript = settingsStore.getState().lyricsScript;

/** The user picked a version in the search dialog: save it for this song and show it. */
export async function pickLyrics(id: number): Promise<string | null> {
  const t = currentTrack();
  if (!t) return 'Play a track first.';
  try {
    const text = await lyricsTextById(id);
    if (!text) return 'That entry has no lyrics text.';
    return setUserLyrics(text, 'lrclib');
  } catch (e) {
    return (e as Error).message || 'Couldn’t load those lyrics.';
  }
}

export function retryLyrics() {
  void loadFor(currentTrack(), true);
}

/** Transcribe the current (local) track now, replacing whatever lyrics are shown. */
export function transcribeCurrent() {
  const t = currentTrack();
  if (!canTranscribe(t)) return;
  const my = ++token;
  abort?.abort();
  stopJob();
  set({ trackId: t!.id, doc: null, error: null, saved: false });
  void runTranscription(t!, my, null);
}

export function cancelTranscription() {
  const t = currentTrack();
  ++token;
  stopJob();
  // keep whatever sections were already transcribed on screen
  if (lyricsStore.getState().doc) return set({ status: 'ready', job: null });
  set({ status: 'unavailable', job: null, error: t ? 'Transcription stopped. You can start it again, or add lyrics yourself.' : null });
}

/** the text saved for the current song (to edit a transcription or an earlier paste) */
export function savedLyricsText(): string | null {
  const t = currentTrack();
  if (!t) return null;
  try {
    return (JSON.parse(read(LS_DOC + lyricsKey(t)) ?? 'null') as { text: string } | null)?.text ?? null;
  } catch {
    return null;
  }
}

/** Save user-supplied lyrics (pasted text or an .lrc/.txt file) for the current song. */
export function setUserLyrics(text: string, source: UserLyricsSource): string | null {
  const t = currentTrack();
  if (!t) return 'Play a track first, then add lyrics for it.';
  const doc = docFromUserText(text, source);
  if (!doc) return 'That file is empty.';
  if (text.length > 200_000) return 'That lyrics file is unusually large (over 200 KB).';
  stopJob();
  ++token;
  write(LS_DOC + lyricsKey(t), JSON.stringify({ text, source }));
  set({ trackId: t.id, status: 'ready', doc, error: null, saved: true, job: null });
  return null;
}

export function removeUserLyrics() {
  const t = currentTrack();
  if (!t) return;
  write(LS_DOC + lyricsKey(t), null);
  void loadFor(t, true, true); // don't immediately re-transcribe what the user just removed
}

export function nudgeOffset(delta: number) {
  const t = currentTrack();
  const offset = Math.round((lyricsStore.getState().offset + delta) * 10) / 10;
  set({ offset });
  if (t) write(LS_OFF + lyricsKey(t), offset ? String(offset) : null);
}

/** Jump playback to the previous / next lyric line (dir -1 / +1). */
export function stepLine(dir: -1 | 1) {
  const { doc, offset } = lyricsStore.getState();
  if (!doc || doc.kind !== 'synced' || !doc.lines.length) return;
  const t = audioEngine.currentTime + offset;
  const lines = doc.lines.filter((l) => l.text.trim());
  let i = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].t <= t + 0.05) i = k;
  // "previous" restarts the current line first when we're more than 1.5 s into it
  const target = dir > 0 ? lines[i + 1] : i >= 0 && t - lines[i].t > 1.5 ? lines[i] : lines[Math.max(0, i - 1)];
  if (target) seek(Math.max(0, target.t - offset + 0.01));
}

export function resetOffset() {
  nudgeOffset(-lyricsStore.getState().offset);
}
