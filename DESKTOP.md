# Vayro: website and macOS app

| | How people use Vayro | Sync lyrics |
|---|---|---|
| **Windows, Linux, any browser** | The website (deployed on Vercel). No download. | Time-synced lyrics for every song played in Vayro. |
| **Mac** | The website, or the **Vayro app for Mac** | The app also follows the **Spotify app** on that Mac and shows its lyrics in time. |
| **Your own computer, `npm run dev`** | `http://localhost:5173` | Also follows the Spotify app on that computer (Windows or Mac). |

A web page can't see a visitor's other apps; browsers don't allow it. So following the Spotify
app needs Vayro running on that same computer. On a hosted website, **Sync lyrics** shows synced
lyrics for the song playing in Vayro, or opens the Library to pick one.

## The website on Vercel

`vercel.json` builds the site (`npm run build` → `dist/`) and runs Vayro's server code as **one
serverless function** (`api/handler.mjs` → `server/index.mjs`). Every `/api/…` request goes there:
library, lyrics (LRCLIB), artists, audio proxy and settings. The site works from any browser.

- Speech recognition, which lines up lyrics with 30-second previews, runs **in the visitor's
  browser** on the website. Its model is far too large for a serverless function, and the
  function reports that (`/api/health` → `transcribe: false`).
- The install step skips the optional NVIDIA CUDA download from onnxruntime-node (it 404s and
  nothing here needs it) and the Electron download.
- Artists added from Discover on the website are stored in the function's temporary folder, so
  they aren't permanent. The built-in library of 60 artists always is.
- `.github/workflows/web.yml` runs the tests and the production build on every push to `main`.

## The macOS app

The app is the website plus its server in one Mac app (Electron). Because it runs on the
listener's own Mac, **Sync lyrics** can follow their Spotify app. There's nothing else to install.

### Building it (no Mac needed)

GitHub builds it on its Mac machines (`.github/workflows/desktop.yml`, named "macOS app"):

- **Test build:** open **Actions → macOS app → Run workflow**. After about 15 minutes, download
  `vayro-mac-apple-silicon` and `vayro-mac-intel` from the run's **Artifacts**.
- **Release** (powers the site's **Download for Mac** button): push a version tag. In GitHub
  Desktop, go to **History**, right-click the newest commit → **Create Tag…** → `v1.0.2` →
  **Push origin**. The workflow builds both `.dmg` files and attaches them to a GitHub Release:
  `Vayro-mac-apple-silicon.dmg` (M1/M2/M3/M4…) and `Vayro-mac-intel.dmg`.
- Pushing to `main` doesn't build the app. Only tags and manual runs do.
- **Locally on a Mac:** `npm install`, then `npm run dist:mac`. The output goes to `release/`.

**Visitors can only download Release files from a public repository.** Either make this repository
public, or publish to a separate public one:

1. Create a public repository such as `vayro-releases`, with a README so it isn't empty.
2. Create a fine-grained GitHub token with **Contents: Read and write** on that repository.
3. In this repository, under Settings → Secrets and variables → Actions:
   - add the variable `RELEASES_REPO` = `your-name/vayro-releases`;
   - add the secret `RELEASES_TOKEN` = the token.
4. In `src/config/downloads.ts`, set `GITHUB_RELEASES` to that repository.

The **Download for Mac** button appears only on Macs. If no Release is published yet, it says so.

### What Mac users see the first time

They open the `.dmg` and drag Vayro to Applications. The first time they open it, macOS says it
can't verify the developer. They go to **System Settings → Privacy & Security**, scroll down, and
click **Open Anyway**. They only do this once. The first time they click **Sync lyrics**, macOS
asks whether Vayro may control Spotify. They click **OK**.

### The app in detail

- **Window:** native traffic-light buttons inside Vayro's header (drag the header to move the
  window). Full screen hides them and the header moves back. Size and position are remembered.
- **Menu:** Vayro (Settings… ⌘, · Hide · Quit ⌘Q), Edit, View (Search ⌘F · Library ⌘L · Full
  Screen), Playback (Play/Pause · Next ⌘→ · Previous ⌘←), Window.
- **Spotify:** read through the Spotify (or Music) app's scripting interface
  (`server/nowplaying/mac.mjs`).
- **Server:** `electron/main.cjs` starts `server/index.mjs` on `127.0.0.1:47821`. Only that Mac can
  reach it, so there's no firewall prompt.
- **Permissions:** the page may request full screen and nothing else. The only macOS prompt is the
  one-time "control Spotify" request.
- **Data:** writable data (lyric timings, the speech model downloaded on first use) goes to
  `~/Library/Application Support/Vayro`.
- **Builds:** Apple Silicon (arm64) and Intel (x64) are separate `.dmg` files. A universal build
  isn't used, because the speech-recognition library ships separate native files per chip.

### Signing and notarization (for public distribution)

The automatic builds are ad-hoc signed. They run after a one-time **Open Anyway**, but they are
not ready for public distribution. To remove the warning:

1. Join the Apple Developer Program ($99 a year) and create a **Developer ID Application**
   certificate.
2. Add these to the repository's Actions secrets:
   - `CSC_LINK` (the exported `.p12`, base64) and `CSC_KEY_PASSWORD`;
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.
3. In `package.json → build.mac`, remove `"identity": "-"` and add `"notarize": true`. In the
   workflow, drop `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and pass the secrets as environment
   variables.

electron-builder then signs with your Developer ID, notarizes with Apple, and staples the ticket.
Gatekeeper opens the app with no warning.
