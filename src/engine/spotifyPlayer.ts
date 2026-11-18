import type { Track } from '../types/music';
import type { ExternalEvent, ExternalPlayer } from './external';
import { spotifyApi, spotifyStore, spotifyToken } from '../services/spotifyAuth';

/**
 * Spotify's Web Playback SDK: Vayro becomes a Spotify Connect device and plays complete
 * tracks for a connected Premium account. Playback runs inside Spotify's DRM-protected player
 * (Encrypted Media Extensions), so its audio is not readable by Web Audio — the lights run in
 * ambient mode, and lyrics are off (Spotify's developer terms don't allow syncing its
 * recordings with lyrics).
 */
interface SpotifyState {
  paused: boolean;
  position: number;
  duration: number;
  track_window: { current_track: { uri: string } | null; previous_tracks: { uri: string }[] };
}
interface SpotifySDKPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(ev: string, fn: (arg: never) => void): void;
  resume(): Promise<void>;
  pause(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  activateElement?(): Promise<void>;
}
declare global {
  interface Window {
    Spotify?: { Player: new (o: { name: string; getOAuthToken: (cb: (t: string) => void) => void; volume: number }) => SpotifySDKPlayer };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify?.Player) return Promise.resolve();
  sdkPromise ??= new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('Spotify’s player couldn’t be loaded (offline, or blocked by an extension).'));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export class SpotifyPlayer implements ExternalPlayer {
  readonly name = 'Spotify';
  private sdk: SpotifySDKPlayer | null = null;
  private device: Promise<string> | null = null;
  private handler: (e: ExternalEvent) => void = () => {};
  private pending: string | null = null;
  private uri: string | null = null;
  private st = { paused: true, position: 0, duration: 0, stamp: 0 };
  private volume = 0.8;

  onEvent(fn: (e: ExternalEvent) => void) {
    this.handler = fn;
  }

  private ensure(): Promise<string> {
    this.device ??= (async () => {
      await loadSdk();
      const sdk = new window.Spotify!.Player({
        name: 'Vayro',
        getOAuthToken: (cb) => void spotifyToken().then((t) => t && cb(t)),
        volume: this.volume,
      });
      this.sdk = sdk;
      const id = await new Promise<string>((resolve, reject) => {
        const fail = (msg: string) => (e: { message: string }) => {
          reject(new Error(`${msg}${e?.message ? ` (${e.message})` : ''}`));
          this.handler({ type: 'error', message: msg });
        };
        sdk.addListener('ready', ((e: { device_id: string }) => resolve(e.device_id)) as (a: never) => void);
        sdk.addListener('initialization_error', fail('This browser can’t run Spotify’s protected player (it needs Encrypted Media Extensions).') as (a: never) => void);
        sdk.addListener('authentication_error', fail('Spotify rejected the sign-in. Connect your account again.') as (a: never) => void);
        sdk.addListener('account_error', fail('Spotify full-track playback needs a Premium account.') as (a: never) => void);
        sdk.addListener('playback_error', ((e: { message: string }) => this.handler({ type: 'error', message: `Spotify couldn’t play this track${e?.message ? ` (${e.message})` : ''}.` })) as (a: never) => void);
        sdk.addListener('player_state_changed', ((s: SpotifyState | null) => this.onState(s)) as (a: never) => void);
        void sdk.connect().then((ok) => !ok && reject(new Error('Couldn’t connect to Spotify.')));
        window.setTimeout(() => reject(new Error('Spotify’s player didn’t start (timed out).')), 20_000);
      });
      return id;
    })().catch((e) => {
      this.device = null;
      throw e;
    });
    return this.device;
  }

  private onState(s: SpotifyState | null) {
    if (!s) return;
    const wasPlaying = !this.st.paused;
    this.st = { paused: s.paused, position: s.position, duration: s.duration, stamp: performance.now() };
    if (s.duration) this.handler({ type: 'duration', seconds: s.duration / 1000 });
    // Spotify reports the end of a track as: paused, at 0, with our track now in "previous"
    const ended = wasPlaying && s.paused && s.position === 0 && s.track_window.previous_tracks.some((t) => t.uri === this.uri);
    if (ended) this.handler({ type: 'ended' });
    else this.handler({ type: s.paused ? 'paused' : 'playing' });
  }

  async load(track: Track) {
    if (!track.spotifyUri) throw new Error('No Spotify track for this song.');
    // fail fast (instead of waiting on a token that will never come)
    const status = spotifyStore.getState().status;
    if (status === 'premium-required') throw new Error('Spotify full-track playback needs a Premium account.');
    if (status !== 'connected') throw new Error('Connect your Spotify Premium account (Settings → Full songs) to play this in full.');
    await this.ensure();
    this.pending = track.spotifyUri;
    this.uri = track.spotifyUri;
    this.st = { paused: true, position: 0, duration: (track.duration ?? 0) * 1000, stamp: performance.now() };
  }

  async play() {
    const device = await this.ensure();
    await this.sdk?.activateElement?.().catch(() => {});
    if (this.pending) {
      const uri = this.pending;
      this.pending = null;
      // start this track on Vayro's Spotify Connect device
      await spotifyApi(`/me/player/play?device_id=${encodeURIComponent(device)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: [uri] }) }).catch((e) =>
        this.handler({ type: 'error', message: (e as Error).message }),
      );
    } else await this.sdk?.resume();
  }

  pause() {
    void this.sdk?.pause();
  }

  seek(seconds: number) {
    if (this.pending) return;
    void this.sdk?.seek(Math.max(0, Math.round(seconds * 1000)));
  }

  setVolume(volume: number, muted: boolean) {
    this.volume = muted ? 0 : volume * volume;
    void this.sdk?.setVolume(this.volume);
  }

  stop() {
    this.pending = null;
    if (!this.st.paused) void this.sdk?.pause();
  }

  get paused() {
    return this.st.paused;
  }

  /** Spotify reports position on state changes; between them, it advances with the clock */
  get currentTime() {
    const ms = this.st.paused ? this.st.position : this.st.position + (performance.now() - this.st.stamp);
    return Math.min(ms, this.st.duration || ms) / 1000;
  }

  get duration() {
    return this.st.duration / 1000;
  }
}

export const spotifyPlayer = new SpotifyPlayer();
