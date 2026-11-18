import { createStore } from '../store';
import { audioEngine, proxyUrl } from '../engine/audioEngine';
import { systemPlayer } from '../engine/systemPlayer';
import { extractPalette } from '../utils/colorUtils';
import { resolveFull } from '../services/fullSources';
import { settingsStore } from './settings';
import type { AnalysisStatus, PlayerStatus, RepeatMode, Track } from '../types/music';

export interface PlayerState {
  queue: Track[];
  index: number;
  status: PlayerStatus;
  error: string | null;
  analysis: AnalysisStatus;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** colours sampled from the current artwork, when readable */
  palette: [string, string] | null;
  backend: { checked: boolean; ok: boolean; jamendo: boolean };
  notice: { id: number; text: string; tone: 'info' | 'error' } | null;
}

const VOL_KEY = 'afterglow:volume:v1';
const savedVol = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(VOL_KEY) || 'null');
    return v && typeof v.volume === 'number' ? v : null;
  } catch {
    return null;
  }
})();

export const playerStore = createStore<PlayerState>({
  queue: [],
  index: -1,
  status: 'idle',
  error: null,
  analysis: 'none',
  duration: 0,
  volume: savedVol?.volume ?? 0.8,
  muted: false,
  repeat: 'all',
  shuffle: false,
  palette: null,
  backend: { checked: false, ok: false, jamendo: false },
  notice: null,
});

const get = playerStore.getState;
const set = playerStore.setState;

export const currentTrack = (s: PlayerState = get()) => (s.index >= 0 ? s.queue[s.index] ?? null : null);

let noticeId = 0;
export function notify(text: string, tone: 'info' | 'error' = 'info') {
  const id = ++noticeId;
  set({ notice: { id, text, tone } });
  window.setTimeout(() => {
    if (get().notice?.id === id) set({ notice: null });
  }, tone === 'error' ? 7000 : 3800);
}

// ---- engine wiring -------------------------------------------------------------
audioEngine.setVolume(get().volume, get().muted);

audioEngine.on('status', (status, message) => {
  if (status === 'error') {
    set({ status: 'error', error: message ?? 'Playback failed.' });
  } else if (status === 'blocked') {
    set({ status: 'blocked', error: null });
  } else {
    set({ status, error: null });
  }
  updateMediaSessionState();
});
audioEngine.on('analysis', (analysis) => set({ analysis }));
audioEngine.on('duration', (duration) => set({ duration }));
audioEngine.on('ended', () => {
  const { repeat } = get();
  if (repeat === 'one') {
    audioEngine.seek(0);
    void audioEngine.play();
  } else next(true);
});

// ---- artwork palette -------------------------------------------------------------
let paletteToken = 0;
function samplePalette(track: Track | null) {
  const token = ++paletteToken;
  set({ palette: null });
  if (!track?.artwork) return;
  const tryUrl = (url: string, fallback?: string) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (token !== paletteToken) return;
      const p = extractPalette(img);
      if (p) set({ palette: p });
      else if (fallback) tryUrl(fallback);
    };
    img.onerror = () => fallback && token === paletteToken && tryUrl(fallback);
    img.src = url;
  };
  const art = track.artwork;
  const remote = /^https?:/.test(art) && !art.startsWith(location.origin);
  tryUrl(art, remote && get().backend.ok ? proxyUrl(art) : undefined);
}

// ---- core actions ----------------------------------------------------------------
let loadToken = 0;

/**
 * Something that must finish before a track starts playing (the lyrics module registers one so a
 * preview waits until its lyrics are time-synced). Returns null when there is nothing to wait for.
 * Registered from outside to avoid an import cycle (lyrics already depends on the player).
 */
type PlaybackGate = (track: Track) => Promise<void> | null;
let playbackGate: PlaybackGate | null = null;
export function setPlaybackGate(gate: PlaybackGate | null) {
  playbackGate = gate;
}
/** the preview-only library track a full-length source stood in for, to restore it if that source is turned off */
const originals = new Map<string, Track>();

async function loadIndex(index: number, autoplay: boolean) {
  const my = ++loadToken;
  const { queue } = get();
  let track = queue[index];
  if (!track) return;
  if (autoplay) audioEngine.unlock(); // still inside the click that triggered this
  // a library song that only has a 30-second preview: look for the full song first
  if (track.preview && settingsStore.getState().preferFullSongs) {
    set({ index, error: null, status: 'loading', duration: track.duration ?? 0 });
    const r = await resolveFull(track).catch((e) => ({ reason: (e as Error).message }));
    if (my !== loadToken) return;
    if ('track' in r) {
      originals.set(track.id, track);
      track = r.track;
      const q = [...get().queue];
      if (q[index]?.id === track.id) q[index] = track;
      set({ queue: q });
    } else if (r.reason !== 'own-player') {
      notify(`Full song not available (${r.reason}). Playing Apple’s 30-second preview.`, 'info');
    }
  }
  set({ index, error: null, duration: track.duration ?? 0 });
  samplePalette(track);
  updateMediaSession(track);
  if (!track.playable) {
    set({ status: 'error', error: 'The provider does not allow streaming this track.' });
    return;
  }
  const res = await audioEngine.load(track);
  if (!res.ok) {
    if (res.error !== 'superseded') notify(`Couldn’t load “${track.title}”: ${res.error}`, 'error');
    return;
  }
  if (audioEngine.analysis === 'unavailable') {
    notify('This source blocks cross-origin access, so it plays without music-reactive lighting.', 'info');
  }
  // hold the start until the lyrics are synced, then play from the top
  const gate = autoplay ? playbackGate?.(track) : null;
  if (gate) {
    set({ status: 'loading' });
    await gate;
    if (my !== loadToken) return;
    if (!audioEngine.paused) return; // the user chose "Play now" and it's already playing
    audioEngine.seek(0);
  }
  if (autoplay) await audioEngine.play();
}

/** Replace the queue and start playing at `startIndex`. */
export function playTracks(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  revokeQueueExcept(tracks);
  set({ queue: tracks, index: -1 });
  void loadIndex(startIndex, true);
}

/** Play one track now, inserting it after the current one (keeps the queue). */
export function playNow(track: Track) {
  const { queue, index } = get();
  const existing = queue.findIndex((t) => t.id === track.id);
  if (existing >= 0) return void loadIndex(existing, true);
  const at = index + 1;
  set({ queue: [...queue.slice(0, at), track, ...queue.slice(at)] });
  void loadIndex(at, true);
}

/**
 * Play a list (album, top tracks…) without throwing away the rest of the queue:
 * the list is inserted after the current track and playback jumps to `startIndex` of it.
 */
export function playList(tracks: Track[], startIndex = 0) {
  if (!tracks.length) return;
  const { queue, index } = get();
  const ids = new Set(tracks.map((t) => t.id));
  const kept = queue.filter((t) => !ids.has(t.id));
  const cur = index >= 0 ? queue[index] : null;
  let at = kept.length; // nothing playing → append
  if (cur) {
    const ci = kept.indexOf(cur);
    at = ci >= 0 ? ci + 1 : Math.min(index, kept.length); // after the current track (or where it was)
  }
  set({ queue: [...kept.slice(0, at), ...tracks, ...kept.slice(at)], index: -1 });
  void loadIndex(at + startIndex, true);
}

export function enqueue(tracks: Track[], { autoplay = false } = {}) {
  const { queue } = get();
  const fresh = tracks.filter((t) => !queue.some((q) => q.id === t.id));
  if (!fresh.length) return;
  set({ queue: [...queue, ...fresh] });
  if (autoplay || get().index < 0) void loadIndex(queue.length, autoplay);
}

export function jumpTo(index: number) {
  void loadIndex(index, true);
}

export function togglePlay() {
  const s = get();
  if (s.index < 0) return;
  audioEngine.unlock();
  if (s.status === 'error') return void loadIndex(s.index, true);
  if (audioEngine.paused) void audioEngine.play();
  else audioEngine.pause();
}

export function next(auto = false) {
  const { queue, index, shuffle, repeat } = get();
  if (!queue.length) return;
  // Now Playing mode: the other app owns the queue — skip there
  if (queue[index]?.provider === 'system') return void (!auto && systemPlayer.next());
  let to: number;
  if (shuffle && queue.length > 1) {
    do to = Math.floor(Math.random() * queue.length);
    while (to === index);
  } else {
    to = index + 1;
    if (to >= queue.length) {
      if (auto && repeat === 'off') {
        audioEngine.pause();
        audioEngine.seek(0);
        return;
      }
      to = 0;
    }
  }
  void loadIndex(to, true);
}

let restartedAt = 0;
export function prev() {
  const { queue, index } = get();
  if (!queue.length) return;
  if (queue[index]?.provider === 'system') return systemPlayer.prev();
  // more than 3 s in: restart the song — unless we just did (a provider's clock can lag a moment
  // behind a seek, so a quick second press must still go to the previous song)
  if (audioEngine.currentTime > 3 && performance.now() - restartedAt > 3000) {
    restartedAt = performance.now();
    return audioEngine.seek(0);
  }
  restartedAt = 0;
  void loadIndex(index <= 0 ? queue.length - 1 : index - 1, true);
}

export function seek(seconds: number) {
  audioEngine.seek(seconds);
}

export function seekBy(delta: number) {
  audioEngine.seek(audioEngine.currentTime + delta);
}

export function setVolume(volume: number) {
  const v = Math.max(0, Math.min(1, volume));
  set({ volume: v, muted: v === 0 ? get().muted : false });
  audioEngine.setVolume(v, get().muted);
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify({ volume: v }));
  } catch { /* ignore */ }
}

export function toggleMute() {
  const muted = !get().muted;
  set({ muted });
  audioEngine.setVolume(get().volume, muted);
}

export function cycleRepeat() {
  const order: RepeatMode[] = ['all', 'one', 'off'];
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
}

export function toggleShuffle() {
  set({ shuffle: !get().shuffle });
}

export function removeFromQueue(id: string) {
  const { queue, index } = get();
  const i = queue.findIndex((t) => t.id === id);
  if (i < 0) return;
  queue[i].revokable?.forEach((u) => URL.revokeObjectURL(u));
  const nextQueue = queue.filter((_, k) => k !== i);
  if (i === index) {
    audioEngine.stop();
    set({ queue: nextQueue, index: -1, status: 'idle', duration: 0, palette: null });
    if (nextQueue.length) void loadIndex(Math.min(i, nextQueue.length - 1), false);
    else updateMediaSession(null);
  } else {
    set({ queue: nextQueue, index: i < index ? index - 1 : index });
  }
}

export function clearQueue() {
  revokeQueueExcept([]);
  audioEngine.stop();
  set({ queue: [], index: -1, status: 'idle', duration: 0, error: null, palette: null });
  updateMediaSession(null);
}

function revokeQueueExcept(keep: Track[]) {
  const ids = new Set(keep.map((t) => t.id));
  get().queue.forEach((t) => !ids.has(t.id) && t.revokable?.forEach((u) => URL.revokeObjectURL(u)));
}

// ---- Media Session (hardware media keys, OS overlays) -------------------------------
function updateMediaSession(track: Track | null) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = track
    ? new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album ?? 'Vayro',
        artwork: track.artwork ? [{ src: track.artwork, sizes: '512x512' }] : [],
      })
    : null;
}
function updateMediaSessionState() {
  if (!('mediaSession' in navigator)) return;
  const st = get().status;
  navigator.mediaSession.playbackState = st === 'playing' || st === 'buffering' ? 'playing' : get().index >= 0 ? 'paused' : 'none';
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const safe = (a: MediaSessionAction, h: MediaSessionActionHandler) => {
    try { ms.setActionHandler(a, h); } catch { /* unsupported action */ }
  };
  safe('play', () => void audioEngine.play());
  safe('pause', () => audioEngine.pause());
  safe('previoustrack', prev);
  safe('nexttrack', () => next());
  safe('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  safe('seekbackward', () => seekBy(-10));
  safe('seekforward', () => seekBy(10));
}
