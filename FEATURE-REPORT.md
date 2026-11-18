# Afterglow: Feature Completion Report (round 3: lyrics engine)

**Testing on the final build** (headless Chrome against `npm run build`, with real audio files):

| Suite | Result |
|---|---|
| New lyrics QA (local audio + LRC with known timestamps) | 24/24 on the final build; also 24/24 in each of 3 consecutive earlier runs |
| New on-device transcription test | 11/11 |
| Round-2 suite (views, lyrics, artists, settings) | 44/44 |
| Round-1 suite (playback, sources, lighting, immersive) | 35/35 |
| `tsc -b` | clean |

## How the clock works
- **One source of time:** the audio element's `currentTime` plus a per-song offset, read on each animation frame. There is no `setInterval` and no separate lyric timer.
- **Re-renders:** React re-renders only when the active line or word changes. Fills and drifts are written straight to the DOM.

## Phase 7 scenarios, as tested
- **Correct line and word:** at 5.40 s the active word is "feel" (stamped 5.32 s). Before the first stamp nothing is shown; inside an instrumental gap the gap is active.
- **Pause:** time, line and word stay frozen for 1.5 s.
- **Resume:** playback continues from the same spot, and words advance.
- **Seeking:** both directions jump to the right line. The display followed in 57–211 ms. The higher numbers were measured while the page ran at 1–12 fps because another Chrome process on this machine was busy (see limitations).
- **Track change:** the other song's lyrics load, and a line-only LRC is labelled as such.
- **Style switching:** all 11 styles show the active line while the music plays.
- **Fullscreen:** lyrics plus title and artist are shown; exiting stays in sync.
- **Reload:** style, weight and the per-song offset are kept.
- **Offset:** +0.5 s moves 11.6 s onto the "Give" line.
- **Line navigation:** `,` and `.` keys, plus the ‹ Line › control.
- **Fallbacks:** "No lyrics found" with add/transcribe buttons; "Lyrics are turned off" with a button to turn them back on.

## Styles (11)
- **From the reference videos:** Reel (video "Peak music setup"), Stack (video "Can't stop looking at my screen").
- **Your spec's 9 modes:** Cinematic fade, Karaoke, Floating, Typewriter, Minimal, Vertical scroll, Blur focus, Ambient glow, Word reveal.
- **Karaoke never guesses:** it fills word by word only with real word timestamps; otherwise it lights the whole line.
- **Word reveal never shows a word before its time** (tested: future words have opacity 0).

## Settings
- **Display:** lyrics on/off, style (with a live preview), size, weight, alignment, line spacing.
- **Look:** highlight colour (follows the lighting or a custom colour), glow, animation speed, visible lines, word highlighting.
- **Background:** position, album art behind lyrics (off / blurred / clear), background dimming, and title and artist in fullscreen.
- **Sync:** per-song offset.
- All are saved locally. Lighting presets never overwrite them.

## On-device transcription (for your uploaded files)
- **Order of preference:** synced lyrics embedded in the file (ID3) and a matching `.lrc` dropped with the audio come first, then LRCLIB. Only after those does Afterglow listen to the file itself.
- **Model:** Whisper base runs in a Web Worker. It is downloaded once (about 77 MB) and the audio never leaves the device. Output is word-timed LRC, labelled as a machine transcription, editable ("Fix words") and re-runnable.
- **Measured accuracy:** on a test file with synthetic vocals placed at 4.0 s, 12.0 s and about 20.4 s, all 14 test words were recognised, landing at 3.98 s, 11.86 s and 20.38 s. A 30-second file took 31–45 s including model start-up.

## Bugs found and fixed this round
- **Transcription timestamps collapsed:** when a section started in silence, every word got the same time, and some words landed 20 s late. Fixed with overlapping 30 s chunks and 5 s of lead-in context.
- **First word after a pause** started up to 4 s early. Its start is now rebuilt from its (reliable) end time.
- **Reel crashed when the track changed** while it was showing, because it read word positions from the previous song.
- **Settings changed less than 0.25 s before a reload were lost.** They are now saved on page hide.
- **Reopening the lyrics editor during its fade-out** revived the old editor with stale text.
- **Fast vocals made Reel and Stack pile up mid-animation.** Steps now scale to the gap before the next word.
- **Ambient glow ran at 8.5 fps** because it repainted a large text-shadow every frame; it now runs at about 46–48. Karaoke went from 28 to about 46–50, and Reel's step animation was made lighter.
- **Visual fixes:** in Stack, icons on the highlight block were invisible; empty gap lines filled neighbour slots in Cinematic and Scroll.

## Test changes, disclosed
- **round-1 suite:** after "Previous", the test now waits for the Pause button before clicking it. While a transcription is running, a track starts in about 240 ms instead of about 150 ms, and the test clicked inside that window.
- **round-2 suite:** the test now waits for a single editor before typing, because the old editor is still fading out.
- **lyrics QA:** pause waits for autoplay to begin, and checks wait for the display to settle and report how long it took.

## Not verified / limitations
- **Transcription accuracy has only been tested on synthetic speech over a synthetic beat.** It has not been tested on commercial recordings. Real singing under dense mixes will produce more misheard words. Only English was tested, though Whisper auto-detects other languages.
- **The first transcription needs internet** to fetch the model from Hugging Face. It runs single-threaded, because multi-threaded WebAssembly would need cross-origin isolation, which would break Spotify embeds and Apple artwork.
- **Estimated word timing:** Reel, Stack, Word reveal and Floating step through words using estimated word timing when only line timing exists. The toolbar says "word timing estimated" in that case. Karaoke and the word-highlight toggle never use estimates.
- **Frame rates are noisy on this machine.** Another Chrome process outside the test was busy during the final runs, so the headless page sometimes ran at 1–12 fps. In clean measurements, all styles render at 35–50 fps headless, in line with the non-lyrics views. They have not been measured on a real GPU.
- **Firefox and Safari are untested.**
- The settings preview uses Afterglow's own sample lines on a looping preview clock. That clock is only for the preview.

---

# Afterglow: Feature Completion Report (round 2)

**Status key:** ✅ done and tested in a browser · 🟡 done with a stated limitation · ⛔ not done

**Testing:** automated checks drove real headless Chrome 157 against the production build (`npm run build` + `npm start`):
- 35 regression checks from round 1, all passing;
- 44 new checks for this round, all passing;
- no page errors in either suite;
- `tsc` reports no errors.

One earlier run of the regression suite had 2 transient failures I did not capture; two immediate re-runs and the final run passed 35/35. That suite depends on live services (Openverse, Jamendo storage, Wikimedia), so the likely cause is network flakiness, but this is unconfirmed.

## Phase 1: Reference analysis ✅
- `reference-analysis.md`: all 12 requested topics, observed vs. interpreted separated, 20 implementable details, plus what the footage does *not* establish.
- Method: 12 evenly spaced frames per video over the full length, plus full-resolution crops of the settings panel, clock + lyrics, notch, highlight blocks, constellation layout and lyrics over artwork.
- Key finding: in five of six videos the strip colour matches the album art. "Follow album art" is now the default.

## Phase 2: Reference-style lighting ✅
| Item | Status |
|---|---|
| Thin strips on four edges, rounded corners, one continuous gradient stroke per edge (no seams) | ✅ |
| Notch contour (strip dips around a MacBook-style notch, true width via clipping, black notch body) | ✅ |
| Uneven diffusion: drifting hotspots, brighter bends and notch | ✅ |
| Soft two-radius bloom, dark surroundings, no CSS borders | ✅ |
| Colour follows album art by default; manual colours via hue/sat wheel + brightness | ✅ |
| Reactivity: Music sync / Ambient / Static (static measured sd 0.0003) | ✅ |
| Presets from the references: Pink Haze, Stage Amber, Cobalt Edge, Warm White, Crimson Night, Ember Desk | ✅ |

## Phase 3: Lyric display engine ✅
- Seven styles, each verified to show the active line:
  - **Kinetic** (reference look: stacked words, highlight block, pictograms, echo entrance)
  - **Cinematic**
  - **Karaoke** (progressive word fill)
  - **Minimal**
  - **Floating** (constellation)
  - **Typewriter** (characters paced by word timing)
  - **Focus** (blurred surrounding lines)
- Style, size and position controls; switchable from the lyrics toolbar or settings.
- No copyrighted lyrics are bundled. The demo uses sample lines written for Afterglow.

## Phase 4: Synchronisation ✅
- **Supported input:** LRC (multiple stamps, `[offset:]`), enhanced word stamps, LRCLIB word-level Lyricsfile, manual paste, `.lrc`/`.txt` upload or drop.
- **Driven by the audio element's position:** after a seek, the active line updated in 31–123 ms in measurement.
- **Per-song offset:** ±0.1 s steps, persisted, tested to shift the active line correctly.
- **LRCLIB:** API, docs and rate limits reviewed. Requests go through the server, identify the client, and match on duration (±2–3 s). Tested end-to-end: a file tagged with a real artist/title matched a word-synced record.
- **Honest states:** "No lyrics found", "Instrumental", "Online lyrics are off", "Not time-synced" for plain text, and "word timing estimated" when only line timing exists.
- **Previews:** Apple's 30-second clips are never shown with synced lyrics (verified).

## Phase 5: Artist experience ✅ 🟡
- Kanye West, Drake, The Weeknd and The Neighbourhood each have a themed editorial page with their own type, colour and artwork treatment. Pages include:
  - top tracks, albums, and singles & EPs;
  - album track lists with durations, plus search;
  - 30-second previews, and "Light the room" (applies the artist's palette);
  - Apple Music, Spotify and YouTube links.
- Data comes from Apple's official iTunes Search API, server-cached and rate-spaced. Artwork is loaded from Apple's URLs, never bundled.
- Video-only releases are filtered out, and duplicate top tracks are removed.
- 🟡 **No artist portraits:** Apple's API has none, so heroes use the latest album cover.
- 🟡 **Previews only:** full songs play only in Apple Music or Spotify.

## Phase 6: Source architecture ✅ 🟡
- Three capability classes, shown in the UI:
  - **analysable**: demo, local files, CORS or proxied URLs, Openverse/Jamendo, Apple previews;
  - **playable but not analysable**: the URL fallback, and the Spotify embed;
  - **external only**: Apple Music, Spotify and YouTube pages.
- Spotify: artist IDs verified via Spotify's own oEmbed; official embed with a notice that it can't drive the lights and a "Upload my own audio" shortcut.
- No scraping, ripping, DRM bypass or ad bypass anywhere.
- 🟡 **No Spotify OAuth or Web API:** not needed for embeds. Spotify no longer provides preview audio to new apps.
- 🟡 **No YouTube embeds:** official links are used instead, because I had no verified video IDs and would not invent them.

## Phases 7–8: Music screen, clock and late night ✅
- Five views with animated transitions: Artwork, Lyrics, Visualizer, Clock, Ambient.
- Immersive fullscreen renders any of them, with auto-hiding controls and cursor; Esc exits.
- Lock-screen clock: small date, large light clock, no AM/PM.
- Late-night mode: the light dims from 0.81 to 0.45 average and turns warm, and the interface goes warm and dim.

## Phase 9: Settings ✅
All requested settings are present and persisted in `localStorage`:
- lighting colour, intensity, glow radius and thickness;
- animation speed, music sensitivity and bass sensitivity;
- lyrics style, font size and position;
- clock and album-artwork visibility;
- a fullscreen button and the visualizer style.

Presets only change lighting, not personal display preferences.

## Bugs found and fixed during testing
- Video-only releases appeared as albums with empty track lists. A patch script had written backspace characters into a regex; fixed, and the codebase was scanned clean.
- **Esc was ignored while typing in a search box**, so the Artists overlay couldn't be closed by keyboard after searching. Esc now always closes panels.
- Visualizer anchors were lost after leaving immersive mode (fixed in round 1, still holds).
- Karaoke lines appeared dim for about 0.7 s after each line change; they now crossfade immediately.
- The immersive lyrics toolbar collided with the controls; it now sits above them and auto-hides.
- Focus-style lines overflowed into the toolbar; fixed with an edge-fade mask.
- Artist top tracks contained duplicates; now deduplicated.

## Not verified / known limitations
- Tested only in headless Chrome and Edge on Windows. **Firefox and Safari were not tested.** Safari-style autoplay rules are handled in code (the AudioContext unlocks inside the click) but unverified.
- Performance: 55–60 fps at 1920×1080 in headless software rendering; the engine costs about 3 ms per frame. Not measured on a real GPU.
- **Jamendo** search is implemented but untested end-to-end: it needs your `JAMENDO_CLIENT_ID`.
- **LRCLIB** coverage varies, and it is community-sourced rather than publisher-licensed. You can turn online lookup off.
- **The reference app's typefaces** (SF Pro Rounded-like) are approximated with open-licence fonts (Nunito, Inter Tight).
- **The JS bundle is 553 kB** (178 kB gzipped). Vite warns about chunk size; code-splitting the artist and lyrics views would trim it.
