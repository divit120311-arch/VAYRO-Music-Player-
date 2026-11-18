import { createStore } from '../store';
import { playerStore, currentTrack, notify } from './player';
import { fromTrack, type CatalogTrack } from '../services/libraryCatalog';

/**
 * The listener's own library, kept on this device: favourites, playlists and what they've played.
 * Songs are stored as catalogue records (metadata + official links + preview URL), never as audio.
 * Uploaded files can't be kept across sessions (the browser only lends them while the page is
 * open), so favourites and playlists hold catalogue songs.
 */
export interface Playlist {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tracks: CatalogTrack[];
}

interface LibraryState {
  favorites: { track: CatalogTrack; addedAt: string }[];
  playlists: Playlist[];
  recent: { track: CatalogTrack; playedAt: string }[];
}

const KEY = 'afterglow:library:v1';
const BACKUP_KEY = 'afterglow:library:v1:backup';

function load(): LibraryState {
  const empty: LibraryState = { favorites: [], playlists: [], recent: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw);
    return { favorites: v.favorites ?? [], playlists: v.playlists ?? [], recent: v.recent ?? [] };
  } catch {
    // never throw away a library we can't read: keep a copy before starting fresh
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
    } catch { /* storage unavailable */ }
    return empty;
  }
}

export const libraryStore = createStore<LibraryState>(load());

let saveTimer: ReturnType<typeof setTimeout> | undefined;
libraryStore.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 150);
});
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(libraryStore.getState()));
  } catch {
    notify('Couldn’t save your library on this device (storage is full or blocked).', 'error');
  }
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', save);

const now = () => new Date().toISOString();
const slim = (t: CatalogTrack): CatalogTrack => ({ ...t, verification: { ...t.verification, checks: {} } });

// ---------------------------------------------------------------------------- favourites
export const isFavorite = (id: string, s = libraryStore.getState()) => s.favorites.some((f) => f.track.id === id);
export function toggleFavorite(t: CatalogTrack) {
  libraryStore.setState((s) =>
    isFavorite(t.id, s) ? { favorites: s.favorites.filter((f) => f.track.id !== t.id) } : { favorites: [{ track: slim(t), addedAt: now() }, ...s.favorites] },
  );
}

// ---------------------------------------------------------------------------- playlists
export function createPlaylist(name: string, first?: CatalogTrack) {
  const p: Playlist = { id: `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 60) || 'New playlist', createdAt: now(), updatedAt: now(), tracks: first ? [slim(first)] : [] };
  libraryStore.setState((s) => ({ playlists: [p, ...s.playlists] }));
  return p;
}
export function renamePlaylist(id: string, name: string) {
  libraryStore.setState((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 60) || p.name, updatedAt: now() } : p)) }));
}
export function deletePlaylist(id: string) {
  libraryStore.setState((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
}
export function addToPlaylist(id: string, t: CatalogTrack) {
  let added = false;
  libraryStore.setState((s) => ({
    playlists: s.playlists.map((p) => {
      if (p.id !== id || p.tracks.some((x) => x.id === t.id)) return p;
      added = true;
      return { ...p, tracks: [...p.tracks, slim(t)], updatedAt: now() };
    }),
  }));
  return added;
}
export function removeFromPlaylist(id: string, trackId: string) {
  libraryStore.setState((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((x) => x.id !== trackId), updatedAt: now() } : p)) }));
}

// ---------------------------------------------------------------------------- history
/** remembers catalogue songs as they play (most recent first, one entry per song) */
let lastId: string | null = null;
playerStore.subscribe(() => {
  const s = playerStore.getState();
  const t = currentTrack(s);
  if (!t || t.id === lastId || s.status !== 'playing') return;
  lastId = t.id;
  const rec = fromTrack(t);
  if (!rec) return;
  // keep the richer catalogue record if we already know this song
  const known = libraryStore.getState().favorites.find((f) => f.track.id === rec.id)?.track;
  libraryStore.setState((st) => ({ recent: [{ track: known ?? rec, playedAt: now() }, ...st.recent.filter((r) => r.track.id !== rec.id)].slice(0, 60) }));
});

export function clearHistory() {
  libraryStore.setState({ recent: [] });
}
