# Underground music provider investigation

Tested 15 November 2026 against AFTERGLOW's 60-artist library (882 songs). This is research and testing only: nothing in the application was changed, and no provider was integrated. No unofficial scraping, ripped streams, DRM bypass, leaked keys or unauthorised proxies were used. Two projects that rely on them (Freedify and Saya Music API) were assessed from their own documentation only.

Code licences and music licences are separate. An MIT-licensed player gives no right to the music it plays.

## Bottom line

- **None of the 13 providers has a verified licensed track by any of your 60 artists.** Coverage is 0 full-length and 0 previews everywhere.
- **Seven of the nine you listed aren't usable music sources:**
  - five are apps or code libraries rather than music providers;
  - one couldn't be found;
  - one has shut its API.
- **Legitimate full-length sources for a public site** play only their own independent or royalty-free catalogues:

| Provider | Status for a public site |
|---|---|
| Audius | Best fit technically; its commercial terms still need confirming |
| Free To Use | Paid Commercial Plan |
| Jamendo | Paid licence by quote |
| Epidemic Sound | Paid partner agreement |

## Results

"Matching artists" counts verified recordings by the artist themselves. Fan uploads, remixes and people with the same name are excluded.

| Provider | What it really is | Official API | Matching artists (of 60) | Verified full-length tracks (yours) | Previews (yours) | Full playback in custom HTML player | CORS / Web Audio | Commercial permission | Integration difficulty | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| **ResonTune** | Open-source music web app (MIT code). Catalogue "starts empty" and grows from community releases. | No public third-party API (internal `/api/play/:id` only) | 0 | 0 | 0 | No catalogue to play | n/a | Per track, by rights holder. Code licence ≠ music licence. | Not a provider | Free code |
| **Freecrate** | No such music API or platform found. The only match is the "Free Crates" producer page on Bandcamp. | None found | 0 | 0 | 0 | n/a | n/a | n/a | Not found | n/a |
| **Free Music Archive** | Creative Commons library run by Tribe of Noise | **Discontinued.** `freemusicarchive.org/api/get/…` returns 404. | Not searchable via API (scraping the site would be unofficial) | 0 | 0 | No API to get files from | Not testable | Per track CC licence. Commercial via Tribe of Noise PRO (paid). | High (no API) | Free CC; PRO paid |
| **ccMixter** | Creative Commons community remixes | Yes, Query API, no key | 0 (10 text hits were remixes or mentions) | 0 | 0 | **No.** Files return 403 unless the request comes from ccmixter.org (hotlink protection) | No CORS | CC BY works commercially with credit; NC/ND don't; ccPlus is paid | Blocked | Free |
| **Internet Archive** | Library of user uploads | Yes (search and metadata), no key | 0 verified (2,625 fan uploads under 59 names) | 0 | 0 | Yes for genuine items (7:07 live recording; seek to 2:03) | `ACAO: *`; analyser receives data | Per item. The 299 "CC/public-domain" labels on your artists' items are uploader claims on label-owned albums, so they're invalid. | Medium | Free |
| **Epidemic Sound Connect** | Royalty-free catalogue licensed for creators' content | Yes, Partner API | 0 (its own composers only) | 0 | 0 | Not testable without a partner key. Docs mention streaming and downloads via CDN. | Not testable | Free plan "for prototyping": 50 downloads, "no commercial licence". Live use needs a paid plan or partner agreement; licence aimed at soundtracking creators' content. | Medium–high (contract) | Paid, priced by download volume or enterprise contract (no public price) |
| **Saya Music API** | Hobby Cloudflare Worker that relays other services' searches (Apple, Deezer, Audius, Internet Archive, Spotify, YouTube Music…) | Unofficial; no keys | Relays Apple/Deezer **previews** only | 0 | Relayed previews (AFTERGLOW already gets Apple previews directly) | Only via the upstream sources | Depends on upstream | **None.** Holds no music licence; it's an unofficial intermediary. Apple was already returning 429 to its shared server during the test. | Not recommended | Free, no guarantee |
| **StreamNX** | Library that matches release links across services | No audio. "It does not handle playback." | Metadata only | 0 | 0 | No | n/a | n/a | n/a | Free code |
| **Freedify** | Self-hosted player (MIT code) built on SpotiFLAC | No official API | Not tested (excluded) | 0 legitimate | 0 | **Excluded.** Gets lossless songs from "free third-party Tidal/Qobuz APIs", a "Tidal Hi-Res API proxy mesh", and yt-dlp extraction. | Not tested | **No.** Ripped streams through unauthorised proxies. MIT covers its code only. | Must not be used | n/a |
| **Audius** *(added)* | Artist-uploaded music platform | Yes, free REST API | 0 (no verified accounts; impostor accounts found) | 0 | 0 | **Yes.** Played a full 3:07 track and seeked to 2:03. | `ACAO: *` through the redirect chain; **analyser receives data** | API Terms and Open Music License (July 2025) cover use of artists' tracks in third-party apps; artists can opt out. Commercial scope **not confirmed**: the full terms page refused automated access. | Low | Free plan: 10 requests/s, 500,000 requests/month (Audius docs) |
| **Openverse** *(added)* | Search index of openly licensed audio (Jamendo, Freesound, Wikimedia) | Yes, no key for anonymous use | 0 (the one "Future" hit is a different Jamendo artist) | 0 | 0 | Through its sources (see Jamendo) | Depends on source | Per-track CC licence | Medium | Free |
| **Jamendo** *(added)* | Independent Creative Commons catalogue | Yes (requires a free `client_id`) | 0 (via Openverse's index) | 0 | 0 | **Yes**, full-length (3:49, seeked) | **No CORS header.** Plays, but the analyser reads zeros, so the lights need AFTERGLOW's own server proxy. | API free for **non-commercial** use only; commercial by quote (licensing@jamendo.com). Tracks are individually CC (some NC). | Medium | Free non-commercial; commercial by quote |
| **Free To Use** *(added, from the earlier report)* | Royalty-free catalogue: 1,679 tracks by 59 in-house composers | Yes, no key | 0 | 0 | 0 | **Yes**, full-length | `ACAO: *`; analyser receives data | Free only for social-media content with credit. A public, revenue-making site needs the Commercial Plan. | Low | Commercial Plan (price not published) or €50 per track (Pro) |

## Which can legitimately power a public music website

| Provider | Verdict | Conditions |
|---|---|---|
| Audius | **Recommended, after one check** | Read the API Terms and Open Music License on audius.co and confirm a public site (and any commercial use) is allowed; credit artists. Full songs, CORS and live lights all work. |
| Free To Use | Recommended if you pay | Commercial Plan for a public, revenue-making site |
| Jamendo | Usable | Non-commercial: free with a `client_id`. Commercial: get a quote. Lights need the server proxy. |
| Epidemic Sound | Possible, paid | Partner agreement; confirm a listening player is an allowed use |
| ccMixter, FMA, Internet Archive | Not recommended as API sources | Blocked files, discontinued API, or unverifiable rights |
| ResonTune, StreamNX, Freecrate | Not music sources | — |
| Saya Music API, Freedify | **Do not use** | Unofficial relay; ripped streams through unauthorised proxies |

None of these brings the 60 artists' songs to the site. For those, the legitimate options are still the ones in `FULL_TRACK_STREAMING_REPORT.md`:
- Apple previews (current);
- Spotify Premium via its SDK;
- YouTube's visible embed (off by your choice);
- Apple MusicKit (paid developer membership plus the listener's subscription).

## Method

**Artist search**
- Free To Use, ccMixter and the Internet Archive: the probe from `PROVIDER_COMPARISON_REPORT.md`.
- Openverse: `GET /v1/audio/?creator=<artist>`, counting only exact creator matches.
- Audius: `users/search`, accepting only verified accounts with an exact name match. Its verified-account check was itself verified on deadmau5, Skrillex and Disclosure.

**Player test**
- Headless Chrome on the AFTERGLOW origin.
- `new Audio()` with and without `crossOrigin="anonymous"`, then `MediaElementSource` → `AnalyserNode`.
- Recorded: metadata duration, playback after a seek, and the sum of frequency data after 3 s. Zero means the browser hid the samples.

**Not tested**
- Freedify and Saya, which depend on unauthorised sources, and Epidemic Sound, which needs a partner key. These are assessed from their own documentation.

## Sources

- ResonTune: [repo](https://github.com/flessan/resontune) · [PR #2](https://github.com/flessan/resontune/pull/2)
- Freecrate search: [Free Crates on Bandcamp](https://freecrates.bandcamp.com/track/rashida)
- Free Music Archive: [freemusicarchive.org](https://freemusicarchive.org/) · [RapidAPI directory entry for the legacy API](https://rapidapi.com/blog/directory/free-music-archive)
- ccMixter: [Query API](https://ccmixter.org/query-api) · [about](https://ccmixter.org/about)
- Epidemic Sound: [developer docs](https://developers.epidemicsound.com/docs/) · [FAQ](https://developers.epidemicsound.com/docs/FAQ) · [getting started](https://developers.epidemicsound.com/docs/getting-started/) · [free API blog post](https://www.epidemicsound.com/blog/free-api/)
- Saya Music API: [service](https://sayamusicapi.shnwazdeveloperx.workers.dev/) · [repo](https://github.com/shnwazdev/sayamusicapi)
- StreamNX: [repo](https://github.com/GeorgeGorbanev/streamnx)
- Freedify: [repo](https://github.com/BioHapHazard/Freedify)
- Audius: [terms update](https://blog.audius.co/posts/audius-terms-of-service-update) · [docs](https://docs.audius.co/llms-full.txt)
- Jamendo: [API terms](https://devportal.jamendo.com/api_terms_of_use) · [authentication](https://developer.jamendo.com/v3.0/authentication)
- Free To Use: [API](https://freetouse.com/api) · [licence](https://freetouse.com/license)
