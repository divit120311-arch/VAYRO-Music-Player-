import type { Track } from '../types/music';

/**
 * A provider's own player (Spotify's Web Playback SDK, the Now Playing app) driven through
 * its official API. The audio stays inside the provider's protected player: Vayro can control
 * it and read its playback position, but never its samples.
 */
export type ExternalEvent =
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'buffering' }
  | { type: 'ended' }
  | { type: 'duration'; seconds: number }
  | { type: 'error'; message: string; code?: string };

export interface ExternalPlayer {
  readonly name: string;
  /** cue the track; resolves once it can play (or rejects with a readable reason) */
  load(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number, muted: boolean): void;
  stop(): void;
  readonly paused: boolean;
  /** seconds, from the provider's own playback clock */
  readonly currentTime: number;
  readonly duration: number;
  onEvent(fn: (e: ExternalEvent) => void): void;
}
