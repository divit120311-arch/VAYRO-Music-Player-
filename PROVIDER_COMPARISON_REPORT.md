# Music provider comparison — Free To Use, The Rights Foundry, Niche DSP, ccMixter, Internet Archive

Tested 15 November 2026 against the 60 artists in AFTERGLOW's library (`server/catalog/artists.mjs`, 882 songs).
Nothing was integrated into AFTERGLOW, and no music was downloaded or extracted from any streaming service.

## Bottom line

**None of the five providers has a single verified, licensed track by any of the 60 artists — full-length or preview.**

- Free To Use, ccMixter and Niche DSP have no recordings by them at all.
- The Rights Foundry's catalogue is Audiosocket's independent artists. It could not be searched without a paid account.
- The Internet Archive holds 2,625 fan uploads under 59 of the 60 names. Their "open licence" labels are claims by the uploaders, not real licences, so none qualifies.

Free To Use is the only provider whose own catalogue works end-to-end in AFTERGLOW's player (full-length, CORS, lights). That catalogue is 1,679 royalty-free tracks by its own 59 composers. A public commercial deployment needs its paid Commercial Plan.

## Comparison

| | Free To Use | The Rights Foundry | Niche DSP | ccMixter | Internet Archive |
|---|---|---|---|---|---|
| **Your 60 artists found** | 0 | Not testable without a paid account. Catalogue is independent artists only, and none of the 60 is named as a partner. | 0 (no catalogue exists) | 0 (no artist accounts; the 10 text hits were remixes or mentions) | 0 verified (59 names have fan uploads; see below) |
| **Verified full-length playable tracks (your artists)** | 0 | 0 verified | 0 | 0 | 0 |
| **Preview-only tracks (your artists)** | 0 | 0 verified | 0 | 0 | 0 |
| **Provider's own catalogue** | 1,679 full tracks (161 premium), median 2:21 | 110,000+ songs from 3,500+ independent artists (Audiosocket) | None. "No licensed catalogue is available yet." | Community remixes under Creative Commons licences | Live Music Archive (taper-friendly bands), netlabels, public domain |
| **Full-length audio through the API** | Yes, `files.mp3` | No. The stream is a "128 kbps MP3 preview for auditioning"; full WAV masters only via paid `sync`. | No. The test build "serves synthetic test tones only." | Yes (`download_url`), but blocked when requested from other sites | Yes (`/download/<item>/<file>`) |
| **Works in a custom HTML audio player** | **Yes.** Tested: played, seeked to 0:42 | Not testable without an account. The docs say signed URLs support byte ranges. | — | **No.** HTTP 403 in Chrome; files are only served to pages on ccmixter.org | **Yes.** Tested: 7:07 recording, seeked to 2:03 |
| **CORS** | `access-control-allow-origin: *`, ranges OK | API allows cross-origin; audio host is separate (untested) | — | No CORS headers, and the files are blocked anyway | `access-control-allow-origin: *` after a redirect, ranges OK |
| **Audio-reactive visualizer (Web Audio)** | **Works** (analyser received live data). The licence doesn't mention it. | The API itself provides energy, BPM and waveform data. Using Web Audio on its streams wasn't testable. | Not mentioned | Not testable (blocked) | **Works** (analyser received live data) |
| **Licence for public commercial use** | Free licence only covers user-generated content on social platforms, with credit. A revenue-making "Digital Product" needs the paid Commercial Plan (one product, up to 10 accounts). The licence forbids making assets "available to any third party" outside the paid terms. | Streaming licence is "a single-time stream, or to preview a potential sync license". Sync use is "without monetization" unless Export Sync. Public streaming to end users isn't addressed. | "No revenue-sharing or commercial terms have been set." | Per track: CC BY works commercially with credit; NC / ND tracks don't. ccPlus is a separate paid licence. | Per item. Only the rights holder can licence; the uploader's label is not proof. |
| **API limits** | No key, no stated limits | MCP: 1,000 calls/day. Dashboard keys: no cap. `Retry-After` ≥ 60 s. Signed URLs last 1 hour. | No partner API or sandbox yet | None stated | None published (asks for reasonable use) |
| **Free tier** | API free. Music free only for non-commercial social content, with credit. | "Free to start", plus a 50,000-credit sign-up offer (value not stated). Browsing and search cost credits. | None | Free | Free |
| **Commercial deployment cost** | Commercial Plan (price not on the licence page), or Pro Licence per track (€50 one-time, from their FAQ) | $49/month "to go live", plus usage credits. Stream charges are "a documented coming change". | Unknown (a 20% platform-fee model is described, with no terms set) | Free for CC BY tracks. Negotiate ccPlus per artist. | Free for genuinely CC / public-domain items |
| **Geographic restrictions** | None stated | None stated; streams record the listener's country | Per-track, per-country rules planned | None stated | None stated |

## What the Internet Archive uploads actually are

A search of `creator:"<artist>" AND mediatype:audio` found 2,625 items with an exact creator match, across 59 of the 60 artists. Of these, 299 carry a Creative Commons or public-domain label.

Those labels are set by whoever uploaded the item. Samples found:

| Archive item | Label it carries |
|---|---|
| Kendrick Lamar, *To Pimp A Butterfly* (2015) | CC0 |
| Lana Del Rey, *Norman Fucking Rockwell!* | CC0 |
| Radiohead, *A Moon Shaped Pool* | CC0 |
| Unreleased Kendrick Lamar leaks | CC0 |
| A Linkin Park "Official Music Video" rip | CC BY-NC |

These are label-owned recordings, and the uploaders have no right to licence them. None of the 60 artists has recordings in the Live Music Archive (`etree`), the collection where bands explicitly allow free distribution.

**Verified licensed tracks: 0.** Playing them would mean streaming unlicensed copies, so they don't count as available.

## Method

**Free To Use**
- Searched with `GET https://api.freetouse.com/v3/music/tracks/search?query=<artist>`.
- Credited only results whose `artists[].name` exactly matched.
- Compared all 59 Free To Use artists against the 60 names: 0 overlap.

**ccMixter**
- Searched with `api/query?f=json&search_type=match&s=<artist>`.
- Counted only results uploaded by the artist (`user_name` or `user_real_name` matched): 0.
- The file 403s were checked on five tracks, all refused. They load only with a ccmixter.org referrer, and faking that would be getting around their protection, so I didn't.

**Internet Archive**
- Used `advancedsearch.php`, then read each item's `licenseurl` and collections.

**The Rights Foundry and Niche DSP**
- Taken from their official documentation and websites. Only the public `/v1/health` endpoint was called.

**Player test**
- Headless Chrome on the AFTERGLOW origin.
- `<audio crossOrigin="anonymous">` → `MediaElementSource` → `AnalyserNode`.
- Checked metadata, playback, the seek position, and non-zero frequency data.
- Samples: Free To Use "Bahamas" (Zambolino); a ccMixter CC BY upload; an Internet Archive Live Music Archive recording.

## Recommendation

Do not integrate any of the five as a source for the 60 artists. None has verified rights to their recordings.

If AFTERGLOW wants a licensed full-length catalogue that plays in its own player with live lights, Free To Use is the only one tested that does it.
- **Personal or non-commercial use:** within its free licence.
- **Public commercial site:** needs its paid Commercial Plan. Confirm the plan's price and that it covers streaming to the public before integrating.

The Rights Foundry is the next candidate for a licensed independent catalogue. Integrate it only after confirming in writing that a public app may stream full tracks to listeners; today the docs describe audition previews and sync licences.

## Sources

- [Free To Use API](https://freetouse.com/api) · [Free To Use licence](https://freetouse.com/license) · [FAQ](https://freetouse.com/faq) · [API blog post](https://freetouse.com/blog/royalty-free-music-api-for-the-apps-you-build)
- [The Rights Foundry](https://therightsfoundry.com/) · [API docs](https://docs.therightsfoundry.com/) · [Music API for apps](https://therightsfoundry.com/blog/music-api-licensed-music-for-apps/)
- [Niche DSP](https://nichedsp.com/) · [AlphaState](https://www.alphastate.com/)
- [ccMixter Query API](https://ccmixter.org/query-api) · [ccMixter about](https://ccmixter.org/about) · [ccPlus licence](https://ccmixter.org/ccplus-license-details.pdf)
- Internet Archive advanced search and metadata APIs (archive.org)
