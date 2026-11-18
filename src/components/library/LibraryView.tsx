import { Children, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, ArrowLeft, AudioLines, Clock, Compass, Disc3, ExternalLink, Flame, Heart, Home, ListMusic, ListPlus, Loader2, Mic2, MoreHorizontal, Music2, Play,
  Plus, Search, Sparkles, Trash2, UserPlus, X,
} from 'lucide-react';
import { useStore } from '../../store';
import { closeMusic, openArtists, openMusic, uiStore } from '../../state/ui';
import { enqueue, playList, usePlayer } from '../../hooks/useAudioPlayer';
import { playerStore, togglePlay } from '../../state/player';
import { ARTIST_BY_SLUG } from '../../config/artists';
import {
  PLAYBACK_LABEL, addArtist, fetchAlbumTracks, fetchCatalog, removeArtist, searchLive, toTrack,
  type Catalog, type CatalogAlbum, type CatalogArtist, type CatalogTrack, type LiveResults,
} from '../../services/libraryCatalog';
import {
  addToPlaylist, clearHistory, createPlaylist, deletePlaylist, isFavorite, libraryStore, removeFromPlaylist, renamePlaylist, toggleFavorite, type Playlist,
} from '../../state/library';
import { IconButton, cx, formatTime } from '../ui';
import { PageTransition, Stagger, StaggerItem } from '../motion';
import { HoverLensGroup } from '../HoverLens';

// =============================================================================================
// The music library: real songs by real artists (Apple's catalogue, verified at build time).
// Every row says how it plays: "30s preview" (plays here, lights the room) or "Apple Music only".
// =============================================================================================

// ------------------------------------------------------------------------------- data
function useCatalog() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchCatalog(tick > 0)
      .then((c) => live && setCat(c))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [tick]);
  return { cat, error, reload: () => setTick((n) => n + 1) };
}

interface Index {
  cat: Catalog;
  bySlug: Map<string, CatalogArtist>;
  byId: Map<string, CatalogTrack>;
  /** each artist's songs in Apple's order */
  songsOf: (slug: string) => CatalogTrack[];
  artistOf: (t: CatalogTrack) => CatalogArtist | undefined;
  withTag: (tag: string) => CatalogArtist[];
}

function buildIndex(cat: Catalog): Index {
  const bySlug = new Map(cat.artists.map((a) => [a.slug, a]));
  const byId = new Map(cat.tracks.map((t) => [t.id, t]));
  const byName = new Map(cat.artists.map((a) => [a.name.toLowerCase(), a]));
  const songs = new Map<string, CatalogTrack[]>();
  for (const t of cat.tracks) {
    // a collaboration is listed once, but belongs on every credited artist's page
    const credited = new Set([t.artistSlug, ...t.artist.split(/\s*(?:,|&|\bfeat\.?|\bx\b)\s*/i).map((n) => byName.get(n.toLowerCase())?.slug)]);
    for (const slug of credited) if (slug) songs.set(slug, [...(songs.get(slug) ?? []), t]);
  }
  for (const list of songs.values()) list.sort((a, b) => (a.popularity.rank ?? 99) - (b.popularity.rank ?? 99));
  return {
    cat,
    bySlug,
    byId,
    songsOf: (slug) => songs.get(slug) ?? [],
    artistOf: (t) => (t.artistSlug ? bySlug.get(t.artistSlug) : undefined) ?? byName.get(t.artist.toLowerCase()),
    withTag: (tag) => cat.artists.filter((a) => a.tags.includes(tag)),
  };
}

/** round-robin across artists so a shelf isn't one artist's songs */
function interleave(lists: CatalogTrack[][], limit: number) {
  const out: CatalogTrack[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => l.length > i); i++) for (const l of lists) if (l[i] && out.length < limit) out.push(l[i]);
  return out;
}

const playable = (t: CatalogTrack) => t.playbackType === 'preview' && !!t.previewUrl;

function playFrom(list: CatalogTrack[], start: CatalogTrack) {
  const ok = list.filter(playable);
  const i = ok.findIndex((t) => t.id === start.id);
  if (i >= 0) playList(ok.map(toTrack), i);
}

// ------------------------------------------------------------------------------- embed dock
const embedStore = { set: (_: CatalogTrack | null) => {} };

function EmbedDock() {
  const [t, setT] = useState<CatalogTrack | null>(null);
  embedStore.set = (x) => {
    // one player at a time: pause Vayro's own playback while Apple's player is open
    if (x && playerStore.getState().status === 'playing') togglePlay();
    setT(x);
  };
  if (!t?.embedUrl) return null;
  return (
    <div className="border-t border-white/10 bg-black/40 px-5 py-3" data-testid="embed-dock">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11.5px] leading-snug text-ink-3">
          <span className="font-medium text-ink-2">Apple Music player</span> (official embed): the full song if you're signed in to Apple Music, otherwise a preview. Its audio stays inside Apple's player, so the lights can't follow it.
        </p>
        <IconButton label="Close the Apple Music player" size="sm" onClick={() => setT(null)}>
          <X size={15} />
        </IconButton>
      </div>
      <iframe
        title={`${t.title} by ${t.artist} on Apple Music`}
        src={t.embedUrl}
        height="175"
        className="w-full rounded-xl"
        allow="autoplay *; encrypted-media *; clipboard-write"
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
      />
    </div>
  );
}

// ------------------------------------------------------------------------------- song row
function Badge({ t }: { t: CatalogTrack }) {
  return playable(t) ? (
    <span
      title="Apple's official 30-second preview plays here and drives the lighting. The full song opens in Apple Music."
      className="whitespace-nowrap rounded-full px-1.5 py-[1px] text-[10px] text-emerald-200/80 ring-1 ring-emerald-300/20"
    >
      {PLAYBACK_LABEL.preview}
    </span>
  ) : (
    <span title="Apple has no preview for this song: it opens in Apple Music" className="whitespace-nowrap rounded-full px-1.5 py-[1px] text-[10px] text-ink-3 ring-1 ring-line">
      {PLAYBACK_LABEL.external}
    </span>
  );
}

function Popover({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton label={label} size="sm" onClick={() => setOpen((o) => !o)} active={open}>
        {icon}
      </IconButton>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-20 min-w-[210px] rounded-xl bg-[#121214] p-1.5 text-[12.5px] shadow-2xl ring-1 ring-white/10">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const menuItem = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-ink-2 hover:bg-white/[0.06] hover:text-ink';

function SongRow({ t, list, index, ix, extra }: { t: CatalogTrack; list: CatalogTrack[]; index?: number; ix: Index | null; extra?: ReactNode }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const fav = useStore(libraryStore, (s) => isFavorite(t.id, s));
  const playlists = useStore(libraryStore, (s) => s.playlists);
  const active = currentId === t.id;
  const artist = ix?.artistOf(t);
  const canPlay = playable(t);
  return (
    <li className={cx('group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 py-1.5 md:grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1fr)_auto]', active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]')}>
      <button
        type="button"
        onClick={() => (canPlay ? playFrom(list, t) : t.appleMusicUrl && window.open(t.appleMusicUrl, '_blank', 'noopener'))}
        aria-label={canPlay ? `Play preview of ${t.title} by ${t.artist}` : `Open ${t.title} in Apple Music`}
        className="relative h-11 w-11 overflow-hidden rounded-[9px] bg-white/[0.05]"
      >
        {t.artwork && <img src={t.artwork.replace('600x600', '200x200')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
        <span className={cx('absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          {active ? <AudioLines size={16} /> : canPlay ? <Play size={15} fill="currentColor" className="ml-0.5" /> : <ExternalLink size={14} />}
        </span>
      </button>
      <div className="min-w-0">
        <p className={cx('truncate text-[13.5px] font-medium', active ? 'text-ink' : 'text-ink/90')}>
          {index !== undefined && <span className="tabular mr-2 font-mono text-[11px] text-ink-4">{String(index + 1).padStart(2, '0')}</span>}
          {t.title}
          {t.explicit && <span className="ml-1.5 rounded-[3px] bg-white/15 px-1 text-[9px] font-bold text-ink-2">E</span>}
        </p>
        <p className="flex min-w-0 items-center gap-2 text-[11.5px] text-ink-3">
          {artist ? (
            <button type="button" onClick={() => openMusic(`artist:${artist.slug}`)} className="truncate hover:text-ink hover:underline">
              {t.artist}
            </button>
          ) : (
            <span className="truncate">{t.artist}</span>
          )}
          <Badge t={t} />
        </p>
      </div>
      <p className="hidden min-w-0 truncate text-[12px] text-ink-3 md:block">
        {t.album}
        {t.year && <span className="text-ink-4"> · {t.year}</span>}
      </p>
      <div className="flex items-center gap-0.5">
        {extra}
        <span className="tabular mr-1 w-9 text-right font-mono text-[11px] text-ink-3">{t.duration ? formatTime(t.duration) : ''}</span>
        <IconButton label={fav ? `Remove ${t.title} from favourites` : `Add ${t.title} to favourites`} size="sm" onClick={() => toggleFavorite(t)} active={fav}>
          <Heart size={14} fill={fav ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton label={`Add ${t.title} to the queue`} size="sm" disabled={!canPlay} onClick={() => enqueue([toTrack(t)])} className="max-sm:hidden">
          <Plus size={15} />
        </IconButton>
        <Popover label={`Add ${t.title} to a playlist`} icon={<ListPlus size={15} />}>
          {(close) => (
            <>
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  const name = window.prompt('Name the new playlist', `${t.artist} mix`);
                  if (name !== null) createPlaylist(name, t);
                  close();
                }}
              >
                <Plus size={13} /> New playlist…
              </button>
              {playlists.map((p) => (
                <button key={p.id} type="button" className={menuItem} onClick={() => (addToPlaylist(p.id, t), close())}>
                  <ListMusic size={13} /> <span className="truncate">{p.name}</span>
                </button>
              ))}
            </>
          )}
        </Popover>
        <Popover label={`Where to listen to ${t.title}`} icon={<MoreHorizontal size={15} />}>
          {(close) => (
            <>
              {t.appleMusicUrl && (
                <a className={menuItem} href={t.appleMusicUrl} target="_blank" rel="noreferrer" onClick={close}>
                  <ExternalLink size={13} /> Full song in Apple Music
                </a>
              )}
              {t.embedUrl && (
                <button type="button" className={menuItem} onClick={() => (embedStore.set(t), close())}>
                  <Music2 size={13} /> Apple Music player here
                </button>
              )}
              <a className={menuItem} href={t.spotifyUrl ?? t.spotifySearchUrl} target="_blank" rel="noreferrer" onClick={close}>
                <ExternalLink size={13} /> {t.spotifyUrl ? 'Open in Spotify' : 'Search on Spotify'}
              </a>
            </>
          )}
        </Popover>
      </div>
    </li>
  );
}

function SongList({ tracks, ix, numbered, extra, limit = 200 }: { tracks: CatalogTrack[]; ix: Index | null; numbered?: boolean; extra?: (t: CatalogTrack) => ReactNode; limit?: number }) {
  const [shown, setShown] = useState(limit);
  return (
    <>
      <ul className="flex flex-col gap-0.5">
        {tracks.slice(0, shown).map((t, i) => (
          <SongRow key={t.id} t={t} list={tracks} index={numbered ? i : undefined} ix={ix} extra={extra?.(t)} />
        ))}
      </ul>
      {tracks.length > shown && (
        <button type="button" onClick={() => setShown((n) => n + limit)} className="mx-auto mt-3 block rounded-full px-4 py-1.5 text-[12px] text-ink-2 ring-1 ring-line hover:text-ink">
          Show {Math.min(limit, tracks.length - shown)} more
        </button>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------- cards
function SongCard({ t, list }: { t: CatalogTrack; list: CatalogTrack[] }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const active = currentId === t.id;
  return (
    <div className="lift group w-[150px] shrink-0">
      <button
        type="button"
        onClick={() => (playable(t) ? playFrom(list, t) : t.appleMusicUrl && window.open(t.appleMusicUrl, '_blank', 'noopener'))}
        aria-label={playable(t) ? `Play preview of ${t.title} by ${t.artist}` : `Open ${t.title} in Apple Music`}
        className="relative block aspect-square w-full overflow-hidden rounded-xl bg-white/[0.05] shadow-[0_10px_24px_-14px_rgb(0_0_0/0.9)] ring-1 ring-white/[0.07] transition-shadow duration-[var(--dur-base)] group-hover:shadow-[0_18px_34px_-16px_rgb(0_0_0/0.95),0_0_0_1px_rgb(255_255_255/0.08)]"
      >
        {t.artwork && <img src={t.artwork.replace('600x600', '300x300')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />}
        <span className={cx('absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-ink text-black shadow-[0_6px_16px_-4px_rgb(0_0_0/0.7)] transition-all duration-[var(--dur-base)] ease-out-soft', active ? 'opacity-100' : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100')}>
          {active ? <AudioLines size={16} /> : playable(t) ? <Play size={15} fill="currentColor" className="ml-0.5" /> : <ExternalLink size={14} />}
        </span>
      </button>
      <p className="mt-2 truncate text-[12.5px] font-medium text-ink">{t.title}</p>
      <p className="truncate text-[11.5px] text-ink-3">{t.artist}</p>
    </div>
  );
}

function ArtistCard({ a, ix }: { a: CatalogArtist; ix: Index }) {
  return (
    <button type="button" onClick={() => openMusic(`artist:${a.slug}`)} className="lift group w-[150px] shrink-0 text-left" aria-label={`Open ${a.name}`}>
      <div className="aspect-square w-full overflow-hidden rounded-full bg-white/[0.05] shadow-[0_10px_24px_-14px_rgb(0_0_0/0.9)] ring-1 ring-white/[0.07]">
        {a.image && <img src={a.image.replace('600x600', '300x300')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />}
      </div>
      <p className="mt-2 truncate text-center text-[12.5px] font-medium text-ink">{a.name}</p>
      <p className="truncate text-center text-[11px] text-ink-3">
        {ix.songsOf(a.slug).length} songs · {a.primaryGenre}
      </p>
    </button>
  );
}

function AlbumCard({ al }: { al: CatalogAlbum }) {
  return (
    <button type="button" onClick={() => openMusic(`album:${al.providerAlbumId}`)} className="lift group w-[150px] shrink-0 text-left" aria-label={`Open the album ${al.title}`}>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-white/[0.05] shadow-[0_10px_24px_-14px_rgb(0_0_0/0.9)] ring-1 ring-white/[0.07]">
        {al.artwork && <img src={al.artwork.replace('600x600', '300x300')} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />}
      </div>
      <p className="mt-2 truncate text-[12.5px] font-medium text-ink">{al.title}</p>
      <p className="truncate text-[11.5px] text-ink-3">
        {al.artist}
        {al.year && ` · ${al.year}`}
      </p>
    </button>
  );
}

function Shelf({ title, note, children, onMore }: { title: string; note?: string; children: ReactNode; onMore?: () => void }) {
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <div>
          <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
          {note && <p className="text-[11.5px] text-ink-3">{note}</p>}
        </div>
        {onMore && (
          <button type="button" onClick={onMore} className="shrink-0 text-[12px] text-ink-3 hover:text-ink">
            See all
          </button>
        )}
      </div>
      <Stagger className="scroll-quiet -mx-1 flex gap-4 overflow-x-auto px-1 pb-3 pt-1">
        {Children.map(children, (c, i) => (
          <StaggerItem index={i}>{c}</StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

function PageTitle({ title, note, children }: { title: string; note?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.035em] text-ink">{title}</h2>
        {note && <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-ink-3">{note}</p>}
      </div>
      {children}
    </div>
  );
}

function PlayAll({ tracks, label = 'Play previews' }: { tracks: CatalogTrack[]; label?: string }) {
  const ok = tracks.filter(playable);
  return (
    <button
      type="button"
      disabled={!ok.length}
      onClick={() => playList(ok.map(toTrack), 0)}
      className="btn-primary h-10 px-5 text-[13px] disabled:opacity-40"
    >
      <Play size={15} fill="currentColor" /> {label}
    </button>
  );
}

const Empty = ({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
    <span className="text-ink-3">{icon}</span>
    <p className="text-[14px] text-ink-2">{title}</p>
    {children && <div className="max-w-[420px] text-[12.5px] leading-relaxed text-ink-3">{children}</div>}
  </div>
);

// ------------------------------------------------------------------------------- pages
function HomePage({ ix }: { ix: Index }) {
  const recent = useStore(libraryStore, (s) => s.recent);
  const shelves = useMemo(() => {
    const top = (tag: string, from: number, to: number) => ix.withTag(tag).map((a) => ix.songsOf(a.slug).filter((t) => t.artistSlug === a.slug && (t.popularity.rank ?? 99) >= from && (t.popularity.rank ?? 99) <= to));
    const newestTop = ix
      .withTag('hip-hop')
      .map((a) => ix.songsOf(a.slug).filter((t) => t.artistSlug === a.slug && (t.popularity.rank ?? 99) <= 5).sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? ''))[0])
      .filter(Boolean)
      .sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? ''));
    return {
      trending: newestTop.slice(0, 18),
      rap: interleave(top('rap', 1, 1), 24),
      alt: interleave(top('alternative', 1, 2), 20),
      rnb: interleave(top('r&b', 1, 3), 20),
      indie: interleave(top('indie', 4, 10), 20),
      intl: interleave(top('international', 1, 2), 20),
      albums: [...ix.cat.albums].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')).slice(0, 18),
    };
  }, [ix]);
  const recentTracks = recent.map((r) => ix.byId.get(r.track.id) ?? r.track).slice(0, 18);
  const lastArtist = recentTracks.map((t) => ix.artistOf(t)).find(Boolean);
  const similar = useMemo(() => {
    if (!lastArtist) return [];
    return ix.cat.artists
      .filter((a) => a.slug !== lastArtist.slug)
      .map((a) => ({ a, score: a.tags.filter((t) => lastArtist.tags.includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 12)
      .map((x) => x.a);
  }, [ix, lastArtist]);
  const hour = new Date().getHours();
  return (
    <div>
      <PageTitle
        title={hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}
        note={`${ix.cat.tracks.length} songs from ${ix.cat.artists.length} artists, all playing in Vayro’s own player (Apple’s 30-second previews, which light the room).`}
      />
      {recentTracks.length > 0 && (
        <Shelf title="Your recently played">{recentTracks.map((t) => <SongCard key={t.id} t={t} list={recentTracks} />)}</Shelf>
      )}
      <Shelf title="Trending Hip-Hop" note="The newest release among each hip-hop artist's top songs" onMore={() => openMusic('genre:hip-hop')}>
        {shelves.trending.map((t) => <SongCard key={t.id} t={t} list={shelves.trending} />)}
      </Shelf>
      <Shelf title="Popular Rap" note="Each rapper's top song in Apple's catalogue" onMore={() => openMusic('genre:rap')}>
        {shelves.rap.map((t) => <SongCard key={t.id} t={t} list={shelves.rap} />)}
      </Shelf>
      <Shelf title="Late Night R&B" note="Top R&B songs" onMore={() => openMusic('genre:r&b')}>
        {shelves.rnb.map((t) => <SongCard key={t.id} t={t} list={shelves.rnb} />)}
      </Shelf>
      <Shelf title="Alternative Essentials" onMore={() => openMusic('genre:alternative')}>
        {shelves.alt.map((t) => <SongCard key={t.id} t={t} list={shelves.alt} />)}
      </Shelf>
      {similar.length > 0 && lastArtist && (
        <Shelf title="Similar artists" note={`Share a genre with ${lastArtist.name}, whom you played recently`}>
          {similar.map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}
        </Shelf>
      )}
      <Shelf title="Indie Discoveries" note="Beyond each indie artist's biggest hits" onMore={() => openMusic('genre:indie')}>
        {shelves.indie.map((t) => <SongCard key={t.id} t={t} list={shelves.indie} />)}
      </Shelf>
      <Shelf title="Popular International Music" note="From artists outside the US" onMore={() => openMusic('genre:international')}>
        {shelves.intl.map((t) => <SongCard key={t.id} t={t} list={shelves.intl} />)}
      </Shelf>
      <Shelf title="New releases" note="Latest albums from artists in your library" onMore={() => openMusic('albums')}>
        {shelves.albums.map((al) => <AlbumCard key={al.id} al={al} />)}
      </Shelf>
      <Shelf title="Artists" onMore={() => openMusic('artists')}>
        {ix.cat.artists.slice(0, 16).map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}
      </Shelf>
    </div>
  );
}

function SongsPage({ ix }: { ix: Index }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'artist' | 'title' | 'newest' | 'oldest'>('artist');
  const [only, setOnly] = useState<'all' | 'preview' | 'external'>('all');
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    let ts = ix.cat.tracks.filter((t) => (only === 'all' || t.playbackType === only) && (!k || `${t.title} ${t.artist} ${t.album} ${t.genre}`.toLowerCase().includes(k)));
    const order = new Map(ix.cat.artists.map((a, i) => [a.slug, i]));
    ts = [...ts].sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title)
        : sort === 'newest' ? (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '')
          : sort === 'oldest' ? (a.releaseDate ?? '').localeCompare(b.releaseDate ?? '')
            : (order.get(a.artistSlug ?? '') ?? 999) - (order.get(b.artistSlug ?? '') ?? 999) || (a.popularity.rank ?? 99) - (b.popularity.rank ?? 99),
    );
    return ts;
  }, [ix, q, sort, only]);
  const sel = 'h-8 cursor-pointer rounded-lg bg-white/[0.04] px-2 text-[12px] text-ink outline-none ring-1 ring-line';
  return (
    <div>
      <PageTitle title="All songs" note={`${list.length} of ${ix.cat.tracks.length} songs`}>
        <PlayAll tracks={list} />
      </PageTitle>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by title, artist, album or genre" aria-label="Filter songs" className="h-8 min-w-[240px] flex-1 rounded-lg bg-white/[0.04] px-3 text-[12.5px] text-ink outline-none ring-1 ring-line placeholder:text-ink-4" />
        <select aria-label="Sort songs" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={sel}>
          <option value="artist" className="bg-panel-solid">Artist</option>
          <option value="title" className="bg-panel-solid">Title</option>
          <option value="newest" className="bg-panel-solid">Newest</option>
          <option value="oldest" className="bg-panel-solid">Oldest</option>
        </select>
        <select aria-label="Playback" value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className={sel}>
          <option value="all" className="bg-panel-solid">All songs</option>
          <option value="preview" className="bg-panel-solid">Previews only</option>
          <option value="external" className="bg-panel-solid">Apple Music only</option>
        </select>
      </div>
      <SongList tracks={list} ix={ix} />
    </div>
  );
}

function ArtistsPage({ ix }: { ix: Index }) {
  const [tag, setTag] = useState('all');
  const list = tag === 'all' ? ix.cat.artists : ix.withTag(tag);
  return (
    <div>
      <PageTitle title="Artists" note={`${ix.cat.artists.length} artists`} />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {[{ id: 'all', name: 'All' }, ...ix.cat.genres].map((g) => (
          <button key={g.id} type="button" aria-pressed={tag === g.id} onClick={() => setTag(g.id)} className={cx('rounded-full px-3 py-1 text-[12px] ring-1', tag === g.id ? 'bg-white/[0.1] text-ink ring-line-2' : 'text-ink-3 ring-line hover:text-ink-2')}>
            {g.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
        {list.map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}
      </div>
    </div>
  );
}

function ArtistPage({ ix, slug, reload }: { ix: Index; slug: string; reload: () => void }) {
  const a = ix.bySlug.get(slug);
  const [busy, setBusy] = useState(false);
  if (!a) return <Empty icon={<Mic2 size={22} />} title="That artist isn't in the library." />;
  const songs = ix.songsOf(slug);
  const albums = ix.cat.albums.filter((x) => x.artistSlug === slug);
  const similar = ix.cat.artists
    .filter((x) => x.slug !== slug)
    .map((x) => ({ x, s: x.tags.filter((t) => a.tags.includes(t)).length }))
    .filter((v) => v.s > 0)
    .sort((p, q) => q.s - p.s)
    .slice(0, 10)
    .map((v) => v.x);
  const themed = ARTIST_BY_SLUG[slug];
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end gap-6">
        <div className="h-[168px] w-[168px] shrink-0 overflow-hidden rounded-full bg-white/[0.05] shadow-2xl ring-1 ring-white/10">
          {a.image && <img src={a.image} alt={`Cover art from ${a.name}`} className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-3">{a.primaryGenre}{a.userAdded ? ' · added by you' : ''}</p>
          <h2 className="text-[clamp(32px,5vw,56px)] font-semibold leading-[1] tracking-[-0.035em] text-ink">{a.name}</h2>
          <p className="mt-2 text-[12.5px] text-ink-3">
            {songs.length} songs · {albums.length} albums
            {a.tags.length > 0 && ' · '}
            {a.tags.map((t, i) => (
              <span key={t}>
                {i > 0 && ', '}
                <button type="button" onClick={() => openMusic(`genre:${t}`)} className="hover:text-ink hover:underline">
                  {ix.cat.genres.find((g) => g.id === t)?.name ?? t}
                </button>
              </span>
            ))}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <PlayAll tracks={songs} />
            {a.appleMusicUrl && (
              <a href={a.appleMusicUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-ink ring-1 ring-white/15 hover:bg-white/[0.06]">
                Apple Music <ExternalLink size={12} className="opacity-60" />
              </a>
            )}
            <a href={a.spotifyUrl ?? `https://open.spotify.com/search/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-ink ring-1 ring-white/15 hover:bg-white/[0.06]">
              {a.spotifyUrl ? 'Spotify' : 'Search Spotify'} <ExternalLink size={12} className="opacity-60" />
            </a>
            {themed && (
              <button type="button" onClick={() => openArtists(slug)} className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-ink ring-1 ring-white/15 hover:bg-white/[0.06]">
                <Sparkles size={13} /> Themed page
              </button>
            )}
            {a.userAdded && (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`Remove ${a.name} from your library? (Their songs in your favourites and playlists stay.)`)) return;
                  setBusy(true);
                  try {
                    await removeArtist(slug);
                    reload();
                    openMusic('artists');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] text-ink-3 ring-1 ring-line hover:text-ink"
              >
                <Trash2 size={13} /> Remove
              </button>
            )}
          </div>
        </div>
      </div>
      <section className="mb-9">
        <h3 className="mb-2 px-1 text-[17px] font-semibold text-ink">Popular songs</h3>
        <p className="mb-3 px-1 text-[11.5px] text-ink-3">
          {songs.some((t) => t.popularity.source === 'listenbrainz')
            ? 'Ordered by ListenBrainz listen counts.'
            : "Ordered by how many of Apple's releases carry each song: hits reappear on albums, deluxe editions, compilations and soundtracks. Apple doesn't publish play counts."}
        </p>
        <SongList tracks={songs} ix={ix} numbered />
      </section>
      {albums.length > 0 && (
        <Shelf title="Albums">
          {albums.map((al) => <AlbumCard key={al.id} al={al} />)}
        </Shelf>
      )}
      {similar.length > 0 && (
        <Shelf title="Similar artists" note="Share genres in this library">
          {similar.map((x) => <ArtistCard key={x.slug} a={x} ix={ix} />)}
        </Shelf>
      )}
      <p className="text-[11px] text-ink-4">The picture is the cover of {a.name}'s latest album: Apple's catalogue has no artist photos.</p>
    </div>
  );
}

const liveAlbums = new Map<number, CatalogAlbum>();

function AlbumsPage({ ix }: { ix: Index }) {
  const [sort, setSort] = useState<'newest' | 'artist'>('newest');
  const list = useMemo(() => {
    const order = new Map(ix.cat.artists.map((a, i) => [a.slug, i]));
    return [...ix.cat.albums].sort((a, b) => (sort === 'newest' ? (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '') : (order.get(a.artistSlug ?? '') ?? 999) - (order.get(b.artistSlug ?? '') ?? 999)));
  }, [ix, sort]);
  return (
    <div>
      <PageTitle title="Albums" note={`${list.length} albums`}>
        <select aria-label="Sort albums" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 cursor-pointer rounded-lg bg-white/[0.04] px-2 text-[12px] text-ink outline-none ring-1 ring-line">
          <option value="newest" className="bg-panel-solid">Newest</option>
          <option value="artist" className="bg-panel-solid">By artist</option>
        </select>
      </PageTitle>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
        {list.map((al) => <AlbumCard key={al.id} al={al} />)}
      </div>
    </div>
  );
}

function AlbumPage({ ix, id }: { ix: Index; id: number }) {
  const al = ix.cat.albums.find((a) => a.providerAlbumId === id) ?? liveAlbums.get(id);
  const [tracks, setTracks] = useState<CatalogTrack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    setTracks(null);
    setError(null);
    fetchAlbumTracks(id, ac.signal)
      .then((ts) => setTracks(ts.map((t) => ({ ...t, artistSlug: ix.artistOf(t)?.slug ?? null }))))
      .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message));
    return () => ac.abort();
  }, [id, ix]);
  const artist = al?.artistSlug ? ix.bySlug.get(al.artistSlug) : undefined;
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end gap-6">
        <div className="h-[200px] w-[200px] shrink-0 overflow-hidden rounded-2xl bg-white/[0.05] shadow-2xl ring-1 ring-white/10">
          {(al?.artwork ?? tracks?.[0]?.artwork) && <img src={al?.artwork ?? tracks?.[0]?.artwork} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-3">Album{al?.year ? ` · ${al.year}` : ''}</p>
          <h2 className="text-[clamp(26px,3.6vw,44px)] font-semibold leading-[1.05] tracking-[-0.03em] text-ink">{al?.title ?? tracks?.[0]?.album ?? 'Album'}</h2>
          {artist ? (
            <button type="button" onClick={() => openMusic(`artist:${artist.slug}`)} className="mt-1 text-[14px] text-ink-2 hover:text-ink hover:underline">
              {al?.artist}
            </button>
          ) : (
            <p className="mt-1 text-[14px] text-ink-2">{al?.artist ?? tracks?.[0]?.artist}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {tracks && <PlayAll tracks={tracks} />}
            {al?.appleMusicUrl && (
              <a href={al.appleMusicUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] font-medium text-ink ring-1 ring-white/15 hover:bg-white/[0.06]">
                Full album in Apple Music <ExternalLink size={12} className="opacity-60" />
              </a>
            )}
          </div>
        </div>
      </div>
      {error && <Empty icon={<AlertTriangle size={22} />} title="Couldn't load the track list.">{error}</Empty>}
      {!tracks && !error && <Loader2 size={20} className="mx-auto mt-10 animate-spin text-ink-3" />}
      {tracks && <SongList tracks={tracks} ix={ix} numbered />}
    </div>
  );
}

function PopularPage({ ix }: { ix: Index }) {
  const [depth, setDepth] = useState(1);
  const list = useMemo(() => interleave(ix.cat.artists.map((a) => ix.songsOf(a.slug).filter((t) => t.artistSlug === a.slug && (t.popularity.rank ?? 99) <= depth)), 600), [ix, depth]);
  return (
    <div>
      <PageTitle
        title="Most popular"
        note="Each artist's top songs, ranked by how many of Apple's releases carry them. Apple doesn't publish play counts, so there's no single chart across artists."
      >
        <div className="flex items-center gap-2">
          <select aria-label="Songs per artist" value={depth} onChange={(e) => setDepth(Number(e.target.value))} className="h-8 cursor-pointer rounded-lg bg-white/[0.04] px-2 text-[12px] text-ink outline-none ring-1 ring-line">
            <option value={1} className="bg-panel-solid">Top song per artist</option>
            <option value={3} className="bg-panel-solid">Top 3 per artist</option>
            <option value={5} className="bg-panel-solid">Top 5 per artist</option>
          </select>
          <PlayAll tracks={list} />
        </div>
      </PageTitle>
      <SongList tracks={list} ix={ix} numbered />
    </div>
  );
}

function RecentPage({ ix }: { ix: Index }) {
  const favs = useStore(libraryStore, (s) => s.favorites);
  const recent = useStore(libraryStore, (s) => s.recent);
  const added = ix.cat.artists.filter((a) => a.userAdded).sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''));
  const favTracks = favs.slice(0, 30).map((f) => ix.byId.get(f.track.id) ?? f.track);
  const played = recent.map((r) => ix.byId.get(r.track.id) ?? r.track);
  return (
    <div>
      <PageTitle title="Recently added" note={`The library was last built ${ix.cat.builtAt ? new Date(ix.cat.builtAt).toLocaleString() : 'not yet'}.`} />
      {added.length > 0 && (
        <Shelf title="Artists you added">
          {added.map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}
        </Shelf>
      )}
      {favTracks.length > 0 && (
        <section className="mb-9">
          <h3 className="mb-3 px-1 text-[17px] font-semibold text-ink">Songs you saved</h3>
          <SongList tracks={favTracks} ix={ix} />
        </section>
      )}
      {played.length > 0 && (
        <section className="mb-9">
          <div className="mb-3 flex items-center justify-between px-1">
            <h3 className="text-[17px] font-semibold text-ink">Played recently</h3>
            <button type="button" onClick={clearHistory} className="text-[12px] text-ink-3 hover:text-ink">
              Clear history
            </button>
          </div>
          <SongList tracks={played} ix={ix} />
        </section>
      )}
      {!added.length && !favTracks.length && !played.length && (
        <Empty icon={<Clock size={22} />} title="Nothing yet">
          Artists you add from Discover, songs you save and songs you play show up here.
        </Empty>
      )}
    </div>
  );
}

function FavoritesPage({ ix }: { ix: Index }) {
  const favs = useStore(libraryStore, (s) => s.favorites);
  const tracks = favs.map((f) => ix.byId.get(f.track.id) ?? f.track);
  return (
    <div>
      <PageTitle title="Favourites" note={`${tracks.length} songs, saved on this device`}>
        <PlayAll tracks={tracks} />
      </PageTitle>
      {tracks.length ? (
        <SongList tracks={tracks} ix={ix} />
      ) : (
        <Empty icon={<Heart size={22} />} title="No favourites yet">
          Tap the heart on any song.
        </Empty>
      )}
    </div>
  );
}

function PlaylistsPage({ ix }: { ix: Index }) {
  const playlists = useStore(libraryStore, (s) => s.playlists);
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const p = createPlaylist(name);
    setName('');
    openMusic(`playlist:${p.id}`);
  };
  return (
    <div>
      <PageTitle title="My playlists" note="Saved on this device" />
      <form onSubmit={submit} className="mb-6 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New playlist name" aria-label="New playlist name" className="h-9 flex-1 rounded-lg bg-white/[0.04] px-3 text-[13px] text-ink outline-none ring-1 ring-line placeholder:text-ink-4" />
        <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-black">
          <Plus size={14} /> Create
        </button>
      </form>
      {playlists.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6">
          {playlists.map((p) => (
            <button key={p.id} type="button" onClick={() => openMusic(`playlist:${p.id}`)} className="group text-left" aria-label={`Open the playlist ${p.name}`}>
              <PlaylistCover p={p} />
              <p className="mt-2 truncate text-[12.5px] font-medium text-ink">{p.name}</p>
              <p className="text-[11.5px] text-ink-3">{p.tracks.length} songs</p>
            </button>
          ))}
        </div>
      ) : (
        <Empty icon={<ListMusic size={22} />} title="No playlists yet">
          Create one here, or use the playlist button on any song.
        </Empty>
      )}
      {ix.cat.tracks.length === 0 && null}
    </div>
  );
}

function PlaylistCover({ p }: { p: Playlist }) {
  const arts = [...new Set(p.tracks.map((t) => t.artwork).filter(Boolean))].slice(0, 4) as string[];
  return (
    <div className="grid aspect-square w-full grid-cols-2 overflow-hidden rounded-xl bg-white/[0.05] ring-1 ring-white/[0.06]">
      {arts.length === 0 && <ListMusic size={28} className="col-span-2 m-auto text-ink-4" />}
      {arts.length > 0 && arts.length < 4 && <img src={arts[0].replace('600x600', '300x300')} alt="" className="col-span-2 row-span-2 h-full w-full object-cover" />}
      {arts.length === 4 && arts.map((a) => <img key={a} src={a.replace('600x600', '200x200')} alt="" className="h-full w-full object-cover" />)}
    </div>
  );
}

function PlaylistPage({ ix, id }: { ix: Index; id: string }) {
  const p = useStore(libraryStore, (s) => s.playlists.find((x) => x.id === id));
  if (!p) return <Empty icon={<ListMusic size={22} />} title="That playlist no longer exists." />;
  const tracks = p.tracks.map((t) => ix.byId.get(t.id) ?? t);
  return (
    <div>
      <PageTitle title={p.name} note={`${tracks.length} songs · updated ${new Date(p.updatedAt).toLocaleDateString()}`}>
        <div className="flex flex-wrap gap-2">
          <PlayAll tracks={tracks} />
          <button type="button" onClick={() => { const n = window.prompt('Rename playlist', p.name); if (n) renamePlaylist(p.id, n); }} className="inline-flex h-10 items-center rounded-full px-4 text-[12.5px] text-ink-2 ring-1 ring-line hover:text-ink">
            Rename
          </button>
          <button type="button" onClick={() => { if (window.confirm(`Delete “${p.name}”?`)) { deletePlaylist(p.id); openMusic('playlists'); } }} className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[12.5px] text-ink-3 ring-1 ring-line hover:text-ink">
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </PageTitle>
      {tracks.length ? (
        <SongList
          tracks={tracks}
          ix={ix}
          numbered
          extra={(t) => (
            <IconButton label={`Remove ${t.title} from ${p.name}`} size="sm" onClick={() => removeFromPlaylist(p.id, t.id)}>
              <X size={14} />
            </IconButton>
          )}
        />
      ) : (
        <Empty icon={<ListPlus size={22} />} title="This playlist is empty">
          Use the playlist button on any song to add it here.
        </Empty>
      )}
    </div>
  );
}

const GENRE_APPLE: Record<string, string[]> = {
  electronic: ['Dance', 'Electronic', 'House', 'Techno'],
  rock: ['Rock', 'Hard Rock'],
  indie: ['Indie Pop', 'Indie Rock'],
};

function GenrePage({ ix, tag }: { ix: Index; tag: string }) {
  const g = ix.cat.genres.find((x) => x.id === tag);
  const artists = ix.withTag(tag);
  const tracks = useMemo(() => {
    const fromArtists = artists.map((a) => ix.songsOf(a.slug).filter((t) => t.artistSlug === a.slug));
    const ids = new Set(fromArtists.flat().map((t) => t.id));
    const byGenre = ix.cat.tracks.filter((t) => !ids.has(t.id) && (GENRE_APPLE[tag] ?? []).includes(t.genre ?? ''));
    return [...interleave(fromArtists, 400), ...byGenre];
  }, [ix, tag, artists]);
  return (
    <div>
      <PageTitle title={g?.name ?? tag} note={`${artists.length} artists · ${tracks.length} songs`}>
        <PlayAll tracks={tracks} />
      </PageTitle>
      {artists.length > 0 && <Shelf title="Artists">{artists.map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}</Shelf>}
      {tracks.length ? <SongList tracks={tracks} ix={ix} /> : <Empty icon={<Disc3 size={22} />} title={`No ${g?.name ?? tag} songs in the library yet`}>Add artists from Discover.</Empty>}
    </div>
  );
}

function DiscoverPage({ ix, reload }: { ix: Index; reload: () => void }) {
  const query = useStore(uiStore, (s) => s.musicQuery);
  const [q, setQ] = useState(query);
  const [live, setLive] = useState<LiveResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  useEffect(() => setQ(query), [query]);
  useEffect(() => {
    const k = query.trim();
    if (!k) return setLive(null);
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    searchLive(k, ac.signal)
      .then(setLive)
      .catch((e) => (e as Error).name !== 'AbortError' && setError((e as Error).message))
      .finally(() => !ac.signal.aborted && setLoading(false));
    return () => ac.abort();
  }, [query]);
  const k = query.trim().toLowerCase();
  const local = useMemo(() => {
    if (!k) return { tracks: [] as CatalogTrack[], artists: [] as CatalogArtist[], genres: [] as { id: string; name: string }[] };
    return {
      tracks: ix.cat.tracks.filter((t) => `${t.title} ${t.artist} ${t.album} ${t.genre}`.toLowerCase().includes(k)).slice(0, 60),
      artists: ix.cat.artists.filter((a) => a.name.toLowerCase().includes(k) || a.tags.some((t) => t.includes(k))).slice(0, 16),
      genres: ix.cat.genres.filter((g) => g.name.toLowerCase().includes(k) || g.id.includes(k)),
    };
  }, [ix, k]);
  const known = useMemo(() => new Set(ix.cat.tracks.map((t) => t.id)), [ix]);
  const liveTracks = (live?.tracks ?? []).filter((t) => !known.has(t.id)).map((t) => ({ ...t, artistSlug: ix.artistOf(t)?.slug ?? null }));
  const inLibrary = (name: string) => ix.cat.artists.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const add = async (name: string) => {
    setAdding(name);
    setAddMsg(null);
    try {
      const r = await addArtist(name);
      reload();
      setAddMsg(r.already ? `${r.artist.name} is already in your library.` : `Added ${r.artist.name}.`);
      openMusic(`artist:${r.artist.slug}`);
    } catch (e) {
      setAddMsg((e as Error).message);
    } finally {
      setAdding(null);
    }
  };
  return (
    <div>
      <PageTitle title="Discover" note="Search Apple's whole catalogue: songs, artists and albums. Add any artist to your library." />
      <form onSubmit={(e) => (e.preventDefault(), openMusic('discover', q))} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artist, song, album or genre" aria-label="Search music" className="h-11 w-full rounded-xl bg-white/[0.05] pl-9 pr-3 text-[14px] text-ink outline-none ring-1 ring-line placeholder:text-ink-4 focus:ring-line-2" />
        </div>
        <button type="submit" className="h-11 rounded-xl bg-ink px-5 text-[13px] font-semibold text-black">
          Search
        </button>
      </form>
      {addMsg && <p className="mb-4 text-[12.5px] text-ink-2">{addMsg}</p>}
      {!k && (
        <>
          <h3 className="mb-3 text-[15px] font-semibold text-ink">Browse by genre</h3>
          <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {ix.cat.genres.map((g, i) => (
              <button key={g.id} type="button" onClick={() => openMusic(`genre:${g.id}`)} className="relative h-20 overflow-hidden rounded-xl p-3 text-left text-[15px] font-semibold text-white ring-1 ring-white/10" style={{ background: `linear-gradient(135deg, hsl(${(i * 41) % 360} 65% 38%), hsl(${(i * 41 + 50) % 360} 70% 22%))` }}>
                {g.name}
                <span className="absolute bottom-2 right-3 text-[11px] font-normal text-white/70">{ix.withTag(g.id).length} artists</span>
              </button>
            ))}
          </div>
        </>
      )}
      {k && (
        <>
          {local.genres.length > 0 && (
            <div className="mb-5 flex flex-wrap gap-2">
              {local.genres.map((g) => (
                <button key={g.id} type="button" onClick={() => openMusic(`genre:${g.id}`)} className="rounded-full px-3 py-1.5 text-[12.5px] text-ink ring-1 ring-line-2 hover:bg-white/[0.05]">
                  {g.name} collection →
                </button>
              ))}
            </div>
          )}
          {local.artists.length > 0 && <Shelf title="Artists in your library">{local.artists.map((a) => <ArtistCard key={a.slug} a={a} ix={ix} />)}</Shelf>}
          {local.tracks.length > 0 && (
            <section className="mb-9">
              <h3 className="mb-3 px-1 text-[17px] font-semibold text-ink">In your library</h3>
              <SongList tracks={local.tracks} ix={ix} limit={20} />
            </section>
          )}
          <section className="mb-9">
            <h3 className="mb-1 px-1 text-[17px] font-semibold text-ink">From Apple's catalogue</h3>
            <p className="mb-3 px-1 text-[11.5px] text-ink-3">Live results, straight from Apple. Add an artist to build and verify their page.</p>
            {loading && <Loader2 size={18} className="ml-2 animate-spin text-ink-3" />}
            {error && <p className="px-1 text-[12.5px] text-red-300/80">{error}</p>}
            {live && live.artists.length > 0 && (
              <div className="mb-5 flex flex-wrap gap-2">
                {live.artists.map((a) => {
                  const lib = inLibrary(a.name);
                  return lib ? (
                    <button key={a.appleId} type="button" onClick={() => openMusic(`artist:${lib.slug}`)} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-ink ring-1 ring-line-2 hover:bg-white/[0.05]">
                      <Mic2 size={13} /> {a.name} <span className="text-ink-3">· in library</span>
                    </button>
                  ) : (
                    <button key={a.appleId} type="button" disabled={!!adding} onClick={() => add(a.name)} className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] text-ink-2 ring-1 ring-line hover:text-ink disabled:opacity-50" aria-label={`Add ${a.name} to the library`}>
                      {adding === a.name ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />} {a.name}
                      {a.genre && <span className="text-ink-4">· {a.genre}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {live && live.albums.length > 0 && (
              <Shelf title="Albums">
                {live.albums.map((al) => {
                  liveAlbums.set(al.providerAlbumId, al);
                  return <AlbumCard key={al.id} al={al} />;
                })}
              </Shelf>
            )}
            {liveTracks.length > 0 && <SongList tracks={liveTracks} ix={ix} limit={20} />}
            {live && !live.tracks.length && !live.artists.length && <p className="px-1 text-[12.5px] text-ink-3">Nothing found for “{query}”.</p>}
          </section>
        </>
      )}
      <AddArtistForm onAdd={add} busy={!!adding} />
    </div>
  );
}

function AddArtistForm({ onAdd, busy }: { onAdd: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
      }}
      className="mt-4 rounded-2xl bg-white/[0.025] p-4 ring-1 ring-line"
    >
      <p className="mb-2 text-[13px] font-medium text-ink">Add an artist to your library</p>
      <p className="mb-3 text-[11.5px] text-ink-3">Their top songs and albums are pulled from Apple's catalogue and checked (artist, artwork, preview, links), the same way as every other artist. Takes about 15 seconds.</p>
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Exact artist name, e.g. Kali Uchis" aria-label="Artist name to add" className="h-9 flex-1 rounded-lg bg-white/[0.04] px-3 text-[13px] text-ink outline-none ring-1 ring-line placeholder:text-ink-4" />
        <button type="submit" disabled={busy || !name.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-black disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Add
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------- shell
const NAV: { route: string; label: string; icon: typeof Home }[] = [
  { route: 'home', label: 'Home', icon: Home },
  { route: 'discover', label: 'Discover', icon: Compass },
  { route: 'songs', label: 'All songs', icon: Music2 },
  { route: 'artists', label: 'Artists', icon: Mic2 },
  { route: 'albums', label: 'Albums', icon: Disc3 },
  { route: 'popular', label: 'Most popular', icon: Flame },
  { route: 'recent', label: 'Recently added', icon: Clock },
  { route: 'favorites', label: 'Favourites', icon: Heart },
  { route: 'playlists', label: 'My playlists', icon: ListMusic },
];

export function LibraryView() {
  const route = useStore(uiStore, (s) => s.music);
  const { cat, error, reload } = useCatalog();
  const ix = useMemo(() => (cat ? buildIndex(cat) : null), [cat]);
  const trail = useRef<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!route) return;
    if (trail.current[trail.current.length - 1] !== route) trail.current.push(route);
    scroller.current?.scrollTo({ top: 0 });
  }, [route]);
  const back = () => {
    trail.current.pop();
    openMusic(trail.current.pop() ?? 'home');
  };
  useEffect(() => {
    if (!route) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target instanceof Element && e.target.closest('input,textarea,[role=menu]')) && closeMusic();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [route]);
  const playlists = useStore(libraryStore, (s) => s.playlists);
  const section = route?.split(':')[0];
  const arg = route?.slice((section?.length ?? 0) + 1) ?? '';

  let page: ReactNode = null;
  if (ix && route) {
    if (section === 'home') page = <HomePage ix={ix} />;
    else if (section === 'discover') page = <DiscoverPage ix={ix} reload={reload} />;
    else if (section === 'songs') page = <SongsPage ix={ix} />;
    else if (section === 'artists') page = <ArtistsPage ix={ix} />;
    else if (section === 'artist') page = <ArtistPage ix={ix} slug={arg} reload={reload} />;
    else if (section === 'albums') page = <AlbumsPage ix={ix} />;
    else if (section === 'album') page = <AlbumPage ix={ix} id={Number(arg)} />;
    else if (section === 'popular') page = <PopularPage ix={ix} />;
    else if (section === 'recent') page = <RecentPage ix={ix} />;
    else if (section === 'favorites') page = <FavoritesPage ix={ix} />;
    else if (section === 'playlists') page = <PlaylistsPage ix={ix} />;
    else if (section === 'playlist') page = <PlaylistPage ix={ix} id={arg} />;
    else if (section === 'genre') page = <GenrePage ix={ix} tag={arg} />;
  }

  return (
    <AnimatePresence>
      {route && (
        <motion.section
          initial={{ opacity: 0, y: 14, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Music library"
          data-testid="music-library"
          className="glass fixed bottom-[164px] left-6 right-6 top-[var(--panel-top)] z-30 flex overflow-hidden rounded-[24px]"
        >
          <HoverLensGroup as="nav" radius={12} aria-label="Library sections" className="scroll-quiet flex w-[210px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-white/[0.06] p-3 max-md:hidden">
            <p className="px-3 pb-2 pt-1 text-[10.5px] font-medium uppercase tracking-[0.22em] text-ink-3">Library</p>
            {NAV.map(({ route: r, label, icon: Icon }) => (
              <button
                key={r}
                type="button"
                aria-current={section === r ? 'page' : undefined}
                onClick={() => openMusic(r)}
                className={cx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors', section === r ? 'liquid-pill text-ink' : 'liquid-hover text-ink-3 hover:text-ink')}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
            <p className="px-3 pb-1.5 pt-5 text-[10.5px] font-medium uppercase tracking-[0.22em] text-ink-3">Genres</p>
            {ix?.cat.genres.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-current={route === `genre:${g.id}` ? 'page' : undefined}
                onClick={() => openMusic(`genre:${g.id}`)}
                className={cx('rounded-lg px-3 py-1.5 text-left text-[12.5px] transition-colors', route === `genre:${g.id}` ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:bg-white/[0.04] hover:text-ink-2')}
              >
                {g.name}
              </button>
            ))}
            {playlists.length > 0 && (
              <>
                <p className="px-3 pb-1.5 pt-5 text-[10.5px] font-medium uppercase tracking-[0.22em] text-ink-3">Playlists</p>
                {playlists.map((p) => (
                  <button key={p.id} type="button" onClick={() => openMusic(`playlist:${p.id}`)} className={cx('truncate rounded-lg px-3 py-1.5 text-left text-[12.5px]', route === `playlist:${p.id}` ? 'bg-white/[0.08] text-ink' : 'text-ink-3 hover:bg-white/[0.04] hover:text-ink-2')}>
                    {p.name}
                  </button>
                ))}
              </>
            )}
          </HoverLensGroup>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3">
              <IconButton label="Back" size="sm" onClick={back} disabled={trail.current.length < 2}>
                <ArrowLeft size={15} />
              </IconButton>
              <form onSubmit={(e) => (e.preventDefault(), q.trim() && openMusic('discover', q.trim()))} className="relative max-w-[460px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs, artists, albums, genres" aria-label="Search the library" data-search-input className="h-9 w-full rounded-full bg-white/[0.05] pl-9 pr-3 text-[13px] text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.35)] outline-none ring-1 ring-line transition-[box-shadow,background-color] duration-[var(--dur-base)] placeholder:text-ink-4 focus:bg-white/[0.07] focus:ring-[color-mix(in_srgb,var(--glow-p)_45%,transparent)]" />
              </form>
              <div className="flex-1" />
              <IconButton label="Close library (Esc)" onClick={closeMusic}>
                <X size={17} />
              </IconButton>
            </div>
            <div ref={scroller} data-scroll-main className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-6 py-6 max-sm:px-4">
              {error && (
                <Empty icon={<AlertTriangle size={22} />} title="The library couldn't load">
                  {error}
                </Empty>
              )}
              {!ix && !error && <Loader2 size={20} className="mx-auto mt-16 animate-spin text-ink-3" />}
              {ix && ix.cat.tracks.length === 0 && (
                <Empty icon={<Music2 size={22} />} title="The catalogue hasn't been built yet">
                  Run <code className="text-ink-2">npm run catalog:build</code> once (it takes about 15 minutes), then reopen the library.
                </Empty>
              )}
              {ix && ix.cat.tracks.length > 0 && <PageTransition id={route ?? ""}>{page}</PageTransition>}
            </div>
            <EmbedDock />
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
