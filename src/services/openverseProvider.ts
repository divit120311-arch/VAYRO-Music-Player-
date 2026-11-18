import { searchCatalog, type MusicProvider } from './musicProvider';

/**
 * Openverse — the open-license media search engine (WordPress.org).
 * Anonymous access, no key. Indexes CC-licensed music from Jamendo, Wikimedia, Freesound…
 */
export const openverseProvider: MusicProvider = {
  id: 'openverse',
  name: 'Openverse',
  description: 'Openly licensed music indexed from Jamendo, Wikimedia Commons and more. No account needed.',
  homepage: 'https://openverse.org',
  search: (params, signal) => searchCatalog('openverse', params, signal),
};
