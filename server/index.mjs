// VAYRO API server
// ---------------------------------------------------------------------------
// Responsibilities (kept deliberately separate from the frontend):
//   1. Catalog search against legal music APIs (Openverse — keyless; Jamendo — needs
//      a client ID that never leaves this process).
//   2. A CORS-enabling, Range-aware stream proxy so the browser's Web Audio API can
//      analyse audio from hosts that don't send Access-Control-Allow-Origin.
//      It only relays publicly reachable audio/image resources; private-network
//      addresses are refused (SSRF guard). It does not touch DRM'd or
//      authenticated platforms — it simply forwards a public HTTP(S) file.
//   3. Serving the production build from ./dist.
// No framework: Node's built-in http + fetch.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { handleTranscribe } from './asr/index.mjs';
import { handleLibrary } from './catalog/routes.mjs';
import { handleProviders } from './providers.mjs';
import { handleNowPlaying } from './nowplaying/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// --- tiny .env loader (no dependency) ---------------------------------------
const envPath = path.join(__dirname, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const PORT = Number(process.env.PORT) || 8787;
/** running as a Vercel serverless function (the website's API), not as Vayro's own server */
const SERVERLESS = !!process.env.VERCEL;
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID?.trim() || '';
const USER_AGENT = 'Vayro/1.0 (ambient music visualizer)';

// --- helpers -----------------------------------------------------------------
function sendJson(res, status, body, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(data);
}

const clampInt = (v, min, max, dflt) => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// Tiny in-memory cache for catalog responses (60s) to be polite to providers.
const cache = new Map();
async function cachedJson(key, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + 60_000 });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

// --- SSRF guard --------------------------------------------------------------
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'That is not a valid URL.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(400, 'Only http and https links are supported.');
  if (u.username || u.password) throw httpError(400, 'Links with embedded credentials are not supported.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw httpError(502, `Could not resolve ${host}.`);
  });
  if (addrs.some((a) => isPrivateIp(a.address))) throw httpError(403, 'Links to private or local network addresses are blocked.');
  return u;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const ALLOWED_TYPES = /^(audio\/|image\/|application\/ogg|application\/octet-stream|video\/(mp4|webm|ogg)|binary\/octet-stream)/i;

// fetch that follows redirects manually so every hop passes the SSRF check
async function guardedFetch(raw, init, hops = 5) {
  let url = (await assertPublicUrl(raw)).href;
  for (let i = 0; i <= hops; i++) {
    const r = await fetch(url, { ...init, redirect: 'manual', headers: { 'User-Agent': USER_AGENT, ...init.headers } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = (await assertPublicUrl(new URL(r.headers.get('location'), url).href)).href;
      continue;
    }
    return { response: r, finalUrl: url };
  }
  throw httpError(508, 'Too many redirects.');
}

// --- /api/stream -------------------------------------------------------------
async function handleStream(req, res, params) {
  const target = params.get('url');
  if (!target) return sendJson(res, 400, { error: 'Missing url parameter.' });
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const headers = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const { response: up } = await guardedFetch(target, { headers, signal: controller.signal });

  if (!up.ok && up.status !== 206) {
    up.body?.cancel().catch(() => {});
    return sendJson(res, up.status === 404 ? 404 : 502, { error: `The source responded with HTTP ${up.status}.` });
  }
  const type = up.headers.get('content-type') || 'application/octet-stream';
  if (!ALLOWED_TYPES.test(type)) {
    up.body?.cancel().catch(() => {});
    return sendJson(res, 415, { error: `The link returned "${type.split(';')[0]}", not an audio file.` });
  }
  const out = {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Cache-Control': up.headers.get('cache-control') || 'public, max-age=3600',
  };
  for (const h of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = up.headers.get(h);
    if (v) out[h.replace(/(^|-)\w/g, (s) => s.toUpperCase())] = v;
  }
  res.writeHead(up.status, out);
  if (req.method === 'HEAD' || !up.body) return res.end();
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

// --- /api/probe : what is behind this link? ------------------------------------
async function handleProbe(req, res, params) {
  const target = params.get('url');
  if (!target) return sendJson(res, 400, { error: 'Missing url parameter.' });
  const origin = params.get('origin') || '';
  const { response: up, finalUrl } = await guardedFetch(target, {
    headers: { Range: 'bytes=0-1', ...(origin ? { Origin: origin } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  up.body?.cancel().catch(() => {});
  const type = (up.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const acao = up.headers.get('access-control-allow-origin');
  sendJson(res, 200, {
    ok: up.ok || up.status === 206,
    status: up.status,
    contentType: type,
    isAudio: /^audio\/|^application\/ogg|^video\/(mp4|webm|ogg)/.test(type),
    isHtml: /html/.test(type),
    // whether the browser could read samples directly without our proxy
    corsAllowed: acao === '*' || (!!origin && acao === origin),
    finalUrl,
  });
}

// --- catalogs ----------------------------------------------------------------
async function handleOpenverse(res, params) {
  const q = (params.get('q') || '').slice(0, 120);
  const genre = (params.get('genre') || '').slice(0, 40);
  const page = clampInt(params.get('page'), 1, 20, 1);
  const query = [q, genre].filter(Boolean).join(' ') || 'ambient';
  const url = new URL('https://api.openverse.org/v1/audio/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', '20'); // anonymous access is capped at 20
  url.searchParams.set('page', String(page));
  url.searchParams.set('category', 'music');
  url.searchParams.set('mature', 'false');

  const data = await cachedJson(url.href, async () => {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) });
    if (r.status === 429) throw httpError(429, 'Openverse rate limit reached — wait a minute and try again.');
    if (!r.ok) throw httpError(502, `Openverse responded with HTTP ${r.status}.`);
    return r.json();
  });

  const tracks = (data.results || [])
    .filter((t) => t.url)
    .map((t) => ({
      id: `openverse:${t.id}`,
      provider: 'openverse',
      source: t.source || t.provider,
      title: t.title || 'Untitled',
      artist: t.creator || 'Unknown artist',
      album: t.audio_set?.title || undefined,
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
      artwork: t.thumbnail || undefined,
      streamUrl: t.url,
      pageUrl: t.foreign_landing_url || undefined,
      artistUrl: t.creator_url || undefined,
      license: {
        name: `CC ${String(t.license || '').toUpperCase()} ${t.license_version || ''}`.trim(),
        url: t.license_url || undefined,
      },
      attribution: t.attribution || undefined,
      genres: t.genres || [],
      playable: true,
    }));
  sendJson(res, 200, { provider: 'openverse', page, hasMore: page < (data.page_count || 1), tracks });
}

async function handleJamendo(res, params) {
  if (!JAMENDO_CLIENT_ID) {
    return sendJson(res, 503, {
      error: 'Jamendo is not configured. Add JAMENDO_CLIENT_ID to server/.env (free key at devportal.jamendo.com) and restart the server.',
      code: 'not_configured',
    });
  }
  const q = (params.get('q') || '').slice(0, 120);
  const genre = (params.get('genre') || '').slice(0, 40);
  const page = clampInt(params.get('page'), 1, 20, 1);
  const limit = 24;
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', JAMENDO_CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String((page - 1) * limit));
  url.searchParams.set('include', 'licenses musicinfo');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('imagesize', '300');
  if (q) url.searchParams.set('search', q);
  if (genre) url.searchParams.set('tags', genre);
  if (!q && !genre) url.searchParams.set('order', 'popularity_week');

  const data = await cachedJson(url.href, async () => {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw httpError(502, `Jamendo responded with HTTP ${r.status}.`);
    const j = await r.json();
    if (j.headers?.status !== 'success') throw httpError(502, `Jamendo: ${j.headers?.error_message || 'request failed'}`);
    return j;
  });

  const tracks = (data.results || []).map((t) => ({
    id: `jamendo:${t.id}`,
    provider: 'jamendo',
    source: 'jamendo',
    title: t.name || 'Untitled',
    artist: t.artist_name || 'Unknown artist',
    album: t.album_name || undefined,
    duration: t.duration || undefined,
    artwork: t.image || t.album_image || undefined,
    streamUrl: t.audio || '',
    pageUrl: t.shareurl || undefined,
    artistUrl: t.artist_id ? `https://www.jamendo.com/artist/${t.artist_id}` : undefined,
    license: { name: licenseName(t.license_ccurl), url: t.license_ccurl || undefined },
    attribution: `"${t.name}" by ${t.artist_name} — via Jamendo${t.license_ccurl ? `, licensed ${licenseName(t.license_ccurl)}` : ''}.`,
    genres: t.musicinfo?.tags?.genres || [],
    playable: Boolean(t.audio),
  }));
  sendJson(res, 200, { provider: 'jamendo', page, hasMore: tracks.length === limit, tracks });
}

function licenseName(ccurl = '') {
  const m = ccurl.match(/licenses\/([a-z-]+)\/([\d.]+)/i);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : 'Creative Commons';
}

// --- lyrics (LRCLIB) ------------------------------------------------------------
// LRCLIB is a free, open, community-maintained lyrics database (no key). Its docs ask
// clients to identify themselves; set LRCLIB_USER_AGENT in server/.env to name your
// deployment and a contact URL. Lyrics are fetched on demand and never stored on disk.
const LRCLIB_UA = process.env.LRCLIB_USER_AGENT?.trim() || 'Vayro v1.0 (self-hosted ambient music visualizer)';

async function lrclib(path) {
  const r = await fetch(`https://lrclib.net${path}`, {
    headers: { 'User-Agent': LRCLIB_UA, 'Lrclib-Client': LRCLIB_UA },
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 404) return null;
  if (r.status === 429) throw httpError(429, 'The lyrics service is rate-limiting requests — try again in a minute.');
  if (!r.ok) throw httpError(502, `Lyrics service responded with HTTP ${r.status}.`);
  return r.json();
}

// Which writing system a lyric text uses — lets the user prefer "Hindi in Roman letters"
// (Hinglish, very common on LRCLIB) or the native script (Devanagari etc.).
function scriptOf(text) {
  const s = (text || '').replace(/\[[^\]]*\]/g, '');
  let latin = 0;
  let other = 0;
  for (const ch of s) {
    if (/[A-Za-z]/.test(ch)) latin++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  if (!latin && !other) return 'unknown';
  return other > latin ? 'native' : 'latin';
}

const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Lyrics in English letters are either the song itself spelt in Roman letters ("Hinglish": tum hi
// ho, tainu, dil) or an English TRANSLATION of a Hindi / Punjabi song ("you are the one"). Both
// count as "Latin script", so tell them apart by their everyday words.
const INDIC_WORDS = new Set(
  ('hai hain hoon hun ho tha thi mein mai tu tum tera teri tere mera meri mere hum humko tujhe tujhko mujhe mujhko ' +
    'ka ki ke ko se na nahi nahin naa kya kyun kyon aur bhi toh ye yeh woh vo jo ab sab kuch koi dil pyaar pyar ishq jaan jaana ' +
    'yaar yaara saath sath bin bina raat din aankhein aankhon zindagi duniya rab sajna sajni mahi mahiya ve nu di da de tainu mainu ' +
    'menu tenu kithe kive kiven hoya gaya gayi kar karo karke diya liya chal chalo aaja aaye aaya hoke laiyan lagda lagdi nal naal').split(' '),
);
const ENGLISH_WORDS = new Set(
  ('the you and i my me is are was were to of in it your that with be for on this all can dont im we will when what so but not ' +
    'have just like know love heart never ever there they she he her his our out up now one way no yes oh baby').split(' '),
);
/** 'indic' (Devanagari / Gurmukhi script), 'roman' (Hindi / Punjabi in English letters), 'english', or 'other' */
function lyricLanguage(text) {
  const s = (text || '').replace(/\[[^\]]*\]/g, ' ');
  if (/[ऀ-ॿ਀-੿]/.test(s)) {
    const indic = (s.match(/[ऀ-ॿ਀-੿]/g) || []).length;
    const latin = (s.match(/[A-Za-z]/g) || []).length;
    if (indic >= latin) return 'indic';
  }
  const words = s.toLowerCase().replace(/'/g, '').match(/[a-z]+/g) || [];
  if (words.length < 8) return 'other';
  let hi = 0;
  let en = 0;
  for (const w of words) {
    if (INDIC_WORDS.has(w)) hi++;
    else if (ENGLISH_WORDS.has(w)) en++;
  }
  if (hi >= 4 && hi >= en * 0.6) return 'roman';
  if (en >= 4 && en > hi * 1.5) return 'english';
  return 'other';
}

/**
 * Does a lyrics record's artist match the one asked for? Any one name in common is enough
 * ("Afusic, Talwiinder" ~ "Talwinder"), allowing a misspelt letter or two. Without this, a search by
 * title alone happily returns another artist's song with the same title and a similar length.
 */
function editRatio(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] / Math.max(a.length, b.length, 1);
}
const artistNames = (s) =>
  (s || '')
    .split(/\s*(?:,|&|\/|;|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\band\b)\s*/i)
    .map((x) => norm(x).replace(/\s+/g, ''))
    .filter((x) => x.length >= 2);
function artistMatches(asked, found) {
  const a = artistNames(asked);
  const f = artistNames(found);
  if (!a.length || !f.length) return false;
  return a.some((x) => f.some((y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) || editRatio(x, y) <= 0.25));
}

/** rank LRCLIB candidates: synced first, duration closest, preferred script, artist/title similarity */
export { lyricLanguage, rankLyrics, artistMatches };
function rankLyrics(list, { title, artist, duration, script }) {
  const t = norm(title);
  const a = norm(artist);
  const scored = [];
  // A Hindi / Punjabi song (some version in Devanagari / Gurmukhi or in Hinglish, or an Indic title):
  // an English-language version of it is a translation, not the song's words. Prefer the real words —
  // in English letters (Hinglish) when that's the preference, else the native script, which the site
  // shows in English letters itself. A translation is used only when nothing else exists.
  const langs = new Map((list || []).map((r) => [r, lyricLanguage(r?.syncedLyrics || r?.plainLyrics)]));
  const indicSong = /[ऀ-ॿ਀-੿]/.test(title + artist) || [...langs.values()].some((l) => l === 'indic' || l === 'roman');
  for (const r of list || []) {
    if (!r || (!r.syncedLyrics && !r.plainLyrics && !r.instrumental)) continue;
    const diff = duration && r.duration ? Math.abs(r.duration - duration) : null;
    if (diff !== null && diff > 4) continue; // a different edit / version of the song
    let score = 0;
    if (r.syncedLyrics) score += 100;
    if (r.hasWordSync) score += 5;
    if (diff !== null) score += 30 - diff * 6;
    const rt = norm(r.trackName);
    if (rt === t) score += 25;
    else if (rt.includes(t) || t.includes(rt)) score += 12;
    if (a && norm(r.artistName).includes(a.split(' ')[0])) score += 15;
    const lang = langs.get(r);
    if (indicSong && lang === 'english') score -= 80;
    else if (indicSong && script === 'latin') score += lang === 'roman' ? 20 : lang === 'indic' ? 8 : 0;
    else if (script && script !== 'any') score += scriptOf(r.syncedLyrics || r.plainLyrics) === script ? 20 : -10;
    scored.push({ r, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.map((x) => x.r);
}

/** the lyric text inside a Lyricsfile (YAML keys would skew the script detection) */
const lyricsfileText = (y) => (y || '').split('\n').map((l) => l.match(/^\s*-?\s*text:\s*(.*)$/)?.[1] ?? '').join('\n');

function lyricsPayload(record, script = 'any') {
  // The word-timed Lyricsfile is sometimes a transliteration (Roman Hindi for a Devanagari
  // record). Use it when it is in the script the user prefers, or — with no preference — in the
  // same script as the main lyrics; otherwise drop it so the chosen script is what's shown.
  if (record.hasWordSync && record.lyricsfile) {
    const main = scriptOf(record.syncedLyrics || record.plainLyrics);
    const lf = scriptOf(lyricsfileText(record.lyricsfile));
    const keep = script !== 'any' ? lf === script || (lf === main && main !== 'unknown' && main === script) : main === 'unknown' || lf === main;
    if (!keep) record = { ...record, hasWordSync: false, lyricsfile: null };
  }
  return {
    found: true,
    id: record.id,
    instrumental: Boolean(record.instrumental),
    syncedLyrics: record.syncedLyrics || null,
    plainLyrics: record.plainLyrics || null,
    // only ship the Lyricsfile when it adds word-level timing
    lyricsfile: record.hasWordSync ? record.lyricsfile || null : null,
    hasWordSync: Boolean(record.hasWordSync),
    matched: { artist: record.artistName, title: record.trackName, album: record.albumName, duration: record.duration },
    source: 'lrclib',
  };
}

async function handleLyrics(res, params) {
  const artist = (params.get('artist') || '').trim().slice(0, 200);
  const title = (params.get('title') || '').trim().slice(0, 200);
  const album = (params.get('album') || '').trim().slice(0, 200);
  const duration = Number(params.get('duration')) || 0;
  const script = ['latin', 'native'].includes(params.get('script')) ? params.get('script') : 'any';
  if (!title) return sendJson(res, 400, { error: 'title is required.' });

  const key = `lyrics3:${artist}|${title}|${album}|${Math.round(duration)}|${script}`;
  const record = await cachedJson(key, async () => {
    // exact lookup only when we have a trustworthy artist and no script preference
    if (artist && script === 'any') {
      const qs = new URLSearchParams({ artist_name: artist, track_name: title });
      if (album) qs.set('album_name', album);
      if (duration >= 1 && duration <= 3600) qs.set('duration', String(Math.round(duration)));
      const hit = await lrclib(`/api/get?${qs}`);
      if (hit && (hit.syncedLyrics || hit.instrumental) && artistMatches(artist, hit.artistName)) return hit;
    }
    // search: with the artist when known, otherwise by title alone — the duration match is what
    // makes a title-only search reliable (untagged files, "Song (From Movie).mp3" downloads…)
    const searches = artist
      ? [new URLSearchParams({ track_name: title, artist_name: artist }), new URLSearchParams({ q: `${title} ${artist}` }), new URLSearchParams({ q: title })]
      : [new URLSearchParams({ q: title })];
    const bare = (s) => norm((s || '').replace(/\s*[([][^)\]]*[)\]]/g, ''));
    for (const qs of searches) {
      const found = (await lrclib(`/api/search?${qs}`)) || [];
      let ranked = rankLyrics(found, { title, artist, duration, script });
      // Title-only (no trustworthy artist): a common title like "Long Drive" matches many songs, so
      // insist on the same title and a length within 2 s; otherwise leave it to the user's search.
      if (!artist) {
        if (!duration) return null;
        ranked = ranked.filter((r) => bare(r.trackName) === bare(title) && r.duration && Math.abs(r.duration - duration) <= 2);
      } else {
        // an artist was given: never another artist's song that happens to share the title
        ranked = ranked.filter((r) => artistMatches(artist, r.artistName));
      }
      if (ranked[0]) return ranked[0];
    }
    return null;
  });

  if (!record) return sendJson(res, 200, { found: false });
  sendJson(res, 200, lyricsPayload(record, script));
}

/** candidates for the "Search lyrics" picker */
async function handleLyricsSearch(res, params) {
  const q = (params.get('q') || '').trim().slice(0, 200);
  const duration = Number(params.get('duration')) || 0;
  if (!q) return sendJson(res, 400, { error: 'Type a song title to search.' });
  const found = (await cachedJson(`lyrics-search:${q.toLowerCase()}`, () => lrclib(`/api/search?${new URLSearchParams({ q })}`))) || [];
  const results = found
    .filter((r) => r && (r.syncedLyrics || r.plainLyrics))
    .map((r) => {
      const text = r.syncedLyrics || r.plainLyrics || '';
      const preview = text.split('\n').map((l) => l.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean).slice(0, 2);
      return {
        id: r.id,
        title: r.trackName,
        artist: r.artistName,
        album: r.albumName,
        duration: r.duration,
        synced: Boolean(r.syncedLyrics),
        wordSync: Boolean(r.hasWordSync),
        script: scriptOf(text),
        preview,
        diff: duration && r.duration ? Math.round(Math.abs(r.duration - duration)) : null,
      };
    })
    // same-length versions first, then synced, then the rest
    .sort((a, b) => (a.diff ?? 99) - (b.diff ?? 99) || Number(b.synced) - Number(a.synced))
    .slice(0, 20);
  sendJson(res, 200, { results });
}

/** one LRCLIB record by id (the user picked it in the search dialog) */
async function handleLyricsById(res, id) {
  if (!/^\d{1,12}$/.test(id)) return sendJson(res, 400, { error: 'Bad lyrics id.' });
  const record = await cachedJson(`lyrics-id:${id}`, () => lrclib(`/api/get/${id}`));
  if (!record) return sendJson(res, 404, { found: false });
  sendJson(res, 200, lyricsPayload(record));
}

// --- artists (Apple iTunes Search API) ------------------------------------------
// Official, keyless catalogue API. Artwork + 30-second previews are served by Apple with
// `Access-Control-Allow-Origin: *`, so previews are analysable directly. Results are
// cached and requests spaced out to stay well under Apple's ~20 requests/minute guidance.
const ARTISTS = {
  'kanye-west': { name: 'Kanye West', genres: ['Hip-Hop/Rap'], spotifyId: '5K4W6rqBFWDnAN6FQUkS6x' },
  drake: { name: 'Drake', genres: ['Hip-Hop/Rap'], spotifyId: '3TVXtAsR1Inumwj472S9r4' },
  'the-weeknd': { name: 'The Weeknd', genres: ['R&B/Soul', 'Pop'], spotifyId: '1Xyo4u8uXC1ZmMpatF05PJ' },
  'the-neighbourhood': { name: 'The Neighbourhood', genres: ['Alternative'], spotifyId: '77SW9BnxLY8rJ0RciFqkHh' },
};

const longCache = new Map();
async function cachedLong(key, ttlMs, fn) {
  const hit = longCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  longCache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

let itunesChain = Promise.resolve();
function itunes(path) {
  // serialise + space requests (Apple rate-limits bursts)
  const run = itunesChain.then(async () => {
    const r = await fetch(`https://itunes.apple.com${path}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) });
    await new Promise((ok) => setTimeout(ok, 350));
    if (r.status === 403 || r.status === 429) throw httpError(429, 'Apple’s catalogue is rate-limiting requests — try again in a minute.');
    if (!r.ok) throw httpError(502, `Apple’s catalogue responded with HTTP ${r.status}.`);
    return r.json();
  });
  itunesChain = run.catch(() => {});
  return run;
}

const art = (u, size = 600) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.$1`) : undefined);
const DAY = 24 * 60 * 60 * 1000;

async function resolveArtist(slug) {
  const cfg = ARTISTS[slug];
  if (!cfg) throw httpError(404, 'Unknown artist.');
  return cachedLong(`artist:${slug}`, DAY, async () => {
    const j = await itunes(`/search?${new URLSearchParams({ term: cfg.name, entity: 'musicArtist', limit: '10', country: 'US' })}`);
    const exact = (j.results || []).filter((a) => a.artistName?.toLowerCase() === cfg.name.toLowerCase());
    const pick = exact.find((a) => cfg.genres.includes(a.primaryGenreName)) || exact[0];
    if (!pick) throw httpError(404, `${cfg.name} was not found in Apple’s catalogue.`);
    return { slug, name: cfg.name, appleId: pick.artistId, appleUrl: pick.artistLinkUrl, spotifyId: cfg.spotifyId };
  });
}

const mapSong = (t) => ({
  id: t.trackId,
  title: t.trackName,
  artist: t.artistName,
  album: t.collectionName,
  albumId: t.collectionId,
  trackNumber: t.trackNumber,
  discNumber: t.discNumber,
  duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : undefined,
  previewUrl: t.previewUrl || null,
  appleUrl: t.trackViewUrl,
  artwork: art(t.artworkUrl100),
  explicit: t.trackExplicitness === 'explicit',
  releaseDate: t.releaseDate,
});

async function handleArtist(res, slug) {
  const data = await cachedLong(`artist-full:${slug}`, 12 * 60 * 60 * 1000, async () => {
    const artist = await resolveArtist(slug);
    const albumsJ = await itunes(`/lookup?${new URLSearchParams({ id: String(artist.appleId), entity: 'album', limit: '200', country: 'US' })}`);
    const seen = new Map();
    const audioOnly = (x) => !/\b(video album|music videos?|visual album)\b/i.test(x.collectionName || '');
    for (const a of (albumsJ.results || []).filter((x) => x.wrapperType === 'collection' && x.artistId === artist.appleId && audioOnly(x))) {
      // collapse clean/explicit/deluxe duplicates by base name, keeping the fuller edition
      const base = a.collectionName.toLowerCase().replace(/\s*[([].*?(deluxe|edition|version|clean|explicit|remaster).*?[)\]]/g, '').trim();
      const prev = seen.get(base);
      if (!prev || (a.collectionExplicitness === 'explicit' && prev.collectionExplicitness !== 'explicit') || a.trackCount > prev.trackCount) seen.set(base, a);
    }
    const all = [...seen.values()]
      .map((a) => ({
        id: a.collectionId,
        title: a.collectionName.replace(/ - (Single|EP)$/, ''),
        kind: / - Single$/.test(a.collectionName) ? 'single' : / - EP$/.test(a.collectionName) ? 'ep' : 'album',
        year: a.releaseDate?.slice(0, 4),
        releaseDate: a.releaseDate,
        trackCount: a.trackCount,
        artwork: art(a.artworkUrl100),
        appleUrl: a.collectionViewUrl,
        copyright: a.copyright,
      }))
      .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
    const topJ = await itunes(`/search?${new URLSearchParams({ term: artist.name, entity: 'song', limit: '50', country: 'US' })}`);
    // the same song often appears on several releases (single, album, deluxe) — keep the first
    const seenTitles = new Set();
    const top = (topJ.results || [])
      .filter((t) => t.artistId === artist.appleId && t.previewUrl)
      .filter((t) => {
        const k = t.trackName.toLowerCase().replace(/\s*[([].*?[)\]]/g, '').trim();
        if (seenTitles.has(k)) return false;
        seenTitles.add(k);
        return true;
      })
      .slice(0, 20)
      .map(mapSong);
    return {
      artist,
      albums: all.filter((a) => a.kind === 'album' && a.trackCount >= 5),
      singles: all.filter((a) => a.kind !== 'album' || a.trackCount < 5).slice(0, 24),
      top,
    };
  });
  sendJson(res, 200, data, { 'Cache-Control': 'public, max-age=3600' });
}

async function handleAlbum(res, id) {
  if (!/^\d{3,15}$/.test(id)) return sendJson(res, 400, { error: 'Bad album id.' });
  const tracks = await cachedLong(`album:${id}`, 12 * 60 * 60 * 1000, async () => {
    const j = await itunes(`/lookup?${new URLSearchParams({ id, entity: 'song', country: 'US' })}`);
    return (j.results || [])
      .filter((t) => t.wrapperType === 'track' && t.kind === 'song')
      .sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber)
      .map(mapSong);
  });
  sendJson(res, 200, { tracks }, { 'Cache-Control': 'public, max-age=3600' });
}

async function handleArtistSearch(res, slug, params) {
  const q = (params.get('q') || '').trim().slice(0, 80);
  if (!q) return sendJson(res, 400, { error: 'Type something to search.' });
  const artist = await resolveArtist(slug);
  const j = await cachedLong(`asearch:${slug}:${q.toLowerCase()}`, 60 * 60 * 1000, () =>
    itunes(`/search?${new URLSearchParams({ term: `${artist.name} ${q}`, entity: 'song', limit: '50', country: 'US' })}`),
  );
  const tracks = (j.results || []).filter((t) => t.artistId === artist.appleId || (t.artistName || '').includes(artist.name)).map(mapSong);
  sendJson(res, 200, { tracks });
}

// --- static files (production) -----------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.mjs': 'text/javascript',
};
async function serveStatic(req, res, pathname) {
  if (!existsSync(DIST)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('No production build found. Run `npm run build`, or use `npm run dev` for development.');
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const s = await stat(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': s.size,
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end();
  }
}

// --- router --------------------------------------------------------------------
/**
 * Every /api request (and, when Vayro serves itself, the site's files). Exported so the website's
 * Vercel function (api/handler.mjs) runs exactly the same code as the Mac app and `npm run dev`.
 */
export async function handle(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Allow-Methods': 'GET, HEAD' });
      return res.end();
    }
    if (pathname === '/api/health') {
      // serverless: no speech model on the server (far too large) — the website transcribes in the
      // browser instead (src/services/transcriber.ts reads this flag)
      return sendJson(res, 200, { ok: true, providers: { openverse: true, jamendo: Boolean(JAMENDO_CLIENT_ID) }, transcribe: !SERVERLESS, serverless: SERVERLESS });
    }
    if (pathname === '/api/catalog/openverse') return await handleOpenverse(res, searchParams);
    if (pathname === '/api/catalog/jamendo') return await handleJamendo(res, searchParams);
    if (pathname === '/api/stream') return await handleStream(req, res, searchParams);
    if (pathname === '/api/probe') return await handleProbe(req, res, searchParams);
    if (pathname === '/api/lyrics') return await handleLyrics(res, searchParams);
    if (pathname === '/api/lyrics/search') return await handleLyricsSearch(res, searchParams);
    if (pathname.startsWith('/api/lyrics/id/')) return await handleLyricsById(res, pathname.slice('/api/lyrics/id/'.length));
    {
      const m = pathname.match(/^\/api\/artists\/album\/(\d+)$/);
      if (m) return await handleAlbum(res, m[1]);
      const s = pathname.match(/^\/api\/artists\/([a-z-]+)(\/search)?$/);
      if (s) return s[2] ? await handleArtistSearch(res, s[1], searchParams) : await handleArtist(res, s[1]);
    }
    if (pathname.startsWith("/api/library") && (await handleLibrary(req, res, pathname, searchParams, sendJson))) return;
    if (pathname === "/api/config" && (await handleProviders(req, res, pathname, searchParams, sendJson))) return;
    // a hosted server must never follow the media of the machine it runs on — that's not the visitor's
    if (SERVERLESS && pathname.startsWith('/api/nowplaying')) return sendJson(res, 200, { supported: false, error: 'A website can’t see the Spotify app on your computer. Play songs in Vayro for synced lyrics.' });
    if (pathname.startsWith('/api/nowplaying') && (await handleNowPlaying(req, res, pathname, searchParams, sendJson))) return;
    if (SERVERLESS && pathname.startsWith('/api/transcribe')) return sendJson(res, 501, { error: 'On the website, speech recognition runs in your browser.' });
    if (await handleTranscribe(req, res, pathname, searchParams, sendJson)) return;
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint.' });
    return await serveStatic(req, res, pathname);
  } catch (err) {
    if (res.headersSent) return res.destroy();
    const aborted = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    const status = err.status || (aborted ? 504 : 502);
    const message = err.status ? err.message : aborted ? 'The source took too long to respond.' : `Could not reach the source (${err.cause?.code || err.message}).`;
    sendJson(res, status, { error: message });
  }
}

// Vayro's own server: `npm run dev` / `npm start` / the Mac app run this file directly.
// Imported by the Vercel function instead, it doesn't listen on a port.
const runDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
// HOST=127.0.0.1 (the desktop app): only this computer can connect, and no firewall prompt
if (runDirectly) http.createServer(handle).listen(PORT, process.env.HOST || undefined, () => {
  console.log(`[afterglow] API listening on http://localhost:${PORT}  (jamendo: ${JAMENDO_CLIENT_ID ? 'configured' : 'not configured'})`);
});
