import { createStore } from '../store';

export type LibraryTab = 'link' | 'files' | 'queue';

/**
 * music: the music library screen. null = closed; otherwise a route:
 *   home · discover · songs · artists · artist:<slug> · albums · album:<appleId> · popular · recent ·
 *   favorites · playlists · playlist:<id> · genre:<tag>
 */
export const uiStore = createStore<{ library: LibraryTab | null; settings: boolean; artists: string | null; music: string | null; musicQuery: string; guide: boolean }>({
  guide: false,
  library: null,
  settings: false,
  artists: null,
  music: null,
  musicQuery: '',
});

/** artists: null = closed, 'index' = all artists, otherwise an artist slug (the four themed pages) */
export function openArtists(slug: string = 'index') {
  uiStore.setState({ artists: slug, library: null, settings: false, music: null, guide: false });
}
export function closeArtists() {
  uiStore.setState({ artists: null });
}

export function openMusic(route = 'home', query?: string) {
  uiStore.setState((s) => ({ music: route, musicQuery: query ?? s.musicQuery, library: null, settings: false, artists: null, guide: false }));
}
export function closeMusic() {
  uiStore.setState({ music: null });
}
export function toggleMusic() {
  if (uiStore.getState().music) closeMusic();
  else openMusic('home');
}

export function openLibrary(tab: LibraryTab) {
  uiStore.setState({ library: tab, settings: false, artists: null, music: null, guide: false });
}
export function toggleLibrary(tab: LibraryTab = 'link') {
  const cur = uiStore.getState().library;
  uiStore.setState({ library: cur ? null : tab, settings: false, artists: null, music: null, guide: false });
}
export function closeLibrary() {
  uiStore.setState({ library: null });
}
export function toggleSettings() {
  uiStore.setState((s) => ({ settings: !s.settings, library: null, artists: null, music: null, guide: false }));
}
export function closeSettings() {
  uiStore.setState({ settings: false });
}
export function closePanels() {
  uiStore.setState({ settings: false, library: null, artists: null, music: null, guide: false });
}

/** the "viral lyric video" how-to */
export function openGuide() {
  uiStore.setState({ guide: true, settings: false, library: null, artists: null, music: null });
}
export function closeGuide() {
  uiStore.setState({ guide: false });
}
