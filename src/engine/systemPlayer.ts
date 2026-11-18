import type { Track } from '../types/music';
import type { ExternalEvent, ExternalPlayer } from './external';

/**
 * "Now Playing" mode: another app on this computer (the Spotify app, Apple Music, a browser tab…)
 * plays the song; Vayro follows it. The local server reads Windows' media session (song,
 * playing/paused, position) and passes play/pause/skip/seek back. The audio is never touched.
 *
 * Windows reports the position only now and then (on play, pause, seek, and every few seconds),
 * with the moment it was measured; between reports the position is extrapolated from that.
 */
export interface SystemState {
  none?: boolean;
  error?: string;
  app?: string;
  title?: string;
  artist?: string;
  album?: string;
  status?: string; // Playing | Paused | Stopped | Changing | Closed | Opened
  position?: number;
  start?: number;
  end?: number;
  /** when the app measured `position` (ms since epoch) */
  updated?: number;
  /** the helper's clock when it read the session (ms since epoch) */
  now?: number;
  receivedAt?: number;
}

async function command(cmd: string, t?: number) {
  const q = new URLSearchParams({ cmd });
  if (t !== undefined) q.set('t', String(t));
  await fetch(`/api/nowplaying/command?${q}`, { method: 'POST' }).catch(() => {});
}

class SystemPlayer implements ExternalPlayer {
  readonly name = 'Now Playing';
  private listeners: ((e: ExternalEvent) => void)[] = [];
  private s: SystemState | null = null;
  /** local clock (performance.now) at which the extrapolated position was `base` */
  private baseAt = 0;
  private base = 0;
  private playing = false;
  private dur = 0;

  /** called by the Now Playing poller with each fresh report */
  update(s: SystemState) {
    const wasPlaying = this.playing;
    this.s = s;
    this.playing = s.status === 'Playing';
    // position at the moment Windows measured it, carried forward to "now" while playing
    if (typeof s.position === 'number') {
      const measuredAgo = s.now && s.updated ? Math.max(0, (s.now - s.updated) / 1000) : 0;
      const sinceRead = s.receivedAt ? Math.max(0, (Date.now() - s.receivedAt) / 1000) : 0;
      const pos = s.position + (this.playing ? measuredAgo + sinceRead : 0);
      // ignore small disagreements (the report is coarser than our clock): no jitter
      if (Math.abs(pos - this.currentTime) > 0.6 || this.playing !== wasPlaying) {
        this.base = pos;
        this.baseAt = performance.now();
      }
    }
    const d = s.end && s.end > 0 ? s.end - (s.start ?? 0) : 0;
    if (d && Math.abs(d - this.dur) > 0.5) {
      this.dur = d;
      this.emit({ type: 'duration', seconds: d });
    }
    if (this.playing !== wasPlaying) this.emit({ type: this.playing ? 'playing' : 'paused' });
  }

  /** a newly detected song is "loaded" with autoplay: don't press play on the other app for it */
  private justLoaded = false;
  async load(track: Track) {
    this.dur = track.duration ?? 0;
    this.justLoaded = true;
  }
  async play() {
    if (this.justLoaded) {
      this.justLoaded = false;
      return;
    }
    if (!this.playing) await command('play');
  }
  pause() {
    if (this.playing) void command('pause');
  }
  seek(seconds: number) {
    this.base = seconds;
    this.baseAt = performance.now();
    void command('seek', seconds);
  }
  /** the other app's own volume applies; Vayro doesn't change it */
  setVolume() {}
  stop() {
    this.playing = false;
  }
  next() {
    void command('next');
  }
  prev() {
    void command('prev');
  }
  get paused() {
    return !this.playing;
  }
  get currentTime() {
    const t = this.base + (this.playing ? (performance.now() - this.baseAt) / 1000 : 0);
    return this.dur ? Math.min(t, this.dur) : t;
  }
  get duration() {
    return this.dur;
  }
  get state() {
    return this.s;
  }
  onEvent(fn: (e: ExternalEvent) => void) {
    this.listeners.push(fn);
  }
  private emit(e: ExternalEvent) {
    this.listeners.forEach((l) => l(e));
  }
}

export const systemPlayer = new SystemPlayer();
