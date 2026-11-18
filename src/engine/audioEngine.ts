import type { AnalysisStatus, Track } from '../types/music';
import type { ExternalPlayer } from './external';
import { spotifyPlayer } from './spotifyPlayer';
import { systemPlayer } from './systemPlayer';

/**
 * Owns the audio graph:
 *
 *   <audio crossOrigin="anonymous">  ──► MediaElementSource ──► Analyser ──► Gain ──► speakers
 *
 * The analyser sits *before* the gain so the lighting keeps reacting at low volume.
 *
 * A second, plain <audio> element (no crossOrigin, never connected to Web Audio) is the
 * fallback for sources that refuse cross-origin access even through our proxy. Those
 * still play, but samples are unreadable by design (the browser zeroes them), so the
 * UI reports analysis as "unavailable" instead of pretending.
 *
 * Full-length songs from Spotify (Web Playback SDK) and the Now Playing app play
 * inside those providers' own players: the engine delegates every call to them, so the queue,
 * seeking, the lyrics clock and the progress bar all follow the provider's real playback clock.
 * Their audio is never readable here, so analysis is reported as "provider" (ambient lighting).
 */

type AttemptKind = 'direct' | 'proxy' | 'plain';
interface Attempt { kind: AttemptKind; url: string }

export interface EngineEvents {
  status: (s: 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'error', message?: string) => void;
  analysis: (a: AnalysisStatus) => void;
  duration: (d: number) => void;
  ended: () => void;
}

const LOAD_TIMEOUT_MS = 20000;

export function proxyUrl(url: string) {
  return `/api/stream?url=${encodeURIComponent(url)}`;
}

function describeMediaError(err: MediaError | null, kind: AttemptKind): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_ABORTED: return 'Loading was aborted.';
    case MediaError.MEDIA_ERR_NETWORK: return 'A network error interrupted the audio.';
    case MediaError.MEDIA_ERR_DECODE: return 'The audio file appears to be corrupted or uses an unsupported codec.';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return kind === 'direct'
        ? 'The source blocked cross-origin access or the format is unsupported.'
        : 'This format is not supported by your browser, or the link is not an audio file.';
    default: return 'The audio could not be loaded.';
  }
}

export class AudioEngine {
  readonly analysedEl: HTMLAudioElement;
  readonly plainEl: HTMLAudioElement;
  active: HTMLAudioElement;
  analysis: AnalysisStatus = 'none';

  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  freq: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  time: Uint8Array<ArrayBuffer> = new Uint8Array(2048);

  private token = 0;
  /** the provider player handling the current track, if any */
  external: ExternalPlayer | null = null;
  private volume = 0.8;
  private muted = false;
  backendAvailable = true;
  private handlers: Partial<EngineEvents> = {};

  constructor() {
    this.analysedEl = this.makeEl(true);
    this.plainEl = this.makeEl(false);
    this.active = this.analysedEl;
    for (const x of [spotifyPlayer, systemPlayer] as ExternalPlayer[]) {
      x.onEvent((e) => {
        if (this.external !== x) return;
        if (e.type === 'duration') this.emit('duration', e.seconds);
        else if (e.type === 'ended') this.emit('ended');
        else if (e.type === 'error') this.emit('status', 'error', e.message);
        else this.emit('status', e.type);
      });
    }
    window.addEventListener('pagehide', (e) => {
      if (!e.persisted) this.dispose();
    });
  }

  on<K extends keyof EngineEvents>(k: K, fn: EngineEvents[K]) {
    this.handlers[k] = fn;
  }

  private emit<K extends keyof EngineEvents>(k: K, ...args: Parameters<EngineEvents[K]>) {
    (this.handlers[k] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  private makeEl(analysed: boolean) {
    const el = new Audio();
    el.preload = 'auto';
    if (analysed) el.crossOrigin = 'anonymous';
    const isActive = () => el === this.active && el.getAttribute('src');
    el.addEventListener('playing', () => isActive() && this.emit('status', 'playing'));
    el.addEventListener('play', () => isActive() && this.emit('status', 'playing'));
    el.addEventListener('pause', () => isActive() && !el.ended && this.emit('status', 'paused'));
    el.addEventListener('waiting', () => isActive() && !el.paused && this.emit('status', 'buffering'));
    el.addEventListener('durationchange', () => isActive() && Number.isFinite(el.duration) && this.emit('duration', el.duration));
    el.addEventListener('ended', () => isActive() && this.emit('ended'));
    el.addEventListener('error', () => {
      // errors during the load phase are handled by tryLoad()
      if (isActive() && el.dataset.loaded === '1') this.emit('status', 'error', describeMediaError(el.error, 'proxy'));
    });
    return el;
  }

  /** Create the AudioContext lazily — must happen in (or after) a user gesture. */
  private ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx({ latencyHint: 'playback' });
    const source = ctx.createMediaElementSource(this.analysedEl);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -80;
    analyser.maxDecibels = -18;
    const gain = ctx.createGain();
    source.connect(analyser);
    analyser.connect(gain);
    gain.connect(ctx.destination);
    this.ctx = ctx;
    this.analyser = analyser;
    this.gain = gain;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.time = new Uint8Array(analyser.fftSize);
    this.applyVolume();
    return ctx;
  }

  private attemptsFor(track: Track): Attempt[] {
    const u = track.streamUrl;
    if (track.provider === 'local' || track.provider === 'demo' || u.startsWith('blob:') || u.startsWith('data:')) {
      return [{ kind: 'direct', url: u }];
    }
    const sameOrigin = (() => { try { return new URL(u, location.href).origin === location.origin; } catch { return false; } })();
    if (sameOrigin) return [{ kind: 'direct', url: u }];
    const list: Attempt[] = [];
    if (!track.preferProxy) list.push({ kind: 'direct', url: u });
    if (this.backendAvailable) list.push({ kind: 'proxy', url: proxyUrl(u) });
    if (track.preferProxy && !this.backendAvailable) list.push({ kind: 'direct', url: u });
    list.push({ kind: 'plain', url: u });
    return list;
  }

  private reset(el: HTMLAudioElement) {
    el.pause();
    el.dataset.loaded = '0';
    if (el.getAttribute('src')) {
      el.removeAttribute('src');
      el.load();
    }
  }

  private tryLoad(el: HTMLAudioElement, url: string, kind: AttemptKind, token: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        el.removeEventListener('canplay', ok);
        el.removeEventListener('loadedmetadata', ok);
        el.removeEventListener('error', fail);
        fn();
      };
      const ok = () => done(() => (token === this.token ? resolve() : reject(new Error('superseded'))));
      const fail = () => done(() => reject(new Error(describeMediaError(el.error, kind))));
      const timer = window.setTimeout(() => done(() => reject(new Error('The source took too long to respond.'))), LOAD_TIMEOUT_MS);
      el.addEventListener('canplay', ok);
      el.addEventListener('loadedmetadata', ok);
      el.addEventListener('error', fail);
      el.dataset.loaded = '0';
      el.src = url;
      el.load();
    });
  }

  private externalFor(track: Track): ExternalPlayer | null {
    if (track.provider === 'spotify') return spotifyPlayer;
    if (track.provider === 'system') return systemPlayer;
    return null;
  }

  /** Load a track, walking direct → proxy → playback-only until one works. */
  async load(track: Track): Promise<{ ok: true } | { ok: false; error: string }> {
    const token = ++this.token;
    this.reset(this.analysedEl);
    this.reset(this.plainEl);
    const ext = this.externalFor(track);
    if (this.external && this.external !== ext) this.external.stop();
    this.external = null;
    this.setAnalysis('none');
    this.emit('status', 'loading');

    if (ext) {
      try {
        ext.setVolume(this.volume, this.muted);
        await ext.load(track);
        if (token !== this.token) return { ok: false, error: 'superseded' };
        this.external = ext;
        this.setAnalysis('provider');
        if (ext.duration || track.duration) this.emit('duration', ext.duration || track.duration || 0);
        this.emit('status', 'ready');
        return { ok: true };
      } catch (e) {
        if (token !== this.token) return { ok: false, error: 'superseded' };
        const msg = (e as Error).message;
        this.emit('status', 'error', msg);
        return { ok: false, error: msg };
      }
    }

    let lastError = 'The audio could not be loaded.';
    for (const attempt of this.attemptsFor(track)) {
      const el = attempt.kind === 'plain' ? this.plainEl : this.analysedEl;
      try {
        await this.tryLoad(el, attempt.url, attempt.kind, token);
        if (token !== this.token) return { ok: false, error: 'superseded' };
        el.dataset.loaded = '1';
        this.active = el;
        this.applyVolume();
        this.setAnalysis(attempt.kind === 'direct' ? 'full' : attempt.kind === 'proxy' ? 'proxied' : 'unavailable');
        if (Number.isFinite(el.duration)) this.emit('duration', el.duration);
        this.emit('status', 'ready');
        return { ok: true };
      } catch (e) {
        if (token !== this.token) return { ok: false, error: 'superseded' };
        lastError = (e as Error).message;
        this.reset(el);
      }
    }
    this.emit('status', 'error', lastError);
    return { ok: false, error: lastError };
  }

  private setAnalysis(a: AnalysisStatus) {
    this.analysis = a;
    this.emit('analysis', a);
  }

  /**
   * Create/resume the AudioContext *synchronously inside a user gesture*. Call this at the
   * top of click handlers, before any await: strict browsers (Safari) only allow audio to
   * start while the gesture is still active, and loading a track is asynchronous.
   */
  unlock() {
    try {
      const ctx = this.ensureContext();
      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      /* Web Audio unavailable — playback still works through the plain element */
    }
  }

  async play() {
    if (this.external) {
      try {
        await this.external.play();
      } catch (e) {
        this.emit('status', 'error', (e as Error).message);
      }
      return;
    }
    const el = this.active;
    if (!el.getAttribute('src')) return;
    try {
      if (el === this.analysedEl) {
        const ctx = this.ensureContext();
        if (ctx.state !== 'running') await ctx.resume();
      }
      await el.play();
    } catch (e) {
      const err = e as DOMException;
      if (err.name === 'NotAllowedError') this.emit('status', 'blocked');
      else if (err.name !== 'AbortError') this.emit('status', 'error', err.message || 'Playback failed.');
    }
  }

  pause() {
    if (this.external) return this.external.pause();
    this.active.pause();
  }

  get paused() {
    return this.external ? this.external.paused : this.active.paused;
  }

  /** playback speed of the in-page element (external players report their own extrapolated time) */
  get playbackRate() {
    return this.external ? 1 : this.active.playbackRate || 1;
  }

  get currentTime() {
    if (this.external) return this.external.currentTime;
    return this.active.currentTime || 0;
  }

  get duration() {
    if (this.external) return this.external.duration;
    const d = this.active.duration;
    return Number.isFinite(d) ? d : 0;
  }

  /** fraction 0..1 of the track that is buffered ahead of the playhead */
  get bufferedEnd() {
    if (this.external) return 0;
    const el = this.active;
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= el.currentTime + 0.5 && b.end(i) >= el.currentTime) return b.end(i);
    }
    return 0;
  }

  seek(seconds: number) {
    if (this.external) {
      const d = this.external.duration;
      return this.external.seek(Math.max(0, d ? Math.min(seconds, d - 0.5) : seconds));
    }
    const el = this.active;
    if (!el.getAttribute('src')) return;
    const d = this.duration;
    el.currentTime = Math.max(0, d ? Math.min(seconds, d - 0.05) : seconds);
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
    this.external?.setVolume(volume, muted);
  }

  private applyVolume() {
    // perceptual curve: slider position² ≈ loudness
    const v = this.muted ? 0 : this.volume * this.volume;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.04);
    this.analysedEl.volume = 1; // level is controlled by the gain node
    this.plainEl.volume = v;
  }

  /** Fill freq/time buffers. Returns false when there is nothing analysable. */
  sample(): boolean {
    if (this.external) return false; // the provider's audio is not readable: ambient lighting
    const a = this.analyser;
    if (!a || this.active !== this.analysedEl || this.active.paused) return false;
    if (this.analysis !== 'full' && this.analysis !== 'proxied') return false;
    a.getByteFrequencyData(this.freq);
    a.getByteTimeDomainData(this.time);
    return true;
  }

  stop() {
    this.token++;
    this.external?.stop();
    this.external = null;
    this.reset(this.analysedEl);
    this.reset(this.plainEl);
    this.setAnalysis('none');
  }

  dispose() {
    this.stop();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

export const audioEngine = new AudioEngine();
