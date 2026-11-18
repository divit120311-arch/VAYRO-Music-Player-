# Afterglow

Ambient music lighting for your screen. Afterglow plays music in the browser, analyses it in real time with the Web Audio API, and turns the bass, mids and highs into glowing RGB light strips around all four edges of the viewport, like the backlit-monitor setups it was inspired by.

## Quick start

```bash
npm install
npm run dev        # API on :8787 + Vite on :5173 → open http://localhost:5173
```

Production:

```bash
npm run build
npm start          # serves dist/ and the API on http://localhost:8787
```

Requires Node 20+ (developed on Node 24).

### Optional: Jamendo

Openverse works out of the box with no key. To enable the Jamendo catalog, get a free client ID at <https://devportal.jamendo.com>, then:

```bash
cp server/.env.example server/.env   # set JAMENDO_CLIENT_ID=...
```

Restart the server. The key is only ever read by `server/index.mjs`; the browser never sees it.

## Full-length songs

- **YouTube:** library songs and pasted links play in full in **YouTube's official embedded player**, which is free and needs no account.
  - The video stays visible in a corner, as YouTube requires.
  - The lights run in ambient mode, because the audio can't be read.
  - Lyrics follow the video's own clock when it is the album recording; otherwise they show as text.
  - To find each song's official upload automatically, add a `YOUTUBE_API_KEY`. Without it, use "Use a YouTube video for this song…" or paste a link.
- **Spotify:** full tracks for **Premium** accounts that you connect yourself (official OAuth with PKCE, no secret), via `SPOTIFY_CLIENT_ID`.
  - Lyrics are off during Spotify playback, because Spotify's developer terms forbid syncing its recordings with lyrics.
  - In development mode it works for you plus at most 5 users you add.
- **Settings → Full songs** shows what's available. Every song is labelled: *Full song · YouTube*, *Full song · Spotify*, *30-sec preview*, or your own file.

Setup, limits and test results: [FULL_TRACK_STREAMING_REPORT.md](FULL_TRACK_STREAMING_REPORT.md).

## Music library

Press **L** (or **Library** in the header). Real songs by 60 artists: Drake, Kendrick Lamar, SZA, Frank Ocean, Taylor Swift, Arctic Monkeys, Radiohead and more.

- **Where the songs come from:** Apple's official iTunes Search API. It needs no key and gives titles, albums, dates, durations, artwork, Apple Music links and Apple's 30-second previews.
- **Sections:** Home with discovery shelves, Discover (live search of Apple's whole catalogue), All songs, Artists, Albums, Most popular, Recently added, Favourites, My playlists, and nine genre collections.
- **Every song is checked when the catalogue is built:** the exact artist in Apple's catalogue, artwork that loads, a preview that really is audio, and a well-formed Apple Music link. Duplicates and karaoke, instrumental and sped-up versions are dropped. Run `npm run catalog:build` to rebuild it, which takes about 15 minutes because Apple limits request rates.
- **How each song plays, always labelled:**
  - **30s preview:** Apple's preview plays in Afterglow and drives the lights and the visualizer.
  - **Apple Music only:** there's no preview, so the song opens in Apple Music.
  - **Apple Music player:** Apple's official embed, which plays the full song if you're signed in. Its audio stays inside Apple's player, so the lights can't follow it.
  - Spotify and YouTube open as searches. With your own `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `server/.env`, the build adds direct Spotify track links; the secret stays on the server.
- **Lyrics on previews:** a 30-second preview starts somewhere in the middle of the song. Afterglow listens to the clip with the local speech recogniser, finds where it sits in the song, and shifts the synced lyrics onto it, so your lyric style animates. If the position can't be confirmed (a repeated chorus, an instrumental opening), the lyrics show as plain text. They're never wrongly synced. Tested on 20 songs: 12 synced, all correct; 8 text.
- **Add more artists:** Discover searches Apple's whole catalogue. "Add" builds and verifies a new artist's page in about 15 seconds, and you can remove it again.
- **Favourites, playlists and history** are saved on this device.

See [music-library-report.md](music-library-report.md) for what was verified.

## What you can play

| Source | How | Analysed? |
| --- | --- | --- |
| **Library** | Real songs by 60 artists, plus any artist you add (see above) | Previews: yes (Apple serves them with CORS). Full songs open in Apple Music |
| **Files** | Your own MP3, WAV, FLAC, M4A… (full songs, never uploaded anywhere) | Always |
| **Free music → Openverse** | Keyless search of CC-licensed music (largely Jamendo, plus Wikimedia and others) | Yes (via the proxy when the host lacks CORS) |
| **Free music → Jamendo** | Official API, needs `JAMENDO_CLIENT_ID` | Yes (via the proxy) |
| **Lighting test** | "Test the lights with a generated tone": an original piece synthesised in your browser | Always |
| **Link** | Direct audio file / stream URL (MP3, AAC, OGG/Opus, WAV, FLAC, WebM) | Yes if CORS or the proxy works, otherwise playback only |
| **Artists** | Kanye West, Drake, The Weeknd, The Neighbourhood via Apple's official iTunes Search API: albums, track lists, durations, search | 30-second previews: yes (Apple serves them with CORS). Full songs: open in Apple Music / Spotify |
| **Spotify player** | Spotify's official artist embed on each artist page | No: plays inside Spotify's protected player; the page says so and offers local upload |

Every catalog track shows its licence and links back to its source page.

Afterglow distinguishes three kinds of source: **analysable** (plays here and drives the lights), **playable only** (plays, but the browser hides its samples, so the lights stay ambient), and **external** (opens in the provider's own app).

**Not supported, on purpose:** pasting YouTube, Spotify, Apple Music, SoundCloud, TIDAL, Deezer, Bandcamp and similar links into the Link box. They are player pages protected by DRM and platform terms, not audio files. Afterglow detects them and explains why instead of trying to extract audio.

## Why some sources can't be visualised

A browser only lets Web Audio read samples from cross-origin audio when the host sends `Access-Control-Allow-Origin`. Without it, the audio plays but the analyser receives silence. Afterglow handles this in three steps:

1. **Direct**: load with `crossOrigin="anonymous"`. Works for CORS-enabled hosts (e.g. Wikimedia).
2. **Proxy**: relay the file through `/api/stream`, which adds CORS headers and supports `Range` (seeking). Used for Jamendo's storage, which doesn't allow arbitrary origins.
3. **Playback only**: if both fail, the track plays on a separate, unconnected `<audio>` element and the UI says *Playback only*. The lights fall back to their ambient animation rather than pretending to react.

The status pill under the track title always shows which path is in use.

The proxy refuses private/loopback addresses (re-checked on every redirect) and only relays audio or image content types. Treat it as a local or self-hosted helper. Before exposing it publicly, add authentication or rate limiting, and note that DNS rebinding is not fully mitigated.

## Lighting

Ten modes, each with its own behaviour and not only its own colour:

| Mode | Behaviour |
| --- | --- |
| Amber Glow | Warm pools of light drift along the edges; the kick lifts them |
| Neon Pink | Two hot sweeps orbit the screen with a white-hot core; mids drive them |
| Purple Dream | Slow interfering violet tides; highs add lavender sparkle |
| Cyber Blue | Two comets race in opposite directions; hi-hats speed them up |
| Blood Red | A heartbeat locked to detected kicks (a calm lub-dub when idle) |
| Rainbow Flow | The full hue wheel flowing around the perimeter |
| Music Reactive | Hue follows the spectral centroid (dark = ember, bright = ice); floor = bass, walls = mids, ceiling = highs |
| Cinematic Ambient | Slow and capped low; borrows colours from the album art |
| Bass Pulse | The room flashes with low-end transients, brightest at the bottom |
| Frequency Spectrum | The perimeter is a spectrum: bass at the bottom centre, rising to highs at the top |

By default the strip **follows the album artwork's colours**, as the reference videos do. Turn off "Follow album art" to use your own colours (hue/saturation wheel + brightness). Other options: **Notch contour** (traces a MacBook-style notch), **Lighting animation** (Music sync / Ambient / Static) and **Late-night mode** (dimmer, warmer).

Settings (saved to `localStorage`): presets derived from the reference videos (Pink Haze, Stage Amber, Cobalt Edge, Warm White, Crimson Night, Ember Desk) plus classics (Late Night, Cyberpunk, Warm Studio, Sunset, Deep Space, Minimal Orange), primary and secondary colour, follow-artwork colours, brightness, glow, strip width, bloom radius, strips/corners/both layout, per-edge toggles, sensitivity, bass sensitivity, smoothing, animation speed, colour transition speed, visualizer style and background darkness.

Visualizers: soft pulse, circular, spectrum bars, waveform, particles, minimal EQ, off.

## Display modes

The centre stage has five views (header switcher, or `V`): **Artwork**, **Lyrics**, **Visualizer**, **Clock** (lock-screen style: small date, large light clock) and **Ambient** (just the light). Immersive mode (`F`) shows the selected view full screen, with controls and the cursor hiding after a moment of stillness. `Esc` exits.

## Lyrics

**One clock.** Every lyric style is driven by the audio element's `currentTime` (plus a per-song offset), read once per animation frame. There are no timers. Paused music means frozen lyrics, a seek takes effect on the next frame (60–150 ms measured), and changing track clears the old lyrics and loads the new ones.

**Six looks from the reference videos** (Settings → Presets, with a live preview; they switch while music plays). Each sets the light, lyric style, album art and clock together:

| Look | Video | What you get |
| --- | --- | --- |
| 1 · Orange Typography | "Ambient lighting in your Mac" | Orange word reel on black, notch |
| 2 · Pink Artwork | "Can't stop looking at my screen" | Word stack over the album art, pink/violet light, clock |
| 3 · Amber Clock | "Peak music setup" | Lock-screen clock above the word reel; light follows the art |
| 4 · Blue Over Art | "Rate the music setup" | White reel straight on full-bleed, undimmed art; blue edge |
| 5 · Red Constellation | "The perfect late night setup" | The line as a star chart; the sung word glows |
| 6 · Gold Ring | "Music like this >>" | Reel inside a ring over the art; warm yellow light |

**Fisheye** (on by default, Settings → Lyrics): the lyrics bend like a lens, with the middle swelling and the edges curving away.

**Thirteen styles** in all:

| Group | Style | What it does |
| --- | --- | --- |
| From the reference videos | **Reel** | One word at a time: previous small above, current huge, next waiting on a block; a new line opens with its first word as a card |
| | **Reel over art** | The reel in white, straight on the album art, no blocks |
| | **Reel in a ring** | The reel inside a circular frame, next word on a pale block |
| | **Stack** | The line piles up word by word, newest at the bottom on a block; size follows the word's weight; staggered, gradient type |
| | **Constellation** | Every word of the line beside a star, joined by hairlines; the sung word grows on a glowing node |
| Line styles | **Cinematic fade** | Current line centred, previous drifts up, next waits softly below |
| | **Vertical scroll** | A column of lines (3–9 visible); the active one stays centred and lit |
| | **Blur focus** | Like scroll, with everything but the active line out of focus |
| | **Minimal** | Only the current line, soft fades |
| | **Ambient glow** | Glowing type whose glow breathes with the music's energy |
| Word styles | **Karaoke** | Each word fills as it's sung. Needs real word timestamps; with line timing only, the whole line lights instead (no invented word timing) |
| | **Word reveal** | Words appear as they're sung, never before |
| | **Typewriter** | Characters typed at the pace of the line's real timing |

**Settings** (saved on this device): lyrics on/off, style, text size, font weight, alignment, line spacing, highlight colour (match the lighting or pick one), text glow, animation speed, visible lines, word highlighting, position, album art behind lyrics (off / blurred / clear), background dimming, and the per-song sync offset. Line-by-line navigation: the ‹ Line › control in the lyrics toolbar or `,` / `.`.

**Hindi:** Devanagari renders with Noto Sans Devanagari (matras and conjuncts intact). When lyrics contain Devanagari, the **अ → A** button in the lyrics toolbar shows them in Roman letters (Hinglish spelling: kaise, tujhse, mein). That's transliteration for display, never translation. Function words like का, की and में stay small in the word-sized styles.

**Where lyrics come from**, in order:
1. Lyrics you saved for the song (paste text or LRC, or load or drop an `.lrc`/`.txt`).
2. The demo's sample lines.
3. **Lyrics inside your file:** ID3 `SYLT` (synced) or `USLT` (unsynced) tags, or a matching `.lrc` dropped together with the audio (`Song.mp3` + `Song.lrc`).
4. **LRCLIB** online lookup (artist, title, album and duration matching). Untagged downloads work too: the file name is cleaned ("Song (From Movie) [320kbps] - Site.mp3" → "Song") and the song's length picks the right version. **Search lyrics** lets you pick a version yourself; **Online lyrics script** prefers Roman (Hinglish) or native script (Devanagari).
5. **Transcription** of your own uploaded files.
6. Unsynced text, clearly labelled.
7. Otherwise "No lyrics found", with buttons to add lyrics or transcribe.

**Transcription.** When an uploaded file has no synced lyrics, Afterglow can listen to it and write word-timed lyrics:
- OpenAI's Whisper runs in the **local Afterglow server** (native ONNX Runtime, multi-threaded), about 6–11× faster than in the browser. Measured on a 2-core laptop: a 3-minute song in about 50 s, with the first lyrics after about 9 s, because the part you're listening to goes first. If the server isn't running, it falls back to the browser (slower).
- **Never twice:** results are cached by file hash on disk; repeated requests share one job; a cancelled job resumes from the sections it finished; the next queued upload is prepared in the background.
- The model is downloaded once from Hugging Face (Fast: about 77 MB; Accurate: about 250 MB, better for Hindi). Audio goes only to the server on this computer (localhost), never anywhere else.
- Language can be set (e.g. Hindi), so it isn't guessed. Lyrics are never translated.
- **Diagnostics:** Settings → More settings → Lyric sources → Timings shows real timings and RTF.
- The result is saved like your own LRC: "Fix words" opens it for correction with the timing kept, and "Re-transcribe" runs it again.
- It is a machine transcription and is labelled as one. Expect misheard words, especially under loud instruments.
- Turn it off with "Transcribe my uploads".

Formats: LRC (multiple stamps, `[offset:]`), enhanced LRC word stamps (`<mm:ss.xx>`), LRCLIB's word-level Lyricsfile, plain text (never shown as synced). Apple's 30-second previews are clipped from mid-song, so their lyrics are always shown unsynced. Afterglow never bundles or invents lyrics. LRCLIB is a free community database that does not license lyrics from publishers. Set `LRCLIB_USER_AGENT` in `server/.env` to identify your deployment.

### Keyboard

`Space` play/pause · `←/→` seek 5 s · `↑/↓` volume · `N`/`P` next/previous · `M` mute · `F` immersive · `V`/`⇧V` next/previous view · `[`/`]` lyrics later/earlier · `,`/`.` previous/next lyric line · `1`–`0` lighting modes · `S` settings · `L` library · `U` paste a link · `Esc` close panels (works from search boxes too)

## Architecture

```
server/index.mjs           Node http server: catalog adapters (Openverse, Jamendo, Apple), lyrics (LRCLIB),
                           CORS stream proxy, URL probe, static files
src/
  engine/
    audioEngine.ts         <audio> → MediaElementSource → Analyser → Gain → speakers; direct/proxy/plain loading
    lightingEngine.ts      perimeter geometry, 10 mode "shaders", core + bloom rendering, the single rAF loop
    visualizers.ts         centre visualizers, anchored to the artwork's on-screen rect
  utils/audioAnalysis.ts   bands, adaptive range normalisation, kick envelope, beat detection, centroid, log spectrum
  utils/colorUtils.ts      colour maths + album-art palette extraction
  utils/lrc.ts             LRC (+ word stamps) and LRCLIB Lyricsfile parsers, active-line search, word timing
  utils/lyricIcons.ts      keyword → pictogram map for the kinetic lyric style
  services/                openverse / jamendo / apple providers, lyrics lookup, transcriber, URL validation & probing,
                           local files (ID3), demo synth + its sample lyrics
  config/                  lighting modes & presets, artist themes (verified Spotify IDs)
  state/                   tiny external stores: settings (persisted), player, lyrics, UI
  hooks/                   useAudioPlayer, useAudioAnalyzer (useFrame), useAmbientLighting, useFullscreen
  components/              Header, MusicPlayer, StageView (views + clock), TrackInfo, PlaybackControls,
                           AmbientLighting, NotchBody, Visualizer, ThemeSelector, SettingsPanel, ColorWheel,
                           MusicLibrary, FullscreenExperience, Backdrop, ui
    lyrics/                LyricsDisplay (11 styles, one playback-driven clock), LyricsView (status, toolbar, editor),
                           LyricsPreview (settings preview)
  workers/transcribe.worker.ts   on-device Whisper transcription (word timestamps)
    artists/               ArtistsView (index, artist pages, albums, search, Spotify embed)
```

See [reference-analysis.md](reference-analysis.md) and [reference-study.md](reference-study.md) for the study of the six reference videos. The lyrics system is described in [lyrics-architecture.md](lyrics-architecture.md), [lyrics-performance-report.md](lyrics-performance-report.md) and [lyrics-visual-test-report.md](lyrics-visual-test-report.md).

Performance notes:
- One `requestAnimationFrame` loop drives everything. React never re-renders per frame; components subscribe with `useFrame` and write to DOM refs (progress bar, artwork pulse, clock-free time readout).
- The core line is drawn full-resolution as one gradient stroke per edge, so there are no per-segment seams. The bloom renders at quarter resolution and is blurred at two radii with `ctx.filter`, falling back to a CSS blur.
- The analyser sits before the volume gain, so the lights still react at low volume.
- The `AudioContext` is created and resumed synchronously inside the user's click, as strict autoplay policies require.

Add `?debug` to the URL to expose `window.__afterglow` (engines) in DevTools.
