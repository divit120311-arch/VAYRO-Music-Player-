// Builds and verifies Vayro's music catalogue from official, keyless sources:
//   Apple's iTunes Search API (metadata, artwork, 30-second previews, Apple Music links)
//   Popularity order, best available first:
//     1. ListenBrainz listen counts — only with LISTENBRAINZ_TOKEN in server/.env (free account;
//        ListenBrainz requires a token for this endpoint and we respect that)
//     2. otherwise: how many different releases in Apple's catalogue carry the song (hits reappear
//        on singles, albums, deluxe editions, compilations, soundtracks; deep cuts appear once)
//     3. ties: Apple's own search order
//   Each song records which signal ordered it. Songs themselves only ever come from Apple.
//   optionally Spotify's Web API for track links — only when SPOTIFY_CLIENT_ID/SECRET are set in
//   server/.env (the secret never leaves the server).
// Nothing is invented: a song is only added if Apple lists it under that artist, and it is only
// marked "verified" when its artwork loads and its links are well-formed. A song with no preview
// is kept as "external" (opens in Apple Music) and never presented as playable here.
//
//   node server/catalog/build.mjs            build / resume (keeps artists already built)
//   node server/catalog/build.mjs --fresh    rebuild everything
//   node server/catalog/build.mjs drake sza  rebuild just these
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTISTS } from './artists.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_FILE = path.join(HERE, 'catalog.json');
// artists added from Discover. The desktop app keeps them in its writable data folder (its own
// folder is read-only once installed, and writing into a signed Mac app would break its signature),
// starting from the list that ships with the app.
export const BUNDLED_EXTRA_FILE = path.join(HERE, 'catalog-added.json');
export const EXTRA_FILE = process.env.AFTERGLOW_DATA ? path.join(process.env.AFTERGLOW_DATA, 'catalog-added.json') : BUNDLED_EXTRA_FILE;
/** where to read the added artists from: the user's own list once it exists, else the bundled one */
export const extraSource = () => (existsSync(EXTRA_FILE) ? EXTRA_FILE : BUNDLED_EXTRA_FILE);
const USER_AGENT = 'Vayro/1.0 (local music player)';
export const SONGS_PER_ARTIST = 15;

export const norm = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const slugify = (s = '') => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\$/g, 's').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const art = (u, size = 600) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.$1`) : undefined);
/** "A, B & C" / "A feat. B" → names */
const credited = (artistName = '') => artistName.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\bwith\b)\s*/i).filter(Boolean);
/** versions that aren't the song as people know it */
const JUNK = /\b(instrumental|karaoke|sped[ -]?up|slowed|a ?cappella|8d audio|tribute|made famous)\b/i;
/** DJ-mix compilation entries ("Song A / Song B (Edit) [Mixed]") aren't the artist's song. (Official
 *  mashups like JAY-Z & Linkin Park's "Numb / Encore" carry no such tag and are kept.) */
const DJ_MIX = /[([]mixed[)\]]/i;
/** another version of a song (kept only when it's the only one Apple has) */
const VARIANT = /[([][^)\]]*\b(remix|live|mixed|acoustic|flip|demo|edit|mix|version|instrumental|a cappella|sped|slowed)\b[^)\]]*[)\]]|\b(remix|live from)\b/i;
const titleKey =(t) => norm(t.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''));

// ---------------------------------------------------------------------------- Apple
/** a throttled iTunes fetcher: Apple asks for roughly 20 requests a minute */
export function makeItunes(spacingMs = 3100) {
  let chain = Promise.resolve();
  return (p) => {
    const run = chain.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(`https://itunes.apple.com${p}`, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15_000) });
        await new Promise((ok) => setTimeout(ok, spacingMs));
        if ((r.status === 403 || r.status === 429) && attempt < 3) {
          await new Promise((ok) => setTimeout(ok, 20_000 * (attempt + 1)));
          continue;
        }
        if (!r.ok) throw Object.assign(new Error(`Apple’s catalogue responded with HTTP ${r.status}.`), { status: r.status === 429 || r.status === 403 ? 429 : 502 });
        return r.json();
      }
    });
    chain = run.catch(() => {});
    return run;
  };
}

/** HEAD a URL; returns { ok, type } */
async function probe(url, want) {
  if (!url) return { ok: false, why: 'missing' };
  try {
    let r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(12_000) });
    if (r.status === 405) r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1' }, signal: AbortSignal.timeout(12_000) });
    const type = r.headers.get('content-type') || '';
    return { ok: (r.ok || r.status === 206) && type.startsWith(want), why: r.ok || r.status === 206 ? type : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

async function runPool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

export const appleEmbedUrl = (appleUrl) => {
  if (!appleUrl) return null;
  const u = new URL(appleUrl);
  if (u.hostname !== 'music.apple.com') return null;
  u.hostname = 'embed.music.apple.com';
  u.searchParams.delete('uo');
  return u.toString();
};

// ---------------------------------------------------------------------------- ListenBrainz (popularity)
// MusicBrainz asks for at most one request a second; ListenBrainz is more generous.
let mbChain = Promise.resolve();
function brainz(url, spacingMs) {
  const run = mbChain.then(async () => {
    const auth = url.includes('listenbrainz.org') && process.env.LISTENBRAINZ_TOKEN ? { Authorization: `Token ${process.env.LISTENBRAINZ_TOKEN}` } : {};
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...auth }, signal: AbortSignal.timeout(15_000) });
    await new Promise((ok) => setTimeout(ok, spacingMs));
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`${new URL(url).hostname} responded with HTTP ${r.status}.`);
    return r.json();
  });
  mbChain = run.catch(() => {});
  return run;
}

/**
 * The artist's recordings by ListenBrainz listen count, most played first: [{ key, title, listens }].
 * Several MusicBrainz artists can share a name ("Future"): the one whose top songs match the most
 * Apple titles wins, so the ranking is never borrowed from a namesake.
 */
async function listenTop(name, appleKeys) {
  if (!process.env.LISTENBRAINZ_TOKEN) return []; // the endpoint requires a token: don't call it without one
  const q = await brainz(`https://musicbrainz.org/ws/2/artist/?${new URLSearchParams({ query: `artist:"${name}"`, fmt: 'json', limit: '8' })}`, 1100);
  const candidates = (q.artists || []).filter((a) => norm(a.name) === norm(name)).slice(0, 3);
  let best = { list: [], hits: 0 };
  for (const c of candidates) {
    const top = await brainz(`https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/${c.id}`, 300).catch(() => []);
    const list = (Array.isArray(top) ? top : []).map((t) => ({ key: titleKey(t.recording_name || ''), title: t.recording_name, listens: t.total_listen_count }));
    const hits = list.slice(0, 40).filter((t) => appleKeys.has(t.key)).length;
    if (hits > best.hits) best = { list, hits };
  }
  return best.hits >= 3 ? best.list : [];
}

// ---------------------------------------------------------------------------- Spotify (optional)
let spotifyToken = null;
async function spotify(p) {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (!spotifyToken || spotifyToken.expires < Date.now()) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return null;
    const j = await r.json();
    spotifyToken = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  }
  const r = await fetch(`https://api.spotify.com/v1${p}`, { headers: { Authorization: `Bearer ${spotifyToken.value}` } });
  return r.ok ? r.json() : null;
}
async function spotifyTrack(title, artist) {
  const j = await spotify(`/search?${new URLSearchParams({ q: `track:${title.replace(/\s*[([].*?[)\]]/g, '')} artist:${artist}`, type: 'track', limit: '5' })}`);
  const hit = j?.tracks?.items?.find((t) => t.artists.some((a) => norm(a.name) === norm(artist)) && titleKey(t.name) === titleKey(title));
  return hit ? { url: hit.external_urls.spotify, popularity: hit.popularity } : null;
}

// ---------------------------------------------------------------------------- one artist
/**
 * @param {{ slug: string, name: string, genres?: string[], tags?: string[], group?: string, spotifyId?: string }} def
 * @param {(p: string) => Promise<any>} itunes
 */
export async function buildArtist(def, itunes, log = () => {}) {
  const now = new Date().toISOString();
  // 1. the artist — an exact name match in Apple's catalogue, the right genre when names collide
  const aj = await itunes(`/search?${new URLSearchParams({ term: def.name, entity: 'musicArtist', limit: '15', country: 'US' })}`);
  const exact = (aj.results || []).filter((a) => norm(a.artistName) === norm(def.name));
  const pick = exact.find((a) => (def.genres || []).includes(a.primaryGenreName)) || exact[0];
  if (!pick) throw new Error(`“${def.name}” was not found in Apple’s catalogue under that exact name.`);
  const appleId = pick.artistId;

  // 2. songs. The pool: Apple's search results for the artist plus the artist's own song list —
  //    only songs credited to this artist, no karaoke/instrumental/sped-up versions.
  //    The order: see the top of this file (ListenBrainz with a token, else Apple release count).
  const sj = await itunes(`/search?${new URLSearchParams({ term: def.name, entity: 'song', limit: '200', country: 'US' })}`);
  const oj = await itunes(`/lookup?${new URLSearchParams({ id: String(appleId), entity: 'song', limit: '200', country: 'US' })}`);
  const pool = [];
  const inPool = new Set();
  for (const t of [...(sj.results || []), ...(oj.results || [])]) {
    if (t.wrapperType !== 'track' || t.kind !== 'song' || !t.trackName || inPool.has(t.trackId)) continue;
    const isTheirs = t.artistId === appleId || credited(t.artistName).some((n) => norm(n) === norm(def.name));
    if (!isTheirs || JUNK.test(t.trackName) || JUNK.test(t.collectionName || '') || DJ_MIX.test(t.trackName)) continue;
    inPool.add(t.trackId);
    pool.push(t);
  }
  // best Apple version of a title: has a preview, explicit (the original), on an album rather than a single
  const versions = new Map();
  for (const t of pool) {
    const k = titleKey(t.trackName);
    if (!k) continue;
    // the original recording beats remixes, live takes, DJ-mix edits and acoustic versions
    const variant = VARIANT.test(t.trackName) || /\b(live|remixes|mixed)\b/i.test(t.collectionName || '');
    const score = (variant ? 0 : 8) + (t.previewUrl ? 4 : 0) + (t.trackExplicitness === 'explicit' ? 2 : 0) + (/ - Single$/.test(t.collectionName || '') ? 0 : 1);
    const prev = versions.get(k);
    const releases = prev?.releases ?? new Set();
    releases.add(t.collectionId);
    if (!prev || score > prev.score) versions.set(k, { t, score, releases, appleOrder: prev?.appleOrder ?? versions.size });
  }
  const top = await listenTop(def.name, new Set(versions.keys())).catch(() => []);
  const seen = new Set();
  const picked = [];
  for (const d of top) {
    const v = versions.get(d.key);
    if (!v || seen.has(d.key)) continue;
    seen.add(d.key);
    picked.push({ t: v.t, source: 'listenbrainz', listens: d.listens });
    if (picked.length >= SONGS_PER_ARTIST) break;
  }
  for (const [k, v] of [...versions].sort((a, b) => b[1].releases.size - a[1].releases.size || a[1].appleOrder - b[1].appleOrder)) {
    if (picked.length >= SONGS_PER_ARTIST) break;
    if (seen.has(k)) continue;
    seen.add(k);
    picked.push({ t: v.t, source: 'apple-releases', releases: v.releases.size });
  }

  // 3. albums
  const lj = await itunes(`/lookup?${new URLSearchParams({ id: String(appleId), entity: 'album', limit: '200', country: 'US' })}`);
  const byBase = new Map();
  for (const a of (lj.results || []).filter((x) => x.wrapperType === 'collection' && x.artistId === appleId)) {
    if (/\b(video album|music videos?|visual album|with videos)\b/i.test(a.collectionName || '') || JUNK.test(a.collectionName || '')) continue;
    const base = a.collectionName.toLowerCase().replace(/\s*[([].*?(deluxe|edition|version|clean|explicit|remaster).*?[)\]]/g, '').trim();
    const prev = byBase.get(base);
    if (!prev || (a.collectionExplicitness === 'explicit' && prev.collectionExplicitness !== 'explicit') || a.trackCount > prev.trackCount) byBase.set(base, a);
  }
  const albums = [...byBase.values()]
    .filter((a) => !/ - (Single|EP)$/.test(a.collectionName) && a.trackCount >= 5)
    .sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
    .slice(0, 12)
    .map((a) => ({
      id: `apple-album:${a.collectionId}`,
      providerAlbumId: a.collectionId,
      title: a.collectionName,
      artist: a.artistName,
      artistSlug: def.slug,
      releaseDate: a.releaseDate,
      year: a.releaseDate?.slice(0, 4),
      trackCount: a.trackCount,
      artwork: art(a.artworkUrl100),
      appleMusicUrl: a.collectionViewUrl,
      genre: a.primaryGenreName,
    }));

  // 4. verify every song: artwork really loads, the preview really is audio, links are well-formed
  const tracks = await runPool(picked, 8, async ({ t, source, listens, releases }, rank) => {
    const artwork = art(t.artworkUrl100);
    const [artOk, prevOk] = await Promise.all([probe(artwork, 'image/'), t.previewUrl ? probe(t.previewUrl, 'audio/') : Promise.resolve({ ok: false, why: 'no preview from Apple' })]);
    const appleUrl = t.trackViewUrl?.replace(/[?&]uo=\d+/, '') || null;
    const linkOk = Boolean(appleUrl && /^https:\/\/music\.apple\.com\/.+\?i=\d+/.test(appleUrl));
    const sp = await spotifyTrack(t.trackName, def.name).catch(() => null);
    const q = `${def.name} ${t.trackName.replace(/\s*[([].*?[)\]]/g, '')}`;
    return {
      id: `apple:${t.trackId}`,
      title: t.trackName,
      artist: t.artistName,
      artistSlug: def.slug,
      album: t.collectionName,
      albumId: `apple-album:${t.collectionId}`,
      releaseDate: t.releaseDate,
      year: t.releaseDate?.slice(0, 4),
      duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : undefined,
      artwork: artOk.ok ? artwork : undefined,
      explicit: t.trackExplicitness === 'explicit',
      genre: t.primaryGenreName,
      provider: 'apple',
      providerTrackId: t.trackId,
      appleMusicUrl: linkOk ? appleUrl : null,
      embedUrl: linkOk ? appleEmbedUrl(appleUrl) : null,
      spotifyUrl: sp?.url ?? null,
      spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
      previewUrl: prevOk.ok ? t.previewUrl : null,
      /** preview: Apple's 30-second clip plays here (and drives the lighting); external: opens in Apple Music */
      playbackType: prevOk.ok ? 'preview' : 'external',
      /** rank in this artist's list; source says what ordered it (ListenBrainz listens, or the number of Apple releases carrying the song) */
      popularity: { source, rank: rank + 1, ...(listens ? { listens } : {}), ...(releases ? { releases } : {}), ...(sp ? { spotify: sp.popularity } : {}) },
      verification: {
        status: artOk.ok && linkOk ? 'verified' : 'partial',
        checkedAt: now,
        checks: { artist: `apple:${appleId}`, artwork: artOk.ok ? 'ok' : artOk.why, preview: prevOk.ok ? 'ok' : prevOk.why, appleMusicUrl: linkOk ? 'ok' : 'missing' },
      },
    };
  });

  // 5. one official embed per artist actually loads (the format is the same for every track)
  const sample = tracks.find((t) => t.embedUrl);
  const embedOk = sample ? (await probe(sample.embedUrl, 'text/html')).ok : false;
  if (!embedOk) for (const t of tracks) t.embedUrl = null;

  const image = albums[0]?.artwork || tracks[0]?.artwork;
  log(`${def.name}: ${tracks.length} songs (${tracks.filter((t) => t.popularity.source === 'listenbrainz').length} by listens, ${tracks.filter((t) => t.popularity.source === 'apple-releases').length} by release count, ${tracks.filter((t) => t.playbackType === 'preview').length} previews), ${albums.length} albums${embedOk ? '' : ', embed unavailable'}`);
  return {
    artist: {
      slug: def.slug,
      name: pick.artistName,
      group: def.group ?? 'added',
      tags: def.tags ?? [],
      primaryGenre: pick.primaryGenreName,
      appleId,
      appleMusicUrl: pick.artistLinkUrl?.replace(/[?&]uo=\d+/, ''),
      spotifyUrl: def.spotifyId ? `https://open.spotify.com/artist/${def.spotifyId}` : null,
      /** Apple's API has no artist photos: this is the cover of their latest album (or top song) */
      image,
      imageKind: 'album-art',
      builtAt: now,
    },
    tracks,
    albums,
  };
}

// ---------------------------------------------------------------------------- whole catalogue
export async function readCatalog(file = CATALOG_FILE) {
  if (!existsSync(file)) return { version: 1, builtAt: null, source: 'Apple iTunes Search API', artists: [], tracks: [], albums: [], failures: [] };
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeCatalog(cat, file = CATALOG_FILE) {
  await mkdir(path.dirname(file), { recursive: true }); // a fresh data folder (Mac app, Vercel /tmp)
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(cat));
  await rename(tmp, file);
}

export function mergeArtist(cat, built) {
  cat.artists = cat.artists.filter((a) => a.slug !== built.artist.slug).concat(built.artist);
  cat.tracks = cat.tracks.filter((t) => t.artistSlug !== built.artist.slug).concat(built.tracks);
  cat.albums = cat.albums.filter((a) => a.artistSlug !== built.artist.slug).concat(built.albums);
  cat.failures = (cat.failures || []).filter((f) => f.slug !== built.artist.slug);
  // a song credited to two catalogue artists (a collaboration) is listed once
  const ids = new Set();
  cat.tracks = cat.tracks.filter((t) => (ids.has(t.id) ? false : ids.add(t.id)));
  return cat;
}

async function main() {
  try {
    const env = await readFile(path.join(HERE, '..', '.env'), 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  const args = process.argv.slice(2);
  const fresh = args.includes('--fresh');
  const only = args.filter((a) => !a.startsWith('--'));
  const cat = fresh ? await readCatalog('/nonexistent') : await readCatalog();
  const done = new Set(cat.artists.map((a) => a.slug));
  const todo = ARTISTS.filter((a) => (only.length ? only.includes(a.slug) : !done.has(a.slug)));
  const itunes = makeItunes();
  console.log(`[catalog] ${todo.length} artist(s) to build${process.env.SPOTIFY_CLIENT_ID ? ' (Spotify links on)' : ' (no Spotify keys: Spotify search links only)'}`);
  const t0 = Date.now();
  for (const def of todo) {
    try {
      const built = await buildArtist(def, itunes, (m) => console.log(`[catalog] ${m}`));
      mergeArtist(cat, built);
    } catch (e) {
      console.log(`[catalog] FAILED ${def.name}: ${e.message}`);
      cat.failures = (cat.failures || []).filter((f) => f.slug !== def.slug).concat({ slug: def.slug, name: def.name, error: e.message, at: new Date().toISOString() });
    }
    cat.builtAt = new Date().toISOString();
    // keep the registry's order
    const order = new Map(ARTISTS.map((a, i) => [a.slug, i]));
    cat.artists.sort((a, b) => (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999));
    await writeCatalog(cat); // after every artist, so an interrupted build resumes
  }
  const v = cat.tracks.filter((t) => t.verification.status === 'verified').length;
  console.log(`[catalog] done in ${((Date.now() - t0) / 1000).toFixed(0)} s: ${cat.artists.length} artists, ${cat.tracks.length} songs (${v} verified, ${cat.tracks.filter((t) => t.playbackType === 'preview').length} previews), ${cat.albums.length} albums, ${cat.failures.length} failures`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
