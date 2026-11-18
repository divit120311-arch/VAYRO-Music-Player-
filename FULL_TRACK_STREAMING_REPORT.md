# Afterglow: Full-Length Playback Report

**Date:** 14 November 2026

**What's tested:**
- **YouTube:** full-length playback is implemented and tested end to end in the app.
- **Spotify:** the integration is implemented. Its sign-in flow is tested up to the point where a real Spotify account is needed. **Full-track playback through Spotify has not been tested**, because no Spotify developer app or Premium account was available here.
- **Apple Music (MusicKit):** evaluated, not built.

## 1. Providers

| Provider | Integration | Full songs? | Status here |
|---|---|---|---|
| **YouTube** (official IFrame Player API) | Built | **Yes**, as `EMBEDDED`: the complete video plays in YouTube's own player | **Tested** (see §6) |
| **Spotify** (Web Playback SDK + Web API, OAuth with PKCE) | Built | **Yes**, as `FULL_TRACK`, for **Premium** accounts only | Sign-in flow tested without a real account; **playback untested** |
| **Apple Music** (MusicKit JS) | Not built | Only for Apple Music subscribers, and only if you hold a paid developer membership | 30-second previews only (as before) |
| Your own files | Already there | `LOCAL`, complete | Unchanged, tested |

**How each track is labelled:**

| Type | Shown as |
|---|---|
| `FULL_TRACK` | "Full song · Spotify" |
| `EMBEDDED` | "Full song · YouTube official player" |
| `PREVIEW_ONLY` | "30-sec preview" |
| `EXTERNAL_ONLY` | Apple Music / Spotify / YouTube links |
| `LOCAL` | your own files |

A preview or a link is never labelled as a full song. A library row only says "Full song · YouTube" once a real video has been found or linked for that song.

**How a library song plays** ("Play full songs when available", on by default, in Settings → Full songs):
1. **Spotify:** if you're connected with Premium and the song is playable in your market.
2. **YouTube:**
   - a video you linked to that song ("Use a YouTube video for this song…" in its menu), or
   - with a `YOUTUBE_API_KEY`, the song's official upload: the artist's "Topic" art track (the album recording) or the official/VEVO channel. Every pick is checked with YouTube's oEmbed endpoint.
3. **Otherwise Apple's 30-second preview**, with a notice saying why. For example: *"Full song not available (no full-length source is set up (Settings → Full songs)). Playing Apple's 30-second preview."*

**Links:** the Link tab now plays YouTube video links (`watch?v=`, `youtu.be/`, `shorts/`) in YouTube's player, and Spotify track links with a connected Premium account.

### Library coverage: 444 of 882 songs play in full, with no key

`npm run catalog:youtube` (about 15 seconds; already run) attaches each song's **official** upload to the catalogue:

1. **Wikidata** (open data, CC0, no key) lists official videos for songs. Artists are matched by the exact Apple Music artist ID the catalogue already has.
2. **With `YOUTUBE_API_KEY`:** the YouTube Data API fills the gaps automatically.

Every match is verified with YouTube's oEmbed endpoint. A video is accepted only if:
- it **exists** and **allows embedding**, and
- it comes from an **official channel**:
  - the artist's own channel, VEVO channel or "- Topic" channel, or
  - a known label or video channel (e.g. XL Recordings, Domino, 88rising, Lyrical Lemonade), and then only when the title names the artist.

Result (Wikidata only): **444 / 882 songs (50%)**.
- **Strong coverage of the biggest hits:** Eminem, Rihanna and Linkin Park are complete; Coldplay and Dua Lipa have 14/15.
- **Weaker for newer or niche artists:** Metro Boomin, Brent Faiyaz, Chase Atlantic and Cigarettes After Sex have none.
- **18 candidates were refused:** fan re-uploads (one titled "(Official Video)"), deleted videos, and videos whose owners don't allow embedding (e.g. Coldplay – Yellow, Radiohead – Karma Police).

**The other 438 songs:**
- **automatically:** add a free `YOUTUBE_API_KEY` and run `npm run catalog:youtube` (about 100 songs a day on the free quota);
- **by hand:** "Use a YouTube video for this song…";
- **otherwise:** they play Apple's 30-second preview, with the reason.

**Tested:**
- library play buttons start the full song from YouTube (Drake – Toosie Slide, played past 49 s);
- the "Full songs" filter lists exactly 444;
- unmatched songs fall back with the reason.

## 2. Accounts and subscriptions

| | Listener | You (site owner) |
|---|---|---|
| YouTube | Nothing. YouTube may show ads (not blocked) | Optional free API key to find library songs automatically |
| Spotify | **Spotify Premium**, plus being added to your app's allowlist | A Spotify developer app. In development mode it works for **you plus at most 5 users** you add under User Management; more needs Spotify's "extended quota" approval, which Spotify only grants to established businesses. Reported as of 2026: the app owner also needs Premium |
| Apple Music | An Apple Music subscription | A **paid Apple Developer Program membership** ($99/year) to sign MusicKit tokens. Forum reports suggest full playback may be restricted for individual (non-organisation) accounts |

Afterglow never sees a Spotify password: you sign in on accounts.spotify.com.

## 3. Regions

- **YouTube:** some videos aren't available in some countries, and owners can disable embedding. YouTube reports both with the same error codes (101/150). Afterglow shows *"YouTube won't play this video here (error 150): the owner doesn't allow it outside YouTube, it isn't available in your region, or it no longer exists."* and doesn't try to get around it.
- **Spotify:** songs are looked up in the listener's own market (`market=from_token`). A song Spotify marks unplayable there is reported as not available in your region, and a pasted link to it says *"That track isn't available on Spotify in your region."* (The region check is implemented but untested, since it needs a real account.)
- **Apple previews:** US catalogue (as before).

## 4. Lights, visualizer and lyrics

| Source | Audio-reactive lights and visualizer | Lyrics |
|---|---|---|
| Your files, CC music, direct links | **Yes**: bass, mids and highs from Web Audio | Synced (LRCLIB, file, transcription) |
| Apple previews | **Yes** | Synced when the preview could be lined up by listening (§ music library report), otherwise text |
| **YouTube full songs** | **No:** the audio is inside YouTube's player and can't be read. The lights run in **ambient mode**, labelled "Ambient lighting · provider player" | **Synced to YouTube's own playback clock** (`getCurrentTime`, read every frame; no separate timer), but only when the video's length matches the recording the lyrics were timed to (±3 s). Music videos with intros or skits get the lyrics **as text, with the reason**, e.g. HUMBLE. video 184 s vs album 177 s |
| **Spotify full songs** | **No** (Spotify's player is DRM-protected); ambient mode | **Off.** Spotify's developer terms list *"Syncing sound recordings accessed via the Spotify Platform with other recordings, lyrics, or video"* as a disallowed use, so Afterglow shows why there are no lyrics |

## 5. How it's built

- **The engine:** `audioEngine` became a facade. YouTube and Spotify tracks are handed to `src/engine/youtubePlayer.ts` and `src/engine/spotifyPlayer.ts`, which both implement `ExternalPlayer`. Play, pause, seek, volume, duration, ended, the queue, shuffle/repeat, the progress bar and the lyrics clock all use the provider's real playback state, so nothing else in the app needed rewriting.
- **YouTube rules followed:**
  - **Placement:** the player sits in a dedicated dock at 356 × 200 px, always visible (≥ 200 × 200 required), above every other layer including the edge lighting and fullscreen, with nothing drawn over it (tested at five points), square corners and its label outside the player.
  - **Autoplay:** no autoplay before it's visible.
  - **Background play:** playback pauses when the page is hidden.
  - **Audio:** never separated or downloaded.
- **Spotify security:**
  - **Sign-in:** OAuth 2.0 Authorization Code with PKCE (S256), with a fresh `state` checked on return.
  - **Redirect:** `http://127.0.0.1:<port>/`, since Spotify no longer accepts `localhost`. Opening Afterglow on `localhost` hops to `127.0.0.1` first, because tokens are stored per address.
  - **Tokens:** refreshed before expiry; a revoked sign-in shows "expired, connect again".
  - **Account check:** the account is validated with `/v1/me` and Premium is checked.
  - **Secrets:** no client secret anywhere; the server shares only the public client ID.
- **YouTube API key:** stays on the server. Lookups are cached in `server/.cache/youtube.json` (each new song costs about 101 of the 10,000 free daily units).
- **New server endpoints:** `/api/config`, `/api/youtube/oembed`, `/api/youtube/resolve`.

## 6. Tests

**Full-length YouTube playback** (Drake – Hotline Bling, official DrakeVEVO upload, checked with YouTube's oEmbed):

| Check | Result |
|---|---|
| Plays in YouTube's official player, labelled `EMBEDDED`, real duration 295.5 s | PASS |
| **Plays past 30 s** (40.7 s after seeking to 25 s and listening) | PASS |
| Seeks to 60 / 150 / 200 / 260 s and keeps playing one second per second | PASS (see note below) |
| Pause freezes the clock; resume continues | PASS |
| Volume reaches the provider | PASS |
| Previous / next between two YouTube songs (`watch?v=` and `youtu.be/` links) | PASS |
| Player visible at 356 × 200, nothing over it at five sampled points | PASS |
| Pauses when the page is hidden | PASS |
| Hidden during a track change: the next video doesn't start in the background | PASS |
| Lights report ambient mode, not fake analysis | PASS |
| Lyrics synced to the video's clock and moving with a seek (LRCLIB had a 296 s version) | PASS |
| Lyrics shown as text when the video isn't the album recording | PASS |
| Back on a local file: live analysis returns, the YouTube player hides | PASS |
| Non-existent video refused; player error shown in plain words | PASS |
| No page errors | PASS |

**The final build passed 22/22 in three runs in a row.** Earlier runs failed in four ways:

- **Background play (an app bug, fixed):** the page was hidden while the next video was still buffering, and it then played in the background, which YouTube forbids. Afterglow now pauses in that case, and also refuses to start a video while the page is hidden.
- **Previous (made more robust):** right after a restart, YouTube's clock can lag, so a quick second press could restart the song again instead of going back. A second press within 3 seconds now always goes to the previous song.
- **Deep seek:** twice, the check saw the clock stuck at 201 s after a jump to 200 s. A per-second trace in later runs, and four standalone seek traces, played on normally, so I couldn't reproduce it. It's most likely buffering in the test browser, but it isn't proven.
- **Test timing (not app bugs):** clicks that landed while a panel was still closing.

**Library song made full via a linked video** (Kendrick Lamar – HUMBLE., official video):
- plays in full;
- its row changes to "Full song · YouTube";
- it's remembered after a reload;
- the next song falls back to its preview with the reason, and the lights go live again.

6/6.

**Spotify, without a real account** (temporary test server with a dummy client ID, requests to Spotify intercepted): 15/15.
- the Connect button appears;
- the authorize request uses PKCE S256, a 43-character challenge, a state value, the `127.0.0.1` redirect and minimal scopes, with no secret;
- a forged callback with the wrong state is refused, and the code is removed from the address bar;
- a cancelled sign-in is reported;
- a Spotify link without Premium explains what to do;
- lyrics are off during Spotify playback, with the reason;
- with no sign-in, Spotify playback fails immediately with a readable error;
- with no full source, a library song plays its preview and says why.

**Not tested:**
- **Spotify for real:** an actual sign-in, Premium playback, seeking, end-of-track detection, token refresh, and the region check.
- **Real regional blocks:** I couldn't produce one from here. Bad and non-embeddable videos were tested.
- **Ads:** I didn't observe an ad.
- **Automatic YouTube matching:** no `YOUTUBE_API_KEY` is configured, so the automatic official-upload lookup is untested.

## 7. Setup

1. **YouTube (optional, recommended):**
   - Google Cloud Console → enable *YouTube Data API v3* → create an API key → `server/.env`: `YOUTUBE_API_KEY=…`
   - Restart the server.
2. **Spotify (Premium users):**
   - developer.spotify.com/dashboard → Create app → APIs: *Web API* and *Web Playback SDK* → Redirect URIs: `http://127.0.0.1:5173/` and `http://127.0.0.1:8787/`.
   - User Management: add each listener's Spotify email (up to 5).
   - `server/.env`: `SPOTIFY_CLIENT_ID=…` (no secret needed).
   - Restart, then open **http://127.0.0.1:5173** → Settings → Full songs → Connect Spotify.
3. **Apple Music:** not available without a paid Apple Developer membership. The catalogue already stores Apple song IDs, so it could be added later.

`server/.env.example` documents all of this.

## 8. Remaining limits

- **No beat-reactive lights for full songs from YouTube or Spotify:** the providers don't expose audio, so it's ambient lighting. Previews and your own files still react.
- **Spotify is personal-use only:** Spotify's terms say the platform is for personal, non-commercial use, and commercialising a streaming app needs Spotify's approval. Development mode is capped at 5 users.
- **YouTube's player must stay on screen** while a YouTube song plays: no audio-only or background mode.
- **YouTube ads** may play; they're YouTube's and aren't blocked.
- **Music videos aren't always the album recording:** lyrics then show as text. With an API key, Afterglow prefers "Topic" art tracks, which are the album recording.
