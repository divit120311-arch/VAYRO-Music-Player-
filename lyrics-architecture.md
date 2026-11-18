# Afterglow Lyrics: Architecture

## 1. Where lyrics come from (fastest exact source first)

| # | Source | Typical time | Notes |
|---|---|---|---|
| 1 | **Saved for this song** (`localStorage`, keyed by artist + title) | < 0.3 s | Includes your own LRC, versions picked in the search dialog, and finished transcriptions |
| 2 | Demo sample lines | instant | Original lines written for Afterglow |
| 3 | **Inside the file**: ID3 `SYLT`/`USLT`, or `Song.lrc` dropped with `Song.mp3` | instant | |
| 4 | **LRCLIB** synced lyrics (via the local server) | 0.6–1.3 s | Works for untagged files too: the cleaned filename plus the song's duration picks the right version |
| 5 | **On-device transcription** (local server, then the browser as fallback) | about 0.27× the song length | Only for your own uploaded files, and only when 1–4 find nothing synced |
| 6 | Unsynced text | | Labelled "Not time-synced" |
| 7 | "No lyrics found" | | Buttons to search LRCLIB, add an LRC, or transcribe |

**Search lyrics:** a dialog that lists LRCLIB versions with length match, sync type, script and first lines. The version you pick is saved for that song.

**Script preference:** a setting for Best match, Roman (Hinglish) or Native script (Devanagari). LRCLIB holds both for many Hindi songs.

## 2. The clock: one source of time
- Every style reads **one clock:** `audioElement.currentTime + per-song offset`, sampled on the lighting engine's single `requestAnimationFrame` loop. There is no `setInterval` and no separate animation timeline.
- **When React re-renders:** only when the active line or word index changes. Per-frame effects write straight to the DOM: the karaoke fill, the constellation drift, the glow level.
- **What follows from that:**
  - Pausing freezes progression.
  - Seeking updates on the next frame (57–211 ms measured, depending on machine load).
  - Changing track loads the new lyrics.
- **Word timing is never invented for karaoke.** With line timing only, karaoke lights the whole line, and the toolbar says "word timing estimated" wherever a style steps through words.

## 3. Typography composition engine (`src/components/lyrics/LyricsDisplay.tsx`)

**Shared theme:** CSS variables set once on the lyrics root.

| Variable | Controls |
|---|---|
| `--ly-hl`, `--ly-hl2` | highlight colours: the light's colours, or your choice |
| `--ly-text` | text colour, tinted by the light (the "Text takes the light colour" setting, under More settings) |
| `--ly-w` | weight |
| `--ly-lh` | line spacing |
| `--ly-glow` | glow |
| `--ly-art-shadow` | readability shadow when album art is behind the lyrics |

**Emphasis:** restrained and deterministic.
- Function words are small: English, Roman Hindi and Devanagari lists (the, to, का, की, से, में, hai…).
- Other words grow with their length, counted in visible characters, so Devanagari vowel signs don't inflate it.
- No meaning is guessed.

**Styles:**

| Group | Style | Reference |
|---|---|---|
| Reference | **Reel** (black / over art / in a ring) | V2, V6 / V3 / V4 |
| Reference | **Stack** | V1 |
| Reference | **Constellation** (SVG lines + positioned labels) | V5 |
| Line | Cinematic fade, Vertical scroll, Blur focus, Minimal, Ambient glow | |
| Word | Karaoke, Word reveal, Typewriter | |

**Motion budget:**
- Reel and Stack scale each step to the time until the next word, so fast vocals snap and slow ones glide.
- Reel steps take 0.15 s and smear into 3 blurred ghost copies (the reel a few ms earlier), all computed from playback time; words are GPU layers only while moving. Stack smears use `scaleY`.
- The constellation drift follows playback time, so it stops when paused.

**Looks:** six presets, one per reference video. Each sets lighting, lyric style, album art (off / blurred / clear), clock, notch and text tint. They switch while music plays and are previewed in settings.

## 4. Bilingual text
- **Fonts:** Nunito for Latin; **Noto Sans Devanagari** (variable) for Devanagari. Both are bundled, open licence.
- **Shaping and tokenization:** the browser shapes the text. Words are split on whitespace only, so matras and conjuncts stay together.
- **Roman Hindi toggle** (`src/utils/translit.ts`):
  - Display-only transliteration, never translation.
  - Silent-"a" deletion, right to left (दिल → dil, तुझसे → tujhse).
  - Common Hinglish spelling (कोई → koi, में → mein).
  - Word timings are kept.
- **Transcription language:** you can force it, e.g. Hindi (Whisper's auto-detect often labels Hindi as Urdu), and choose the Fast (base) or Accurate (small) model.

## 5. Transcription pipeline

```
browser                                         local server (server/asr/)
───────                                         ──────────────────────────
fetch file bytes → SHA-256 ── GET /api/transcribe/cache ─▶ disk cache hit? → done (≈50–150 ms)
decode (Web Audio, 16 kHz mono, high-pass)
int16 PCM ─────────────────── POST /api/transcribe ──────▶ job (hash, model, language)
                                                           · joins an existing job (dedupe)
                                                           · resumes finished sections from disk
                                                           · 20–25 s sections cut at quiet points,
                                                             the one being listened to first,
                                                             silent ones skipped
                                                           · worker thread: Whisper (onnxruntime-node,
                                                             native, 8-bit) → words + timestamps
poll every 0.5 s ◀──────────── GET /api/transcribe/:id ──── words so far (each section as it finishes)
clean (hallucinations, loops, stretched starts) → enhanced LRC → display immediately
finish → save LRC for the song (localStorage); server keeps its JSON cache
```

- **Priority:** the playing track is priority 0. **Prefetch** of the next queued upload is priority 1, and only runs when that track has no saved, embedded or LRCLIB lyrics. The whole library is never processed.
- **Cancel:** changing track cancels the job, but finished sections stay on disk, so playing it again resumes.
- **Fallback:** if the server isn't running, the same model runs in a Web Worker (WebAssembly, single thread, slower).
- **CPU sharing:** while a job runs, the lighting renders at 30 fps ("Ease the light while writing", on by default).
- **Security:** `/api/transcribe` accepts requests from this computer only (loopback). Audio is never uploaded anywhere else.
- **Diagnostics:** Settings → More settings → Lyric sources → Timings shows the measured engine, model, cache check, decode, upload, model init, first lyrics, recognition, total and RTF.

## 6. Files

| Path | Purpose |
|---|---|
| `server/asr/index.mjs` | job manager, cache, dedupe, priority, resume, HTTP routes |
| `server/asr/worker.mjs` | Whisper worker thread |
| `src/services/transcriber.ts` | client: server engine, browser fallback, prefetch, cleaning, LRC |
| `src/workers/transcribe.worker.ts` | in-browser fallback engine |
| `src/state/lyrics.ts` | source order, transcription orchestration, prefetch, 30 fps ease, line navigation |
| `src/services/lyricsProvider.ts` | LRCLIB lookup/search, filename cleaning, labels |
| `src/components/lyrics/` | `LyricsDisplay` (styles), `LyricsView` (states/toolbar), `LyricsSearch` (picker), `LyricsPreview`, `TranscribeDiagnostics` |
| `src/utils/translit.ts`, `src/utils/lrc.ts`, `src/utils/lyricIcons.ts` | Roman Hindi, LRC parsing, pictograms |
