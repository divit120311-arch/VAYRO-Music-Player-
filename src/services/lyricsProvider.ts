import { ApiError, apiJson } from './musicProvider';
import { looksLikeLrc, parseLrc, parseLyricsfile } from '../utils/lrc';
import type { LyricsDoc, UserLyricsSource } from '../types/lyrics';
import type { Track } from '../types/music';

interface LyricsResponse {
  found: boolean;
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  lyricsfile?: string | null;
  hasWordSync?: boolean;
  matched?: { artist: string; title: string; album?: string; duration?: number };
}

export type LyricsLookup =
  | { kind: 'doc'; doc: LyricsDoc }
  | { kind: 'instrumental' }
  | { kind: 'none' };

/**
 * Strip the noise that defeats matching: "(feat. X)", "- Remastered 2011", and the junk that
 * download sites add to file names — "(From "Movie")", "[320kbps]", "| Movie |", "Official
 * Video", "Lyrical", site names, track numbers…
 */
export function cleanTitle(t: string) {
  return t
    .replace(/_/g, ' ')
    .replace(/\s*[([](feat\.?|ft\.?|with|from)\b[^)\]]*[)\]]/gi, '')
    .replace(/\d{2,3}\s?kbps/gi, '')
    .replace(/\s*[([][^)\]]*\b(official|video|audio|lyric(s|al)?|full song|hd|4k|mp3|remix|version|edit|slowed|reverb|remaster(ed)?)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([]\s*[)\]]/g, '')
    .replace(/\s*[|｜].*$/, '')
    .replace(/\s+-\s+(remaster(ed)?|live|radio edit|single version|mono|stereo|official.*|lyric.*|full.*|audio.*|video.*).*$/i, '')
    .replace(/\b(pagal\s?world|songs?\s?pk|mr\s?jatt|dj\s?punjab|wap\s?king|djmaza|downloadming|webmusic)\b.*$/i, '')
    .replace(/\b\d{2,3}\s?kbps\b/gi, '')
    .replace(/^\s*\d{1,3}\s*[.\-_)]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—.]+$/, '')
    .trim();
}

/** the artist tag is worth searching with (not our "Local file" placeholder) */
export const reliableArtist = (a?: string) => !!a && !/^(local file|unknown artist|unknown|various artists?)$/i.test(a.trim());

/**
 * Look up lyrics on LRCLIB (via our server, which identifies the client as LRCLIB asks).
 * Untagged files are searched by title alone; the song's duration picks the right version.
 * Nothing is cached in the bundle or on disk — lyrics are fetched for the track being played.
 */
export async function lookupLyrics(track: Track, duration: number, script: 'any' | 'latin' | 'native', signal?: AbortSignal): Promise<LyricsLookup> {
  // a song read off a shared Spotify tab without a readable artist: a title alone matches other
  // artists' songs (e.g. a different "Sensation"), so don't guess
  if (track.provider === 'system' && !reliableArtist(track.artist)) return { kind: 'none' };
  const title = cleanTitle(track.title) || track.title;
  const qs = new URLSearchParams({ title });
  if (reliableArtist(track.artist)) qs.set('artist', track.artist);
  if (track.album) qs.set('album', track.album);
  if (duration > 0) qs.set('duration', String(Math.round(duration)));
  if (script !== 'any') qs.set('script', script);
  return shared(`/api/lyrics?${qs}`, signal);
}

/**
 * One lookup per song version at a time, remembered for a while: the next-track prefetch, the song
 * starting, a settings change re-checking… all share one request. The key is the full query (title,
 * artist, album, length, script), so different recordings never share an answer. A lookup that
 * failed isn't remembered.
 */
const lookups = new Map<string, { at: number; p: Promise<LyricsLookup> }>();
const FOUND_TTL = 30 * 60_000;
const NONE_TTL = 5 * 60_000;
function shared(path: string, signal?: AbortSignal): Promise<LyricsLookup> {
  const hit = lookups.get(path);
  let entry = hit;
  if (!entry || Date.now() - entry.at > FOUND_TTL) {
    const p = withRetry(() => apiJson<LyricsResponse>(path)).then(toLookup);
    entry = { at: Date.now(), p };
    lookups.set(path, entry);
    p.then(
      (r) => {
        // "not found" is re-checked sooner (lyrics get added to LRCLIB all the time)
        if (r.kind === 'none') entry!.at = Date.now() - (FOUND_TTL - NONE_TTL);
      },
      () => lookups.get(path) === entry && lookups.delete(path),
    );
    if (lookups.size > 300) lookups.delete(lookups.keys().next().value!);
  }
  return abortable(entry.p, signal);
}

/** a shared promise, given up on by one caller (its song changed) without cancelling it for others */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', stop, { once: true });
    p.then(
      (v) => (signal.removeEventListener('abort', stop), resolve(v)),
      (e) => (signal.removeEventListener('abort', stop), reject(e)),
    );
  });
}

/**
 * Retries a temporary failure (server unreachable, 5xx, rate-limited) twice, after 0.6 s and 1.5 s;
 * a definite answer (4xx) isn't retried. Never loops.
 */
export async function withRetry<T>(fn: () => Promise<T>, delays = [600, 1500]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined;
      const temporary = e instanceof ApiError && (e.code === 'backend_down' || status === 429 || (status !== undefined && status >= 500));
      if (!temporary || i >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

/** (tests) forget remembered lookups */
export function clearLyricsLookups() {
  lookups.clear();
}

export interface LyricsCandidate {
  id: number;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  synced: boolean;
  wordSync: boolean;
  script: 'latin' | 'native' | 'unknown';
  preview: string[];
  /** seconds between this version and the playing file (null when unknown) */
  diff: number | null;
}

/** search LRCLIB for the picker dialog */
export async function searchLyrics(q: string, duration: number, signal?: AbortSignal) {
  const qs = new URLSearchParams({ q });
  if (duration > 0) qs.set('duration', String(Math.round(duration)));
  return (await apiJson<{ results: LyricsCandidate[] }>(`/api/lyrics/search?${qs}`, signal)).results;
}

/** the lyrics text of one LRCLIB record (synced LRC when it has it, else plain) */
export async function lyricsTextById(id: number, signal?: AbortSignal): Promise<string | null> {
  const r = await apiJson<LyricsResponse>(`/api/lyrics/id/${id}`, signal);
  return r.syncedLyrics || r.plainLyrics || null;
}

function toLookup(r: LyricsResponse): LyricsLookup {
  if (!r.found) return { kind: 'none' };
  if (r.instrumental) return { kind: 'instrumental' };
  // say WHICH song was matched, so a wrong match is obvious (and fixable with Search lyrics)
  const m = r.matched;
  const attribution = m?.title ? `LRCLIB · matched "${m.title}"${m.artist ? ` by ${m.artist}` : ''}` : 'Lyrics from LRCLIB, a community-maintained lyrics database';
  // (30-second previews get the full song's synced lyrics here; state/lyrics.ts lines them up with
  // the clip by listening, or shows them as plain text if it can't confirm where the clip sits)
  if (r.lyricsfile && r.hasWordSync) {
    const lines = parseLyricsfile(r.lyricsfile);
    if (lines.length) return { kind: 'doc', doc: { kind: 'synced', lines, hasWordSync: lines.some((l) => l.words), source: 'lrclib', attribution, recordingSeconds: m?.duration } };
  }
  if (r.syncedLyrics) {
    const lines = parseLrc(r.syncedLyrics);
    if (lines.length) return { kind: 'doc', doc: { kind: 'synced', lines, hasWordSync: lines.some((l) => l.words), source: 'lrclib', attribution, recordingSeconds: m?.duration } };
  }
  if (r.plainLyrics) return { kind: 'doc', doc: plainDoc(r.plainLyrics, 'lrclib', attribution) };
  return { kind: 'none' };
}

export function plainDoc(text: string, source: LyricsDoc['source'], attribution?: string): LyricsDoc {
  return {
    kind: 'plain',
    lines: [],
    plain: text.replace(/\r/g, '').split('\n').map((l) => l.trim()),
    hasWordSync: false,
    source,
    attribution,
  };
}

/** User-supplied text: LRC (synced) when it has timestamps, otherwise plain. */
const SYNCED_LABEL: Record<UserLyricsSource, string> = {
  file: 'Your LRC file',
  manual: 'Lyrics you added',
  transcribed: 'Transcribed from the audio on this device: may contain mistakes',
  embedded: 'Lyrics embedded in your file',
  lrclib: 'Lyrics from LRCLIB (picked by you)',
};
const PLAIN_LABEL: Record<UserLyricsSource, string> = {
  file: 'Your lyrics file (not time-synced)',
  manual: 'Lyrics you added (not time-synced)',
  transcribed: 'Transcribed from the audio on this device',
  embedded: 'Lyrics embedded in your file (not time-synced)',
  lrclib: 'Lyrics from LRCLIB (picked by you, not time-synced)',
};

export function docFromUserText(text: string, source: UserLyricsSource): LyricsDoc | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (looksLikeLrc(trimmed)) {
    const lines = parseLrc(trimmed);
    if (lines.length) return { kind: 'synced', lines, hasWordSync: lines.some((l) => l.words), source, attribution: SYNCED_LABEL[source] };
  }
  return plainDoc(trimmed, source, PLAIN_LABEL[source]);
}
