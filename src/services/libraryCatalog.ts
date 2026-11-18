import { apiJson } from './musicProvider';
import type { Track } from '../types/music';

/**
 * Vayro's music catalogue: real songs by real artists, from Apple's official catalogue
 * (server/catalog/build.mjs builds and verifies it; the browser never holds a key).
 *
 * playbackType
 *   preview  — Apple's 30-second preview plays here and drives the lighting
 *   external — no preview; the song opens in Apple Music (never shown as playable here)
 * embedUrl  — Apple's official embed player (full song for signed-in Apple Music subscribers,
 *             a preview otherwise). Its audio stays inside Apple's player, so the lighting can't
 *             analyse it.
 */
export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  artistSlug: string | null;
  album?: string;
  albumId?: string;
  releaseDate?: string;
  year?: string;
  duration?: number;
  artwork?: string;
  explicit?: boolean;
  genre?: string;
  provider: 'apple';
  providerTrackId: number;
  appleMusicUrl: string | null;
  embedUrl: string | null;
  spotifyUrl: string | null;
  spotifySearchUrl: string;
  previewUrl: string | null;
  playbackType: 'preview' | 'external';
  /**
   * rank within the artist and what ordered it:
   *  listenbrainz       — ListenBrainz listen counts (only when the server has a token)
   *  apple-releases     — how many releases in Apple's catalogue carry the song (hits reappear on
   *                       albums, deluxe editions, compilations, soundtracks)
   *  apple-search-order — Apple's own search order (live results, ties)
   */
  popularity: { source: 'listenbrainz' | 'apple-releases' | 'apple-search-order'; rank?: number; listens?: number; releases?: number; spotify?: number };
  verification: { status: 'verified' | 'partial' | 'provider'; checkedAt: string; checks: Record<string, string> };
}

export interface CatalogArtist {
  slug: string;
  name: string;
  group: 'hiphop' | 'rnb-alt' | 'pop-intl' | 'added';
  tags: string[];
  primaryGenre?: string;
  appleId: number;
  appleMusicUrl?: string;
  spotifyUrl: string | null;
  image?: string;
  imageKind: 'album-art';
  builtAt: string;
  userAdded?: boolean;
  addedAt?: string;
}

export interface CatalogAlbum {
  id: string;
  providerAlbumId: number;
  title: string;
  artist: string;
  artistSlug?: string;
  releaseDate?: string;
  year?: string;
  trackCount: number;
  artwork?: string;
  appleMusicUrl: string;
  genre?: string;
}

export interface Catalog {
  builtAt: string | null;
  source: string;
  genres: { id: string; name: string }[];
  artists: CatalogArtist[];
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
  failures: { slug: string; name: string; error: string }[];
  registry: number;
}

export interface LiveResults {
  tracks: CatalogTrack[];
  artists: { name: string; appleId: number; genre?: string; appleMusicUrl?: string }[];
  albums: CatalogAlbum[];
}

let catalogPromise: Promise<Catalog> | null = null;
export function fetchCatalog(force = false) {
  if (!catalogPromise || force) catalogPromise = apiJson<Catalog>('/api/library').catch((e) => ((catalogPromise = null), Promise.reject(e)));
  return catalogPromise;
}

export const searchLive = (q: string, signal?: AbortSignal) => apiJson<LiveResults>(`/api/library/search?q=${encodeURIComponent(q)}`, signal);

/** album tracks (the existing Apple lookup endpoint) */
export async function fetchAlbumTracks(providerAlbumId: number, signal?: AbortSignal): Promise<CatalogTrack[]> {
  const r = await apiJson<{ tracks: { id: number; title: string; artist: string; album: string; albumId: number; duration?: number; previewUrl: string | null; appleUrl: string; artwork?: string; explicit: boolean; releaseDate?: string }[] }>(
    `/api/artists/album/${providerAlbumId}`,
    signal,
  );
  return r.tracks.map((s) => {
    const q = `${s.artist} ${s.title}`;
    const apple = s.appleUrl?.replace(/[?&]uo=\d+/, '') ?? null;
    return {
      id: `apple:${s.id}`,
      title: s.title,
      artist: s.artist,
      artistSlug: null,
      album: s.album,
      albumId: `apple-album:${s.albumId}`,
      releaseDate: s.releaseDate,
      year: s.releaseDate?.slice(0, 4),
      duration: s.duration,
      artwork: s.artwork,
      explicit: s.explicit,
      provider: 'apple',
      providerTrackId: s.id,
      appleMusicUrl: apple,
      embedUrl: apple ? apple.replace('https://music.apple.com/', 'https://embed.music.apple.com/') : null,
      spotifyUrl: null,
      spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
      previewUrl: s.previewUrl,
      playbackType: s.previewUrl ? 'preview' : 'external',
      popularity: { source: 'apple-search-order' },
      verification: { status: 'provider', checkedAt: new Date().toISOString(), checks: {} },
    } satisfies CatalogTrack;
  });
}

export async function addArtist(name: string) {
  const r = await fetch('/api/library/artists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Couldn't add ${name} (${r.status}).`);
  await fetchCatalog(true);
  return body as { artist: CatalogArtist; already?: boolean };
}

export async function removeArtist(slug: string) {
  const r = await fetch(`/api/library/artists/${slug}/remove`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Couldn’t remove it.');
  await fetchCatalog(true);
}

/** a catalogue song as a player track (only previews are playable here) */
export function toTrack(t: CatalogTrack): Track {
  return {
    id: t.id,
    provider: 'apple',
    title: t.title,
    artist: t.artist,
    album: t.album,
    // the real song length — the lyrics lookup matches on it; the preview itself is ~30 s
    duration: t.duration,
    artwork: t.artwork,
    streamUrl: t.previewUrl ?? '',
    playable: t.playbackType === 'preview' && !!t.previewUrl,
    preview: true,
    pageUrl: t.appleMusicUrl ?? undefined,
    genres: t.genre ? [t.genre] : undefined,
    externalUrls: { apple: t.appleMusicUrl ?? undefined, spotify: t.spotifyUrl ?? t.spotifySearchUrl },
  };
}

/** a played track back to a catalogue-shaped record (for history / favourites) */
export function fromTrack(t: Track): CatalogTrack | null {
  if (t.provider !== 'apple' || !t.id.startsWith('apple:')) return null;
  const q = `${t.artist} ${t.title}`;
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistSlug: null,
    album: t.album,
    duration: t.duration,
    artwork: t.artwork,
    provider: 'apple',
    providerTrackId: Number(t.id.slice(6)),
    appleMusicUrl: t.externalUrls?.apple ?? t.pageUrl ?? null,
    embedUrl: null,
    spotifyUrl: null,
    spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
    previewUrl: t.streamUrl || null,
    playbackType: t.streamUrl ? 'preview' : 'external',
    popularity: { source: 'apple-search-order' },
    verification: { status: 'provider', checkedAt: new Date().toISOString(), checks: {} },
  };
}

export const PLAYBACK_LABEL: Record<CatalogTrack['playbackType'], string> = {
  preview: '30s preview',
  external: 'Apple Music only',
};
