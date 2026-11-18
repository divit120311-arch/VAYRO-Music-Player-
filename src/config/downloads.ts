/**
 * Where the desktop app downloads live. Put the files the GitHub build produces (see DESKTOP.md)
 * at these paths — e.g. in /public/downloads/ — or change these to full URLs (a GitHub Release,
 * a file host…).
 */
export const MAC_DOWNLOADS = {
  appleSilicon: '/downloads/Vayro-mac-apple-silicon.dmg',
  intel: '/downloads/Vayro-mac-intel.dmg',
};

/** true inside the Vayro desktop app (no point offering the download there) */
export const IN_DESKTOP_APP = typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);
