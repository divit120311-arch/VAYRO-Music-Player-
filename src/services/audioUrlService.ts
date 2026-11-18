import type { Track } from '../types/music';
import { apiJson } from './musicProvider';

/** Platforms whose links are player *pages*, not audio files. We never try to rip them. */
const PLATFORM_PAGES: { test: RegExp; name: string }[] = [
  { test: /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i, name: 'YouTube' },
  { test: /(^|\.)spotify\.(com|link)$|^spoti\.fi$/i, name: 'Spotify' },
  { test: /(^|\.)(music\.apple\.com|itunes\.apple\.com)$/i, name: 'Apple Music' },
  { test: /(^|\.)soundcloud\.com$|^on\.soundcloud\.com$/i, name: 'SoundCloud' },
  { test: /(^|\.)tidal\.com$/i, name: 'TIDAL' },
  { test: /(^|\.)deezer\.(com|page\.link)$/i, name: 'Deezer' },
  { test: /(^|\.)music\.amazon\.[a-z.]+$/i, name: 'Amazon Music' },
  { test: /(^|\.)(bandcamp\.com)$/i, name: 'Bandcamp' },
  { test: /(^|\.)(tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com)$/i, name: 'social media' },
];

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|webm|weba|mp4)$/i;
const PLAYLIST_EXT = /\.(m3u8?|pls|xspf|asx)$/i;

export type UrlCheck =
  | { ok: true; url: string; title: string; note?: string }
  | { ok: false; error: string };

export function parseAudioUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Paste a link to an audio file.' };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: 'That doesn’t look like a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// links are supported.' };
  }
  const platform = PLATFORM_PAGES.find((p) => p.test.test(u.hostname));
  if (platform && platform.name === 'Spotify') {
    // single tracks are handled before this (Spotify's official player); albums, playlists aren't
    return { ok: false, error: 'Paste a link to a single Spotify track. Albums and playlists aren’t supported here.' };
  }
  if (platform) {
    return {
      ok: false,
      error: `${platform.name} links open ${platform.name}'s own player, not an audio file. Their streams are protected by DRM and platform terms, so Vayro won't extract them. Use a direct .mp3/.ogg/.wav link, upload a file, or browse Discover.`,
    };
  }
  if (PLAYLIST_EXT.test(u.pathname)) {
    return { ok: false, error: 'This is a playlist / HLS manifest (.m3u8, .pls…), not a single audio file. Paste a direct link to the audio itself.' };
  }
  const file = decodeURIComponent(u.pathname.split('/').pop() || '');
  const title = file.replace(AUDIO_EXT, '').replace(/[_+]+/g, ' ').trim() || u.hostname;
  return {
    ok: true,
    url: u.href,
    title,
    note: AUDIO_EXT.test(u.pathname) ? undefined : 'No audio file extension — it will be checked before playing.',
  };
}

interface ProbeResult {
  ok: boolean;
  status: number;
  contentType: string;
  isAudio: boolean;
  isHtml: boolean;
  corsAllowed: boolean;
  finalUrl: string;
}

/**
 * Check what is actually behind a link before handing it to the audio element.
 * Uses the server (a browser can't read headers cross-origin). If the server is down
 * we skip the probe and let the audio element try directly.
 */
export async function resolveAudioUrl(raw: string, backendAvailable: boolean): Promise<{ ok: true; track: Track } | { ok: false; error: string }> {
  const parsed = parseAudioUrl(raw);
  if (!parsed.ok) return parsed;
  let preferProxy = false;
  if (backendAvailable) {
    try {
      const p = await apiJson<ProbeResult>(
        `/api/probe?url=${encodeURIComponent(parsed.url)}&origin=${encodeURIComponent(location.origin)}`,
        AbortSignal.timeout(12000),
      );
      if (!p.ok) return { ok: false, error: `The server answered HTTP ${p.status}${p.status === 404 ? ' (not found)' : p.status === 403 ? ' (access denied)' : ''}.` };
      if (p.isHtml) return { ok: false, error: 'This link opens a web page, not an audio file. Look for a direct download / stream link ending in .mp3, .ogg, .wav…' };
      const generic = /octet-stream|^$/.test(p.contentType);
      if (!p.isAudio && !generic) return { ok: false, error: `Unsupported media type “${p.contentType}”. Vayro plays audio files only.` };
      if (p.isAudio && document.createElement('audio').canPlayType(p.contentType) === '') {
        return { ok: false, error: `Your browser can’t decode ${p.contentType}. Try an MP3, AAC, OGG or WAV version.` };
      }
      preferProxy = !p.corsAllowed;
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
  const host = new URL(parsed.url).hostname.replace(/^www\./, '');
  return {
    ok: true,
    track: {
      id: `url:${parsed.url}`,
      provider: 'url',
      title: parsed.title,
      artist: host,
      streamUrl: parsed.url,
      pageUrl: parsed.url,
      playable: true,
      preferProxy,
    },
  };
}
