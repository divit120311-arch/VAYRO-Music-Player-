# Vayro: a browser app

Vayro is a **browser-only** music player for Windows, macOS and everything else, hosted on Vercel.
There are no desktop installers and no desktop release workflow.

## How it's deployed

- `vercel.json` builds the site (`npm run build` → `dist/`) and runs Vayro's server code as **one
  serverless function** (`api/handler.mjs` → `server/index.mjs`). Every `/api/…` request goes there:
  library, lyrics (LRCLIB), artists, audio proxy and settings.
- Speech recognition, which lines up lyrics with 30-second previews, runs **in the visitor's
  browser** on the website (`/api/health` → `transcribe: false`).
- The install step skips onnxruntime-node's optional CUDA download and the Electron download.
- Artists added from Discover on the website are stored in the function's temporary folder, so
  they aren't permanent. The built-in library always is.

## Checks

`.github/workflows/web.yml` ("Web app") runs on every push and pull request to `main`: `npm ci`,
`npm test`, `npm run build`, and a check that the API handler loads. It is the only workflow.

## Sync lyrics

A web page can't see a visitor's other apps (browsers don't allow it), so on the website **Sync
lyrics** shows time-synced lyrics for the song playing in Vayro, or opens the Library to pick one.
Following the Spotify app only works when Vayro's server runs on the same computer, i.e. during
development at `http://localhost:5173` (`npm run dev`).

## Desktop code (not shipped)

The Electron shell (`electron/`, the `build` section of `package.json`, `npm run dist:*` scripts) is
still in the code base for a possible future desktop app, but nothing builds or publishes it.
Earlier desktop releases' workflow is in the git history (`.github/workflows/desktop.yml`).
