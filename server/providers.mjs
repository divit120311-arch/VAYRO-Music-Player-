// Full-length playback providers — server side.
//   GET /api/config   what the browser may use (public values only)
// Spotify uses OAuth with PKCE in the browser: only the public client ID is shared here, there is
// no secret to expose.

const sClient = () => process.env.SPOTIFY_CLIENT_ID?.trim() || '';

/** @returns {Promise<boolean>} */
export async function handleProviders(req, res, pathname, sp, sendJson) {
  if (pathname === '/api/config') {
    sendJson(res, 200, { spotifyClientId: sClient() || null });
    return true;
  }
  return false;
}
