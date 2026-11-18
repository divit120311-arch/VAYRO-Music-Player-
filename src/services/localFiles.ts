import type { Track } from '../types/music';
import { cleanTitle } from './lyricsProvider';

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|wave|ogg|oga|opus|flac|webm|weba|mp4|aiff?|caf)$/i;
const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', wave: 'audio/wav',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', flac: 'audio/flac',
  webm: 'audio/webm', weba: 'audio/webm', mp4: 'audio/mp4', aif: 'audio/aiff', aiff: 'audio/aiff', caf: 'audio/x-caf',
};

export function isAudioFile(f: File) {
  return f.type.startsWith('audio/') || AUDIO_EXT.test(f.name);
}

function browserCanPlay(f: File) {
  const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
  const type = f.type || EXT_MIME[ext] || '';
  if (!type) return true; // unknown: let the element try
  return document.createElement('audio').canPlayType(type) !== '';
}

// ---------------------------------------------------------------------------
// Minimal ID3v2 reader (v2.2 / v2.3 / v2.4): title, artist, album, cover art.
// ---------------------------------------------------------------------------
interface Id3 { title?: string; artist?: string; album?: string; picture?: Blob; lyrics?: string; syncedLyrics?: string }

const syncsafe = (b: Uint8Array, o: number) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

function decodeText(bytes: Uint8Array, enc: number) {
  const label = enc === 0 ? 'latin1' : enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes).replace(/\0+$/g, '').split('\0')[0].trim();
  } catch {
    return '';
  }
}

/** index just past the terminator for a string in `enc` starting at `from` */
function skipString(b: Uint8Array, from: number, enc: number) {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i + 2;
  } else {
    for (let i = from; i < b.length; i++) if (b[i] === 0) return i + 1;
  }
  return b.length;
}

async function readId3(file: File): Promise<Id3 | null> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null; // "ID3"
  const ver = head[3];
  const flags = head[5];
  const size = syncsafe(head, 6);
  if (size <= 0 || size > 16 * 1024 * 1024) return null;
  const b = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  let p = 0;
  if (flags & 0x40 && ver >= 3) p += ver === 4 ? syncsafe(b, 0) : u32(b, 0) + 4; // extended header
  const out: Id3 = {};
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (p + hdrLen <= b.length) {
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const fsize = ver === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : ver === 4 ? syncsafe(b, p + 4) : u32(b, p + 4);
    const start = p + hdrLen;
    const body = b.subarray(start, start + fsize);
    p = start + fsize;
    if (fsize <= 0 || p > b.length) break;
    const enc = body[0];
    switch (id) {
      case 'TIT2': case 'TT2': out.title = decodeText(body.subarray(1), enc); break;
      case 'TPE1': case 'TP1': out.artist = decodeText(body.subarray(1), enc); break;
      case 'TALB': case 'TAL': out.album = decodeText(body.subarray(1), enc); break;
      case 'USLT': case 'ULT': {
        // enc(1) lang(3) descriptor NUL text; keep the whole text, line breaks included
        if (out.lyrics) break;
        const q = skipString(body, 4, enc);
        const label = enc === 0 ? 'latin1' : enc === 1 ? 'utf-16' : enc === 2 ? 'utf-16be' : 'utf-8';
        try {
          const t = new TextDecoder(label).decode(body.subarray(q)).replace(/\0+$/g, '').replace(/\r\n?/g, '\n').trim();
          if (t) out.lyrics = t;
        } catch { /* undecodable */ }
        break;
      }
      case 'SYLT': case 'SLT': {
        // enc(1) lang(3) timestampFormat(1: 2 = ms) contentType(1) descriptor NUL, then [text NUL][u32 time]...
        if (out.syncedLyrics || body[4] !== 2) break; // only millisecond stamps (MPEG-frame stamps need the frame rate)
        let q = skipString(body, 6, enc);
        const lines: string[] = [];
        while (q < body.length - 4) {
          const end = skipString(body, q, enc);
          const text = decodeText(body.subarray(q, end), enc).replace(/^\n/, '');
          if (end + 4 > body.length) break;
          const ms = u32(body, end);
          q = end + 4;
          const s = ms / 1000;
          const m = Math.floor(s / 60);
          lines.push(`[${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}]${text}`);
        }
        if (lines.length > 1) out.syncedLyrics = lines.join('\n');
        break;
      }
      case 'APIC': case 'PIC': {
        if (out.picture) break;
        let q = 1;
        let mime = 'image/jpeg';
        if (id === 'APIC') {
          const end = skipString(body, q, 0);
          mime = new TextDecoder('latin1').decode(body.subarray(q, end - 1)) || mime;
          q = end;
        } else {
          const fmt = new TextDecoder('latin1').decode(body.subarray(q, q + 3)).toUpperCase();
          mime = fmt === 'PNG' ? 'image/png' : 'image/jpeg';
          q += 3;
        }
        q += 1; // picture type
        q = skipString(body, q, enc); // description
        if (!mime.includes('/')) mime = `image/${mime.toLowerCase()}`;
        if (q < body.length) out.picture = new Blob([body.slice(q)], { type: mime });
        break;
      }
    }
  }
  return out;
}

function fromFilename(name: string): { title: string; artist?: string } {
  const raw = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-_]+/, '').trim();
  // strip download-site noise first ("[320kbps]", "(From …)", "- PagalWorld"…), otherwise
  // "Song (From Movie) - SiteName" would be read as artist "Song", title "SiteName"
  const base = cleanTitle(raw) || raw;
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base };
}

function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const done = (d?: number) => { a.removeAttribute('src'); a.load(); resolve(d); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : undefined);
    a.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 5000);
    a.src = url;
  });
}

export interface FileImportResult {
  tracks: Track[];
  rejected: { name: string; reason: string }[];
}

const baseName = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();

export async function filesToTracks(files: File[]): Promise<FileImportResult> {
  const rejected: FileImportResult['rejected'] = [];
  // "Song.lrc" dropped together with "Song.mp3" → synced lyrics for that file
  const sidecars = new Map<string, File>();
  for (const f of files) if (/\.lrc$/i.test(f.name) && f.size < 200_000) sidecars.set(baseName(f.name), f);
  files = files.filter((f) => !/\.lrc$/i.test(f.name));
  const accepted = files.filter((f) => {
    if (!isAudioFile(f)) { rejected.push({ name: f.name, reason: 'not an audio file' }); return false; }
    if (!browserCanPlay(f)) { rejected.push({ name: f.name, reason: 'format not supported by this browser' }); return false; }
    return true;
  });
  const tracks = await Promise.all(
    accepted.map(async (file, i): Promise<Track> => {
      const url = URL.createObjectURL(file);
      const revokable = [url];
      const [tags, duration] = await Promise.all([readId3(file).catch(() => null), probeDuration(url)]);
      const guess = fromFilename(file.name);
      const side = sidecars.get(baseName(file.name));
      const sideText = side ? await side.text().catch(() => '') : '';
      const embeddedLyrics: Track['embeddedLyrics'] = sideText.trim()
        ? { text: sideText, from: 'sidecar' }
        : tags?.syncedLyrics
          ? { text: tags.syncedLyrics, from: 'tags' }
          : tags?.lyrics
            ? { text: tags.lyrics, from: 'tags' }
            : undefined;
      let artwork: string | undefined;
      if (tags?.picture && tags.picture.size > 100) {
        artwork = URL.createObjectURL(tags.picture);
        revokable.push(artwork);
      }
      return {
        id: `local:${Date.now()}:${i}:${file.name}`,
        provider: 'local',
        title: tags?.title || guess.title,
        artist: tags?.artist || guess.artist || 'Local file',
        album: tags?.album,
        duration,
        artwork,
        streamUrl: url,
        playable: true,
        revokable,
        embeddedLyrics,
      };
    }),
  );
  return { tracks, rejected };
}
