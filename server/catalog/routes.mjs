// /api/library — Vayro's music catalogue.
//   GET  /api/library                      the verified catalogue (built by server/catalog/build.mjs)
//   GET  /api/library/search?q=            live search of Apple's whole catalogue (songs, artists, albums)
//   POST /api/library/artists {name}       add an artist found in Discover: built + verified like the rest
//   POST /api/library/artists/:slug/remove remove an artist you added (built-in artists can't be removed)
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { ARTISTS, GENRE_COLLECTIONS } from './artists.mjs';
import { CATALOG_FILE, EXTRA_FILE, extraSource, appleEmbedUrl, buildArtist, makeItunes, mergeArtist, norm, readCatalog, slugify, writeCatalog } from './build.mjs';

// live requests: spaced like the build so Apple's ~20/minute guidance holds even when browsing hard
const itunes = makeItunes(1200);
const art = (u, size = 600) => (u ? u.replace(/\/\d+x\d+bb\.(jpg|png)$/, `/${size}x${size}bb.$1`) : undefined);

let cache = { key: '', value: null };
async function fullCatalog() {
  const m1 = existsSync(CATALOG_FILE) ? (await stat(CATALOG_FILE)).mtimeMs : 0;
  const m2 = existsSync(extraSource()) ? (await stat(extraSource())).mtimeMs : 0;
  const key = `${m1}:${m2}`;
  if (cache.key === key && cache.value) return cache.value;
  const base = await readCatalog(CATALOG_FILE);
  const extra = await readCatalog(extraSource());
  const added = new Set(extra.artists.map((a) => a.slug));
  const ids = new Set();
  const value = {
    version: 1,
    builtAt: base.builtAt,
    source: base.source,
    genres: GENRE_COLLECTIONS,
    artists: [...base.artists.filter((a) => !added.has(a.slug)), ...extra.artists.map((a) => ({ ...a, userAdded: true }))],
    tracks: [...base.tracks.filter((t) => !added.has(t.artistSlug)), ...extra.tracks].filter((t) => (ids.has(t.id) ? false : ids.add(t.id))),
    albums: [...base.albums.filter((a) => !added.has(a.artistSlug)), ...extra.albums],
    failures: base.failures || [],
    registry: ARTISTS.length,
  };
  cache = { key, value };
  return value;
}

const mapLive = (t) => {
  const appleUrl = t.trackViewUrl?.replace(/[?&]uo=\d+/, '') || null;
  const q = `${t.artistName} ${t.trackName}`;
  return {
    id: `apple:${t.trackId}`,
    title: t.trackName,
    artist: t.artistName,
    artistSlug: null,
    album: t.collectionName,
    albumId: `apple-album:${t.collectionId}`,
    releaseDate: t.releaseDate,
    year: t.releaseDate?.slice(0, 4),
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : undefined,
    artwork: art(t.artworkUrl100),
    explicit: t.trackExplicitness === 'explicit',
    genre: t.primaryGenreName,
    provider: 'apple',
    providerTrackId: t.trackId,
    appleMusicUrl: appleUrl,
    embedUrl: appleEmbedUrl(appleUrl),
    spotifyUrl: null,
    spotifySearchUrl: `https://open.spotify.com/search/${encodeURIComponent(q)}`,
    previewUrl: t.previewUrl || null,
    playbackType: t.previewUrl ? 'preview' : 'external',
    popularity: { source: 'apple-search-order' },
    // straight from Apple at search time; the catalogue's extra checks haven't been run on it
    verification: { status: 'provider', checkedAt: new Date().toISOString(), checks: {} },
  };
};

const liveCache = new Map();
async function search(q) {
  const k = q.toLowerCase();
  const hit = liveCache.get(k);
  if (hit && hit.expires > Date.now()) return hit.value;
  const [songs, artists, albums] = await Promise.all([
    itunes(`/search?${new URLSearchParams({ term: q, entity: 'song', limit: '40', country: 'US' })}`),
    itunes(`/search?${new URLSearchParams({ term: q, entity: 'musicArtist', limit: '8', country: 'US' })}`),
    itunes(`/search?${new URLSearchParams({ term: q, entity: 'album', limit: '12', country: 'US' })}`),
  ]);
  const value = {
    tracks: (songs.results || []).filter((t) => t.kind === 'song').map(mapLive),
    artists: (artists.results || []).map((a) => ({ name: a.artistName, appleId: a.artistId, genre: a.primaryGenreName, appleMusicUrl: a.artistLinkUrl?.replace(/[?&]uo=\d+/, '') })),
    albums: (albums.results || [])
      .filter((a) => !/ - (Single|EP)$/.test(a.collectionName || ''))
      .map((a) => ({ id: `apple-album:${a.collectionId}`, providerAlbumId: a.collectionId, title: a.collectionName, artist: a.artistName, year: a.releaseDate?.slice(0, 4), artwork: art(a.artworkUrl100), appleMusicUrl: a.collectionViewUrl, trackCount: a.trackCount })),
  };
  liveCache.set(k, { value, expires: Date.now() + 30 * 60 * 1000 });
  return value;
}

async function readJson(req, max = 10_000) {
  let size = 0;
  const parts = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw Object.assign(new Error('Request too large.'), { status: 413 });
    parts.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Bad JSON.'), { status: 400 });
  }
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const building = new Map();

/** @returns {Promise<boolean>} true when handled */
export async function handleLibrary(req, res, pathname, sp, sendJson) {
  if (pathname === '/api/library' && req.method === 'GET') {
    sendJson(res, 200, await fullCatalog(), { 'Cache-Control': 'no-cache' });
    return true;
  }
  if (pathname === '/api/library/search' && req.method === 'GET') {
    const q = (sp.get('q') || '').trim().slice(0, 80);
    if (!q) return sendJson(res, 400, { error: 'Type something to search.' }), true;
    sendJson(res, 200, await search(q));
    return true;
  }
  if (pathname === '/api/library/artists' && req.method === 'POST') {
    if (!isLoopback(req)) return sendJson(res, 403, { error: 'Only this computer can change the library.' }), true;
    const { name } = await readJson(req);
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) return sendJson(res, 400, { error: 'Which artist?' }), true;
    const slug = slugify(clean);
    const cat = await fullCatalog();
    const existing = cat.artists.find((a) => a.slug === slug || norm(a.name) === norm(clean));
    if (existing) return sendJson(res, 200, { artist: existing, already: true }), true;
    // one build per artist at a time (double clicks join the same build)
    if (!building.has(slug)) {
      building.set(slug, (async () => {
        const built = await buildArtist({ slug, name: clean, tags: [], group: 'added' }, itunes);
        const extra = await readCatalog(extraSource());
        built.artist.addedAt = new Date().toISOString();
        await writeCatalog(mergeArtist(extra, built), EXTRA_FILE);
        return built;
      })().finally(() => building.delete(slug)));
    }
    try {
      const built = await building.get(slug);
      sendJson(res, 200, { artist: { ...built.artist, userAdded: true }, tracks: built.tracks.length, albums: built.albums.length });
    } catch (e) {
      sendJson(res, e.status || 404, { error: e.message });
    }
    return true;
  }
  const rm = pathname.match(/^\/api\/library\/artists\/([a-z0-9-]+)\/remove$/);
  if (rm && req.method === 'POST') {
    if (!isLoopback(req)) return sendJson(res, 403, { error: 'Only this computer can change the library.' }), true;
    const extra = await readCatalog(extraSource());
    if (!extra.artists.some((a) => a.slug === rm[1])) return sendJson(res, 404, { error: 'Only artists you added can be removed.' }), true;
    extra.artists = extra.artists.filter((a) => a.slug !== rm[1]);
    extra.tracks = extra.tracks.filter((t) => t.artistSlug !== rm[1]);
    extra.albums = extra.albums.filter((a) => a.artistSlug !== rm[1]);
    await writeCatalog(extra, EXTRA_FILE);
    sendJson(res, 200, { removed: rm[1] });
    return true;
  }
  return false;
}
