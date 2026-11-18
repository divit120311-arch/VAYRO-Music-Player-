import { searchCatalog, type MusicProvider } from './musicProvider';

/**
 * Jamendo — independent, Creative-Commons music.
 * The client ID lives in server/.env; the browser only talks to /api/catalog/jamendo.
 */
export const jamendoProvider: MusicProvider = {
  id: 'jamendo',
  name: 'Jamendo',
  description: '600k+ Creative Commons tracks from independent artists. Requires a free developer client ID on the server.',
  homepage: 'https://www.jamendo.com',
  search: (params, signal) => searchCatalog('jamendo', params, signal),
};
