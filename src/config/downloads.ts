/**
 * Vayro is a browser app (the website on Vercel) for Windows, macOS and everything else. No desktop
 * installers are offered.
 */

/** true when running inside the Electron shell (electron/main.cjs, kept in the code base but not shipped) */
export const IN_DESKTOP_APP = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

/**
 * Can "Sync lyrics" follow the Spotify app from here? Only when Vayro's server runs on this same
 * computer: the site opened from localhost (`npm run dev`). A website on the internet can't see the
 * apps on a visitor's computer — browsers don't allow it — so on the website, Sync lyrics shows
 * synced lyrics for the songs played in Vayro.
 */
export const CAN_FOLLOW_SPOTIFY =
  IN_DESKTOP_APP || (typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
