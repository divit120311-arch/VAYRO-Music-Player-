import { apiJson } from './musicProvider';
import { spotifySearchUrl } from '../config/artists';
import type { Track } from '../types/music';

/**
 * Apple's iTunes Search API (official, keyless), via our server for caching and rate limiting.
 * Full songs are NOT available — Apple supplies 30-second previews for promotion, which
 * Vayro plays and analyses (Apple serves them with CORS enabled), always alongside
 * links to the full track on Apple Music / Spotify.
 */
export interface AppleSong {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumId: number;
  trackNumber: number;
  discNumber: number;
  duration?: number;
  previewUrl: string | null;
  appleUrl: string;
  artwork?: string;
  explicit: boolean;
  releaseDate?: string;
}

export interface AppleAlbum {
  id: number;
  title: string;
  kind: 'album' | 'single' | 'ep';
  year?: string;
  trackCount: number;
  artwork?: string;
  appleUrl: string;
  copyright?: string;
}

export interface ArtistCatalog {
  artist: { slug: string; name: string; appleId: number; appleUrl: string; spotifyId: string };
  albums: AppleAlbum[];
  singles: AppleAlbum[];
  top: AppleSong[];
}

export const fetchArtist = (slug: string, signal?: AbortSignal) => apiJson<ArtistCatalog>(`/api/artists/${slug}`, signal);
export const fetchAlbum = (id: number, signal?: AbortSignal) => apiJson<{ tracks: AppleSong[] }>(`/api/artists/album/${id}`, signal);
export const searchArtist = (slug: string, q: string, signal?: AbortSignal) =>
  apiJson<{ tracks: AppleSong[] }>(`/api/artists/${slug}/search?q=${encodeURIComponent(q)}`, signal);

export function songToTrack(s: AppleSong): Track {
  const q = `${s.artist} ${s.title}`;
  return {
    id: `apple:${s.id}`,
    provider: 'apple',
    title: s.title,
    artist: s.artist,
    album: s.album,
    // the real song length — useful for lyrics matching; the preview itself is ~30 s
    duration: s.duration,
    artwork: s.artwork,
    streamUrl: s.previewUrl ?? '',
    playable: Boolean(s.previewUrl),
    preview: true,
    pageUrl: s.appleUrl,
    externalUrls: { apple: s.appleUrl, spotify: spotifySearchUrl(q) },
  };
}
