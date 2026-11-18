import { findOnSpotify, spotifyApi, spotifyStore } from './spotifyAuth';
import type { Track } from '../types/music';

/**
 * Finding a full-length, authorised source for a library song (which otherwise only has Apple's
 * 30-second preview):
 *   1. Spotify — the listener's connected Premium account (FULL_TRACK), in their own market
 *   2. nothing — the preview plays, and the listener is told why
 */
export type FullResult = { track: Track } | { reason: string };

/** the best full-length source for a preview-only library track */
export async function resolveFull(t: Track): Promise<FullResult> {
  const sp = spotifyStore.getState().status;
  if (sp === 'connected') {
    try {
      const r = await findOnSpotify(t.title, t.artist, t.duration);
      if (r && 'uri' in r) return { track: { ...t, provider: 'spotify', playback: 'FULL_TRACK', spotifyUri: r.uri, streamUrl: '', playable: true, preview: false, duration: r.durationMs / 1000, catalogDuration: t.duration, source: 'Spotify' } };
      if (r && 'unavailable' in r) return { reason: r.unavailable === 'region' ? 'not available on Spotify in your region' : 'not found on Spotify' };
    } catch (e) {
      return { reason: `Spotify: ${(e as Error).message}` };
    }
  }
  if (sp === 'premium-required') return { reason: 'Spotify full tracks need Premium' };
  return { reason: 'own-player' };
}

/** a Spotify track link pasted in the Link tab → a playable track (Spotify's official player) */
export async function trackFromProviderLink(raw: string): Promise<{ ok: true; track: Track } | { ok: false; error: string } | null> {
  const sp = raw.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/([A-Za-z0-9]{22})|spotify:track:([A-Za-z0-9]{22})/);
  if (!sp) return null;
  const status = spotifyStore.getState().status;
  if (status !== 'connected') {
    return { ok: false, error: status === 'premium-required' ? 'Spotify full tracks need a Premium account.' : 'Connect your Spotify Premium account (Settings → Full songs) to play Spotify links in full.' };
  }
  const id = sp[1] ?? sp[2];
  const t = await spotifyApi<{ name: string; duration_ms: number; is_playable?: boolean; artists: { name: string }[]; album: { name: string; images: { url: string }[] } }>(`/tracks/${id}?market=from_token`).catch(() => null);
  if (!t) return { ok: false, error: 'Spotify couldn’t find that track.' };
  if (t.is_playable === false) return { ok: false, error: 'That track isn’t available on Spotify in your region.' };
  return { ok: true, track: { id: `spotify:${id}`, provider: 'spotify', playback: 'FULL_TRACK', spotifyUri: `spotify:track:${id}`, title: t.name, artist: t.artists.map((a) => a.name).join(', '), album: t.album.name, artwork: t.album.images[0]?.url, duration: t.duration_ms / 1000, streamUrl: '', playable: true, source: 'Spotify', pageUrl: `https://open.spotify.com/track/${id}`, externalUrls: { spotify: `https://open.spotify.com/track/${id}` } } };
}
