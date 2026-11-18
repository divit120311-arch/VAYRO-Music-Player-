/**
 * Where the desktop app downloads come from: the latest GitHub Release of this repository.
 * The "Desktop app" workflow (.github/workflows/desktop.yml) builds the installers and attaches them
 * to a Release with exactly these file names whenever a version tag (v1.0.1, …) is pushed.
 *
 * Visitors can only download Release files from a PUBLIC repository. For a private code repository,
 * point GITHUB_RELEASES at a separate public repository that only holds the releases (see DESKTOP.md).
 */
export const GITHUB_RELEASES = { owner: 'divit120311-arch', repo: 'VAYRO-Music-Player-' };

/** Vayro's desktop app is for Mac only; on Windows (and everywhere else) Vayro runs in the browser */
export const APP_FILES = {
  appleSilicon: 'Vayro-mac-apple-silicon.dmg',
  intel: 'Vayro-mac-intel.dmg',
} as const;
export type AppBuild = keyof typeof APP_FILES;

/** a Mac (not an iPhone / iPad): the only computers the desktop app is for */
export const IS_MAC =
  typeof navigator !== 'undefined' &&
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform === 'macOS' ||
    (/Macintosh|Mac OS X/.test(navigator.userAgent) && !/iPhone|iPad|iPod/.test(navigator.userAgent) && navigator.maxTouchPoints < 2));

/** true inside the Vayro desktop app (no point offering the download there) */
export const IN_DESKTOP_APP = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

/**
 * Can "Sync lyrics" follow the Spotify app from here? Only when Vayro's server runs on this same
 * computer: the desktop app, or the site opened from localhost. A website on the internet can't see
 * the apps on a visitor's computer — browsers don't allow it.
 */
export const CAN_FOLLOW_SPOTIFY =
  IN_DESKTOP_APP || (typeof location !== 'undefined' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
