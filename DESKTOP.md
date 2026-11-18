# Vayro desktop app (Mac + Windows)

The desktop app is the site plus its server in one app. Because it runs on the listener's own
computer, **Sync lyrics** can see their Spotify app: open Vayro → play a song in Spotify →
click **Sync lyrics**. No Node.js, no terminal.

## Building the installers (no Mac needed)

Mac apps can only be packaged on a Mac, so GitHub builds them on its Mac machines for free:

1. Create a free GitHub account, make a new **private** repository, and upload this project
   folder to it (GitHub Desktop is the easiest way). `.gitignore` already leaves out
   `node_modules`, `dist`, `release`, videos and backups.
2. In the repository, open **Actions → Desktop app → Run workflow**.
3. After about 10–15 minutes, open the finished run and download from **Artifacts**:
   - `vayro-mac-apple-silicon`: `Vayro-x.y.z-arm64.dmg` (M1/M2/M3/M4 Macs)
   - `vayro-mac-intel`: `Vayro-x.y.z.dmg` (older Intel Macs)
   - `vayro-windows`: `Vayro Setup x.y.z.exe`
4. Put those files on your site as downloads.

On a Mac you can also build locally: `npm install`, then `npm run dist:mac`. The output goes
to `release/`.

## What listeners see the first time

**Mac:** open the `.dmg` and drag Vayro to Applications. The first time they open it,
macOS says it can't verify the developer. They go to **System Settings → Privacy & Security**,
scroll down, and click **Open Anyway**. They only do this once. The first time they click
**Sync lyrics**, macOS asks whether Vayro may control Spotify. They click **OK**.

**Windows:** run the installer. Windows SmartScreen may show "Windows protected your PC". They
click **More info → Run anyway**. On PCs with **Smart App Control** turned on, Windows blocks
unsigned apps completely and there is no button to allow it.

Both warnings disappear with code signing:

- **Mac:** an Apple Developer account ($99 a year). Add the certificate to the build and turn on
  notarization.
- **Windows:** a code-signing certificate from a certificate provider.

## How it works

- `electron/main.cjs` starts `server/index.mjs` on `127.0.0.1:47821`. Only that computer can
  reach it, so there's no firewall prompt. It then opens the site in a window.
- Spotify sync uses the Windows media session (`server/nowplaying/smtc.ps1`) or, on macOS, the
  Spotify / Music apps' scripting interface (`server/nowplaying/mac.mjs`).
- Writable data (lyric timings, the speech model downloaded on first use) goes to the app's
  data folder. On Windows that's `%APPDATA%\Vayro`; on Mac,
  `~/Library/Application Support/Vayro`.

## The Mac app, in detail

- **Window:** native traffic-light buttons inside Vayro's header (drag the header to move the
  window). Full screen hides them and the header moves back. Size and position are remembered.
- **Menu:** Vayro (Settings… ⌘, · Hide · Quit ⌘Q), Edit, View (Search ⌘F · Library ⌘L · Full
  Screen), Playback (Play/Pause · Next ⌘→ · Previous ⌘←), Window. Space plays and pauses, except
  while typing in a field.
- **Media keys and Control Center:** Vayro publishes the song (title, artist, artwork) through the
  browser's Media Session. Inside the Mac app, Chromium passes that to macOS Now Playing and the
  media keys. This only applies to songs playing in Vayro itself. When you follow the Spotify app,
  Spotify owns those controls.
- **Permissions:** the page may request full screen and nothing else. No microphone, camera or
  notifications. The only macOS prompt is the one-time "control Spotify" request for Sync lyrics.
- **Builds:** Apple Silicon (arm64) and Intel (x64) are separate `.dmg` files. A universal build
  isn't used, because the speech-recognition library ships separate native files per chip.

## Signing and notarization (for public distribution)

The automatic builds are ad-hoc signed. They run after a one-time **Open Anyway**, but they are
not ready for public distribution. To remove the warning:

1. Join the Apple Developer Program ($99 a year) and create a **Developer ID Application**
   certificate.
2. Add these to the GitHub repository's secrets:
   - `CSC_LINK` (the exported `.p12`, base64) and `CSC_KEY_PASSWORD`;
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, for notarization.
3. In `package.json → build.mac`, remove `"identity": "-"` and add `"notarize": true`. In the
   workflow, drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and pass the secrets as environment
   variables.

electron-builder then signs with your Developer ID, notarizes with Apple, and staples the ticket.
Gatekeeper opens the app with no warning.
