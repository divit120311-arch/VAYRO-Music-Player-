# Afterglow Lyrics: Transcription Performance Report

**Machine:** AMD Ryzen 3 3250U (2 cores, 4 threads), 5.9 GB RAM, Radeon Vega 3 integrated GPU, Windows 11, Chrome 157, Node 24.

**Audio:**
- **Short:** a 30 s English test track with synthetic (text-to-speech) vocals over a synthetic beat, at known positions (4 s, 12 s, about 20 s).
- **Long:** the same track repeated to 180 s.

Both were made for testing, so I'm allowed to process them. Every number below was measured in this session. Anything not measured is labelled.

**RTF** = total processing time ÷ audio length. Lower is faster: 0.25 means a 3-minute song takes 45 s.

## 1. Where the time went (baseline)

| Finding | Evidence |
|---|---|
| **The model was Whisper base, 8-bit, running in the browser** on single-threaded WebAssembly. The browser only allows multiple threads in a cross-origin-isolated page, which would break the Spotify and Apple embeds. | Baseline: **55.8 s for the 30 s clip (RTF 1.86)**. Model init 13.8 s; first lyrics after 39.9 s |
| **GPU (WebGPU) on the Vega 3 doesn't help.** | 32-bit encoder with 4-bit decoder: 71.4 s for 30 s. 16-bit encoder with 4-bit/16-bit decoder: **no words at all** |
| Audio was decoded and resampled once per job, which is fine. | Decode about 0.3–2 s per song |
| The same song was transcribed again after its saved lyrics were removed, or under another artist/title. | No file-hash cache existed |
| Jobs weren't shared or resumable, and nothing ran ahead of time. | |
| Playback was never blocked: music started in 0.2–0.7 s in every run. | |

**Conclusion:** the bottleneck was the execution engine (single-threaded WebAssembly), not decoding or the model choice.

## 2. Alternatives evaluated

| Option | Result |
|---|---|
| **Same Whisper model, native ONNX Runtime in the local Node server (multi-threaded)** | **Chosen.** 30 s clip: 5.0 s (RTF 0.17). 180 s: 34.2 s (RTF 0.19). Model load 2.4–2.6 s |
| Whisper **small** (8-bit), same engine | 30 s: 11.1 s (RTF 0.37), model load 14.3 s. Offered as "Accurate" for Hindi and other non-English songs |
| **faster-whisper (CTranslate2)** | **Could not run here.** Windows' Application Control policy (Smart App Control) **blocks CTranslate2's native DLL** (`OSError: [WinError 4551]`). I did not try to bypass a security policy. The PyYAML dependency also has no Python 3.15 Windows wheel |
| Distil-Whisper | Not used: the distilled models are English-only, and Hindi is a requirement |
| WhisperX (separate forced alignment) | Not needed. Whisper's cross-attention timestamps already give word timing in the same pass, so a second alignment pass would add time. Word starts after pauses are corrected using the reliable end times (measured below) |
| Medium/large models | Not used. About 1.5 GB or more, and too slow and memory-hungry on 2 cores and 6 GB RAM |

## 3. New pipeline: measured

### Server only (no browser running)

| Test | Result |
|---|---|
| 180 s, first run | **first words 7.9 s, done 41.2 s (RTF 0.23)**, model init 2.4 s |
| Same file requested twice at once | Second request **joined the same job** |
| Cached request | **72 ms** |
| Cancelled after 3 of 8 sections, requested again | **Reused 3 sections**, finished the rest in 28.3 s |
| Word timing (the word "give", sung 6 times) | 11.86, 41.85, 71.87, 101.85, 131.85, 161.87 s, consistent across the 6 repeats to within 0.02 s (expected: one every 30 s) |

### Real upload flow in the app (GPU-accelerated headless Chrome, 180 s, first time)

| Lighting during the job | Music starts | First lyrics | Done | RTF |
|---|---|---|---|---|
| 60 fps | 0.7 s | 9.5 s | 63.5 s | 0.35 |
| **30 fps (default "Ease the light while writing")** | 0.4 s | **9.0 s** | **49.7 s** | **0.27** |

### Old vs. new

| | Old (browser) | New (local server) | Speed-up |
|---|---|---|---|
| 30 s clip, first time | 55.8 s (in the app) | 5.0 s (server only) / 11.8 s (app open, GPU rendering) | 4.7–11× |
| 180 s song, first time | about 5.6 min (**extrapolated** from RTF 1.86; not run) | **49.7 s** (in the app, 30 fps ease) | about 6.7× |
| First lyrics on screen, 180 s | about 40 s or more (30 s-clip baseline) | **about 9 s** (section being listened to goes first) | about 4× |
| Same song again (cache) | n/a: re-transcribed | 43–151 ms (server cache), 213 ms (after a page reload) | |
| Next track in the queue | n/a | **494 ms** to lyrics (prefetched in the background) | |

### CPU sharing on this 2-core machine
The rendering browser and the model compete for the same cores. The same 30 s job took:

| Condition | Time | RTF |
|---|---|---|
| Nothing else running | 4.2–5.0 s | 0.14–0.17 |
| App open, GPU-accelerated rendering | 11.8 s | 0.39 |
| App open, software rendering | 17.5 s | 0.58 |
| Full app, software rendering, 60 fps (worst case) | 41.2 s | 1.37 |

Mitigation: the lighting eases to 30 fps while a job runs, which saved about 22% on the 180 s run. Lowering the ONNX thread count or turning off spin-waiting made no difference (4.2–4.7 s).

### Memory and disk
- **Server process with base and small loaded:** 669 MB working set, 898 MB private.
- **Transcript cache:** about 4 KB per song (JSON in `server/.cache/transcripts`).

## 4. Hindi, Hinglish and English
- **Hindi through LRCLIB** (exact, synced, no transcription):
  - Untagged `Kesariya (From Brahmastra) [320kbps] - PagalWorld.mp3`: synced lyrics in **0.8–1.3 s**.
  - Channa Mereya: Devanagari in **0.6–0.8 s**.
  - Switching to Roman letters refetches the Hinglish version.
- **Hindi transcription accuracy: not measured.** No authorized Hindi recording was available, and Windows has no Hindi text-to-speech voice installed. I did not invent a number. To measure it, provide a Hindi recording you're allowed to process, with known lyrics.
- **What was fixed for Hindi:**
  - **Words were being dropped:** Devanagari words were treated as identical by the repeat filter, so lines lost words after six in a row.
  - **Line breaks:** the Hindi full stop (। danda) now ends a line.
  - **Matras:** Devanagari vowel signs are kept when comparing words.
  - **Language:** it can be forced (no Urdu mislabelling). Translation is never used (`task: transcribe`).
- **Code-switching (Hinglish):** Whisper transcribes mixed Hindi-English as one stream. With "Detect automatically" it decides per 30 s window. Not measured.

## 5. Not done, or limited
- **Concurrency:** chunks run one at a time on one worker thread. Two concurrent jobs would compete for the same 2 cores, so the scheduler interleaves by priority instead.
- **No silence detection model** (e.g. Silero). Near-silent sections are skipped by an energy check; instrumental sections are still processed.
- **No user-selectable pre-processing of chosen tracks** beyond "next in queue".
