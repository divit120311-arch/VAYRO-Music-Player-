export type ProviderId = 'openverse' | 'jamendo' | 'apple' | 'url' | 'local' | 'demo' | 'spotify' | 'system';

/**
 * How a track plays — always shown to the listener, never overstated:
 *  FULL_TRACK    – the complete song plays here (e.g. Spotify Web Playback for Premium accounts)
 *  EMBEDDED      – the complete song plays inside a provider's official embedded player,
 *                  subject to that provider's restrictions (embedding, region, ads)
 *  PREVIEW_ONLY  – only a short licensed clip (Apple's 30-second previews)
 *  EXTERNAL_ONLY – opens the provider's own app or page
 *  LOCAL         – your own file
 */
export type PlaybackKind = 'FULL_TRACK' | 'EMBEDDED' | 'PREVIEW_ONLY' | 'EXTERNAL_ONLY' | 'LOCAL';

export interface License {
  name: string;
  url?: string;
}

export interface Track {
  id: string;
  provider: ProviderId;
  /** upstream source when it differs from the provider (e.g. Openverse → jamendo) */
  source?: string;
  title: string;
  artist: string;
  album?: string;
  /** seconds */
  duration?: number;
  artwork?: string;
  streamUrl: string;
  pageUrl?: string;
  artistUrl?: string;
  license?: License;
  attribution?: string;
  genres?: string[];
  playable: boolean;
  /** host is known not to send CORS headers → go through the proxy first */
  preferProxy?: boolean;
  /** local files: object URLs to revoke when removed */
  revokable?: string[];
  /** a short licensed preview clip (e.g. Apple's 30-second previews), not the full song */
  preview?: boolean;
  /** official pages where the full track can be played */
  externalUrls?: { apple?: string; spotify?: string };
  /** lyrics found inside the file (ID3 SYLT/USLT) or in a matching .lrc dropped with it */
  embeddedLyrics?: { text: string; from: 'tags' | 'sidecar' };
  /** how this track plays (see PlaybackKind) */
  playback?: PlaybackKind;
  /** Spotify track URI, played through Spotify's Web Playback SDK (Premium accounts) */
  spotifyUri?: string;
  /** for a full-length source standing in for a library song: the song's real length on Apple, for checks */
  catalogDuration?: number;
}

/**
 * What Vayro can do with a source:
 *  analyzable – plays here and drives the lighting
 *  playable   – plays here but the browser hides its samples (ambient lighting only)
 *  external   – only playable in the provider's own app/player
 */
export type SourceCapability = 'analyzable' | 'playable' | 'external';

export type PlayerStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'error';

/**
 * full        – samples are readable, lighting follows the music
 * proxied     – readable via our CORS proxy, lighting follows the music
 * unavailable – the source plays but refuses cross-origin sample access;
 *               lighting falls back to an ambient (non-reactive) animation
 * provider    – the audio plays inside a provider's own protected player (Spotify
 *               SDK); no samples exist for Web Audio, so lighting runs in ambient mode
 */
export type AnalysisStatus = 'none' | 'full' | 'proxied' | 'unavailable' | 'provider';

export type RepeatMode = 'off' | 'all' | 'one';

export interface CatalogPage {
  provider: ProviderId;
  page: number;
  hasMore: boolean;
  tracks: Track[];
}
