import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowLeft, AudioLines, ExternalLink, Info, Lamp, Loader2, Play, Plus, Search, X } from 'lucide-react';
import { useStore } from '../../store';
import { closeArtists, openArtists, openLibrary, uiStore } from '../../state/ui';
import { updateSettings } from '../../state/settings';
import { enqueue, playList, usePlayer } from '../../hooks/useAudioPlayer';
import { ARTISTS, ARTIST_BY_SLUG, spotifyArtistUrl, spotifyEmbedUrl, type ArtistTheme } from '../../config/artists';
import { fetchAlbum, fetchArtist, searchArtist, songToTrack, type AppleAlbum, type AppleSong, type ArtistCatalog } from '../../services/appleMusicProvider';
import { IconButton, cx, formatTime } from '../ui';

// --------------------------------------------------------------------------------- data hooks
const catalogCache = new Map<string, ArtistCatalog>();

function useCatalog(slug: string) {
  const [data, setData] = useState<ArtistCatalog | null>(() => catalogCache.get(slug) ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (catalogCache.has(slug)) return setData(catalogCache.get(slug)!);
    const ac = new AbortController();
    setData(null);
    setError(null);
    fetchArtist(slug, ac.signal)
      .then((d) => {
        catalogCache.set(slug, d);
        setData(d);
      })
      .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message));
    return () => ac.abort();
  }, [slug]);
  return { data, error };
}

// --------------------------------------------------------------------------------- shared bits
function Cover({ src, filter, className, alt = '' }: { src?: string; filter?: string; className?: string; alt?: string }) {
  return (
    <div className={cx('overflow-hidden bg-white/[0.05]', className)}>
      {src && <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" style={{ filter }} />}
    </div>
  );
}

function ExtLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium ring-1 ring-white/15 transition-colors hover:bg-white/[0.06]', className)}>
      {children}
      <ExternalLink size={12} className="opacity-60" />
    </a>
  );
}

/** what Vayro can do with a song: preview (reactive) or external only */
function Capability({ song }: { song: AppleSong }) {
  return song.previewUrl ? (
    <span title="Apple's 30-second preview plays here and drives the lighting. The full song opens in Apple Music or Spotify." className="whitespace-nowrap rounded-full px-1.5 py-[1px] text-[10px] text-emerald-200/80 ring-1 ring-emerald-300/20">
      30s preview · reactive
    </span>
  ) : (
    <span title="No preview available — opens in Apple Music" className="whitespace-nowrap rounded-full px-1.5 py-[1px] text-[10px] text-ink-3 ring-1 ring-line">
      external only
    </span>
  );
}

function SongRow({ song, theme, index, onPlay, showAlbum }: { song: AppleSong; theme: ArtistTheme; index: number; onPlay: () => void; showAlbum?: boolean }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const active = currentId === `apple:${song.id}`;
  return (
    <li className={cx('group grid grid-cols-[28px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-xl px-2 py-1.5', active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]')}>
      <button
        type="button"
        onClick={onPlay}
        disabled={!song.previewUrl}
        aria-label={song.previewUrl ? `Play preview of ${song.title}` : `${song.title} has no preview`}
        className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-mono text-ink-3 disabled:opacity-40"
      >
        <span className={cx(active ? 'hidden' : 'group-hover:hidden')}>{String(index + 1).padStart(2, '0')}</span>
        {active ? <AudioLines size={15} style={{ color: theme.accent }} /> : <Play size={13} fill="currentColor" className="hidden text-ink group-hover:block" />}
      </button>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-medium" style={{ color: active ? theme.accent : undefined }}>
          {song.title}
          {song.explicit && <span className="ml-1.5 rounded-[3px] bg-white/15 px-1 text-[9px] font-bold text-ink-2">E</span>}
        </p>
        <div className="flex items-center gap-2 text-[11.5px] text-ink-3">
          {showAlbum && <span className="truncate">{song.album}</span>}
          <Capability song={song} />
        </div>
      </div>
      <span className="tabular font-mono text-[11px] text-ink-3">{song.duration ? formatTime(song.duration) : ''}</span>
      <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
        {song.previewUrl && (
          <IconButton label="Add preview to queue" size="sm" onClick={() => enqueue([songToTrack(song)])}>
            <Plus size={14} />
          </IconButton>
        )}
        <a href={song.appleUrl} target="_blank" rel="noreferrer" aria-label={`Open ${song.title} in Apple Music`} title="Full song in Apple Music" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-white/[0.06] hover:text-ink">
          <ExternalLink size={13} />
        </a>
      </div>
    </li>
  );
}

function playSongs(songs: AppleSong[], start: AppleSong) {
  const playable = songs.filter((s) => s.previewUrl);
  const idx = playable.findIndex((s) => s.id === start.id);
  if (idx < 0) return;
  playList(playable.map(songToTrack), idx);
}

// --------------------------------------------------------------------------------- index
function ArtistTile({ theme, i }: { theme: ArtistTheme; i: number }) {
  const { data } = useCatalog(theme.slug);
  const covers = (data?.albums ?? []).slice(0, 4);
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => openArtists(theme.slug)}
      className="group relative flex min-h-[300px] flex-col justify-end overflow-hidden rounded-[20px] p-5 text-left ring-1 ring-white/[0.08] transition-[transform,box-shadow] duration-500 hover:-translate-y-1"
      style={{ background: theme.background, boxShadow: `0 30px 80px -40px ${theme.accent}55` }}
    >
      <div className="absolute inset-0 grid grid-cols-2 opacity-60 transition-opacity duration-700 group-hover:opacity-85">
        {covers.length
          ? covers.map((c) => <Cover key={c.id} src={c.artwork} filter={theme.artFilter} className="h-full w-full" />)
          : Array.from({ length: 4 }, (_, k) => <div key={k} className="skeleton" />)}
      </div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0.92) 88%)' }} />
      <div className="relative">
        <p className="text-[clamp(30px,3vw,46px)]" style={{ ...theme.nameStyle, color: theme.nameStyle.color ?? theme.ink }}>
          {theme.name}
        </p>
        <p className="mt-2 text-[12px] tracking-wide" style={{ color: theme.accent }}>
          {theme.tagline}
        </p>
        <p className="mt-1 text-[11.5px] text-ink-3">{data ? `${data.albums.length} albums · ${data.top.length} previews` : 'Loading catalogue…'}</p>
      </div>
    </motion.button>
  );
}

function ArtistIndex() {
  return (
    <div data-scroll-main className="scroll-quiet h-full overflow-y-auto p-7 max-sm:p-4">
      <div className="mb-6 flex items-end justify-between gap-6">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-ink-3">Featured artists</p>
          <h2 className="mt-2 text-[clamp(26px,2.6vw,38px)] font-semibold tracking-[-0.02em]">Four artists, lit their way.</h2>
        </div>
        <p className="max-w-[420px] text-right text-[12px] leading-relaxed text-ink-3">
          Catalogues and artwork from Apple’s official API. 30-second previews play here and drive the lighting; full songs open in Apple Music or Spotify.
        </p>
      </div>
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">
        {ARTISTS.map((a, i) => (
          <ArtistTile key={a.slug} theme={a} i={i} />
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------- artist page
type Tab = 'top' | 'albums' | 'singles';

function AlbumPanel({ album, theme, onClose }: { album: AppleAlbum; theme: ArtistTheme; onClose: () => void }) {
  const [tracks, setTracks] = useState<AppleSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setTracks(null);
    setError(null);
    fetchAlbum(album.id, ac.signal)
      .then((r) => setTracks(r.tracks))
      .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message));
    return () => ac.abort();
  }, [album.id]);
  const total = tracks?.reduce((a, t) => a + (t.duration ?? 0), 0) ?? 0;
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.35 }} className="grid grid-cols-[minmax(200px,280px)_1fr] gap-6 max-lg:grid-cols-1">
      <div>
        <Cover src={album.artwork} filter={theme.artFilter} className="aspect-square w-full rounded-2xl shadow-[0_30px_70px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10" alt={`${album.title} cover`} />
        <button type="button" onClick={onClose} className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink">
          <ArrowLeft size={13} /> All releases
        </button>
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.25em]" style={{ color: theme.accent }}>
          {album.kind} · {album.year}
        </p>
        <h3 className="mt-1 text-[clamp(24px,2.4vw,36px)] font-semibold leading-tight tracking-[-0.02em]">{album.title}</h3>
        <p className="mt-1 text-[12px] text-ink-3">
          {album.trackCount} tracks{total ? ` · ${Math.round(total / 60)} min` : ''} {album.copyright && <span className="text-ink-4">· {album.copyright}</span>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tracks?.some((t) => t.previewUrl) && (
            <button type="button" onClick={() => tracks && playSongs(tracks, tracks.find((t) => t.previewUrl)!)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold text-black" style={{ background: theme.accent }}>
              <Play size={13} fill="currentColor" /> Play previews
            </button>
          )}
          <ExtLink href={album.appleUrl}>Full album on Apple Music</ExtLink>
        </div>
        {error && <p className="mt-4 text-[12.5px] text-red-200/90">{error}</p>}
        <ul className="mt-4 flex flex-col">
          {tracks?.length === 0 && <li className="py-4 text-[12.5px] text-ink-3">Apple lists no audio tracks for this release — open it in Apple Music instead.</li>}
          {tracks
            ? tracks.map((t, i) => <SongRow key={t.id} song={t} theme={theme} index={i} onPlay={() => playSongs(tracks, t)} />)
            : !error && Array.from({ length: 8 }, (_, i) => <li key={i} className="skeleton my-1 h-9 rounded-lg" />)}
        </ul>
      </div>
    </motion.div>
  );
}

function ArtistPage({ slug }: { slug: string }) {
  const theme = ARTIST_BY_SLUG[slug];
  const { data, error } = useCatalog(slug);
  const [tab, setTab] = useState<Tab>('top');
  const [album, setAlbum] = useState<AppleAlbum | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AppleSong[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [spotify, setSpotify] = useState(false);
  const hero = data?.albums[0] ?? data?.singles[0];

  const filteredAlbums = useMemo(() => {
    const list = tab === 'singles' ? data?.singles : data?.albums;
    return list ?? [];
  }, [data, tab]);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return setResults(null);
    setSearching(true);
    setSearchErr(null);
    try {
      setResults((await searchArtist(slug, q.trim())).tracks);
    } catch (err) {
      setSearchErr((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div data-scroll-main className="scroll-quiet h-full overflow-y-auto" style={{ background: theme.background, color: theme.ink }}>
      {/* hero */}
      <section className="relative grid grid-cols-[1fr_auto] items-end gap-8 px-8 pb-6 pt-8 max-lg:grid-cols-1">
        <div className="min-w-0">
          <button type="button" onClick={() => openArtists('index')} className="mb-5 inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink">
            <ArrowLeft size={13} /> All artists
          </button>
          <motion.h2
            initial={{ opacity: 0, y: 24, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="text-[clamp(52px,8vw,128px)]"
            style={{ ...theme.nameStyle, color: theme.nameStyle.color ?? theme.ink }}
          >
            {theme.name}
          </motion.h2>
          <p className="mt-3 text-[13px] tracking-wide" style={{ color: theme.accent }}>
            {theme.tagline}
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!data?.top.length}
              onClick={() => data && playSongs(data.top, data.top[0])}
              className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-semibold text-black disabled:opacity-40"
              style={{ background: theme.accent, boxShadow: `0 0 40px -10px ${theme.accent}` }}
            >
              <Play size={14} fill="currentColor" /> Play top previews
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ matchArtwork: false, primary: theme.light.primary, secondary: theme.light.secondary })}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[12.5px] font-medium ring-1 ring-white/15 hover:bg-white/[0.06]"
              title="Set the edge lighting to this artist's palette"
            >
              <Lamp size={14} /> Light the room
            </button>
            {data && <ExtLink href={data.artist.appleUrl}>Apple Music</ExtLink>}
            <ExtLink href={spotifyArtistUrl(theme.spotifyId)}>Spotify</ExtLink>
            <button type="button" onClick={() => setSpotify((v) => !v)} aria-pressed={spotify} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-medium ring-1 ring-white/15 hover:bg-white/[0.06]">
              {spotify ? 'Hide' : 'Show'} Spotify player
            </button>
          </div>
        </div>
        {hero && (
          <motion.div initial={{ opacity: 0, scale: 0.94, rotate: -2 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} className="relative max-lg:hidden">
            <div className="absolute -inset-6 rounded-[30px] opacity-60 blur-3xl" style={{ background: `radial-gradient(circle, ${theme.accent}55, transparent 70%)` }} />
            <Cover src={hero.artwork} filter={theme.artFilter} className="relative h-[230px] w-[230px] rounded-2xl ring-1 ring-white/10" alt={`${hero.title} cover`} />
            <p className="relative mt-2 text-right text-[11px] text-ink-3">Latest · {hero.title}</p>
          </motion.div>
        )}
      </section>

      <AnimatePresence>
        {spotify && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden px-8">
            <div className="mb-6 grid grid-cols-[minmax(0,560px)_1fr] gap-5 max-lg:grid-cols-1">
              <iframe
                title={`${theme.name} on Spotify`}
                src={spotifyEmbedUrl(theme.spotifyId)}
                width="100%"
                height="352"
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                className="rounded-2xl"
              />
              <div className="flex flex-col justify-center gap-3 rounded-2xl bg-black/30 p-5 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-white/10">
                <p className="flex items-center gap-2 font-semibold text-ink">
                  <Info size={14} /> Plays, but can’t light the room
                </p>
                <p>
                  This is Spotify’s official player. Its audio stays inside Spotify’s protected player, so the browser gives Vayro no access
                  to it — the lights stay in ambient mode while it plays. Pause Vayro first to avoid two songs at once.
                </p>
                <p>For reactive lighting, use the 30-second previews here, or play your own copy of a song:</p>
                <button type="button" onClick={() => openLibrary('files')} className="self-start rounded-full bg-ink px-4 py-2 text-[12px] font-semibold text-black">
                  Upload my own audio
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* body */}
      <section className="px-8 pb-10">
        {error ? (
          <div className="flex items-start gap-2 rounded-2xl bg-black/30 p-4 text-[13px] text-ink-2 ring-1 ring-white/10">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        ) : !data ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-ink-3">
            <Loader2 size={16} className="animate-spin" /> Loading {theme.name}’s catalogue from Apple…
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-8 mb-4 flex flex-wrap items-center justify-between gap-3 px-8 py-3 backdrop-blur-xl" style={{ background: 'rgba(0,0,0,0.35)' }}>
              <div role="tablist" className="flex gap-1">
                {(
                  [
                    ['top', `Top tracks`],
                    ['albums', `Albums · ${data.albums.length}`],
                    ['singles', `Singles & EPs · ${data.singles.length}`],
                  ] as [Tab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    type="button"
                    aria-selected={tab === id && !results}
                    onClick={() => {
                      setTab(id);
                      setAlbum(null);
                      setResults(null);
                      setQ('');
                    }}
                    className={cx('rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors', tab === id && !results ? 'bg-white/[0.12] text-ink' : 'text-ink-3 hover:text-ink-2')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <form onSubmit={search} className="relative w-[min(340px,100%)]">
                <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (!e.target.value) setResults(null);
                  }}
                  placeholder={`Search ${theme.name} songs…`}
                  aria-label={`Search ${theme.name} songs`}
                  className="h-9 w-full rounded-full bg-white/[0.06] pl-9 pr-9 text-[12.5px] text-ink outline-none ring-1 ring-white/10 placeholder:text-ink-3 focus:ring-white/25"
                />
                {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-3" />}
              </form>
            </div>

            {results ? (
              <div>
                <p className="mb-2 text-[12px] text-ink-3">
                  {results.length} result{results.length === 1 ? '' : 's'} for “{q}”
                </p>
                {searchErr && <p className="text-[12.5px] text-red-200/90">{searchErr}</p>}
                <ul className="flex flex-col">
                  {results.map((s, i) => (
                    <SongRow key={s.id} song={s} theme={theme} index={i} showAlbum onPlay={() => playSongs(results, s)} />
                  ))}
                </ul>
              </div>
            ) : tab === 'top' ? (
              <ul className="grid grid-cols-2 gap-x-6 max-xl:grid-cols-1">
                {data.top.map((s, i) => (
                  <SongRow key={s.id} song={s} theme={theme} index={i} showAlbum onPlay={() => playSongs(data.top, s)} />
                ))}
              </ul>
            ) : (
              <AnimatePresence mode="wait">
                {album ? (
                  <AlbumPanel key={album.id} album={album} theme={theme} onClose={() => setAlbum(null)} />
                ) : (
                  <motion.ul key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-5">
                    {filteredAlbums.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => setAlbum(a)} className="group w-full text-left">
                          <Cover src={a.artwork} filter={theme.artFilter} className="aspect-square w-full rounded-xl ring-1 ring-white/10 transition-transform duration-500 group-hover:-translate-y-1" alt={`${a.title} cover`} />
                          <p className="mt-2 truncate text-[13px] font-medium">{a.title}</p>
                          <p className="text-[11.5px] text-ink-3">
                            {a.year} · {a.trackCount} tracks
                          </p>
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            )}
            <p className="mt-8 text-[11px] leading-relaxed text-ink-3">
              Catalogue, artwork and previews courtesy of Apple Music (iTunes Search API). Previews are 30-second clips; play full songs on Apple Music or Spotify.
              Artwork © respective rights holders.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

// --------------------------------------------------------------------------------- shell
export function ArtistsView() {
  const route = useStore(uiStore, (s) => s.artists);
  const backendOk = usePlayer((s) => s.backend.ok);
  const checked = usePlayer((s) => s.backend.checked);
  return (
    <AnimatePresence>
      {route && (
        <motion.section
          initial={{ opacity: 0, y: 16, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Artists"
          className="glass fixed bottom-[164px] left-6 right-6 top-[var(--panel-top)] z-30 overflow-hidden rounded-[24px]"
        >
          <IconButton label="Close artists" onClick={closeArtists} className="absolute right-4 top-4 z-20 bg-black/30">
            <X size={16} />
          </IconButton>
          {checked && !backendOk ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-[13px] text-ink-3">The Vayro server isn’t running, so the artist catalogues can’t be loaded.</div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="h-full">
                {route === 'index' || !ARTIST_BY_SLUG[route] ? <ArtistIndex /> : <ArtistPage slug={route} />}
              </motion.div>
            </AnimatePresence>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

