# Afterglow Music Library: Report

**Built and checked:** 14 November 2026. Every number below is computed from `server/catalog/catalog.json`, from a live re-check, or from the test runs listed at the end.

## Summary

| | |
|---|---|
| Artists | **60** (all 60 requested; 0 failures) |
| Songs | **882**, between 10 and 15 per artist |
| Verified songs | **882** (all) |
| Songs with a working 30-second preview (play here, drive the lights) | **882** |
| Songs with Apple's official embed player | **882** |
| External-only songs (no preview) | **0** |
| Songs needing your own upload to be playable at all | **0** (full-length playback still needs Apple Music or your own file; see below) |
| Albums | **523** |
| Songs with direct Spotify links | **0** (no Spotify API keys configured; Spotify and YouTube open as searches) |
| Missing artwork / duration / preview / Apple Music link | **0 / 0 / 0 / 0** |
| Live re-check, one song per artist | Apple Music pages **60/60**, previews **60/60**, embeds **60/60** loaded |

## 1. What was there before, and what changed

**Backup:** the previous library code is saved in `backup/2026-11-14-before-music-library/` (13 files).

| Found | What it was | Now |
|---|---|---|
| "Play the demo" | "Neon Nocturne", an instrumental synthesised in the browser and offered as the first thing to play | A small "Test the lights with a generated tone" link under the start screen. It's a lighting test, not a library song. |
| Discover tab | Opened on Openverse "ambient" Creative-Commons instrumentals | Renamed **Free music**, with a note that it's independent CC music. It's no longer the default library. |
| Artists | 4 themed artist pages (real Apple previews) | Kept. Each links from the new library's artist page as "Themed page". |
| Fake metadata, renamed files, fake URLs | None found | — |
| Your data | No favourites or playlists existed yet. Uploads are session-only. Saved lyrics and settings live in localStorage | Untouched. Favourites, playlists and history are new and stored separately (`afterglow:library:v1`). An unreadable store is copied aside before starting fresh, never deleted. |

## 2. Where the songs come from

- **Songs, albums, artwork, previews, Apple Music links:** Apple's iTunes Search API. It's official, keyless, and requests are spaced to respect Apple's ~20 requests/minute guidance.
- **Songs per artist:** Apple's search results for the artist plus the artist's own song list. Only songs Apple credits to the artist are kept, including collaborations, which are listed once. Karaoke, instrumental, sped-up, tribute and DJ-mix entries are dropped. When Apple has several versions of a song, the original recording wins over remixes and live takes.
- **Checks on every song before it's marked verified:**
  - **Artist:** the exact name exists in Apple's catalogue, with the expected genre where names collide.
  - **Artwork:** the URL returns an image.
  - **Preview:** the URL returns audio.
  - **Link:** the Apple Music URL is well-formed.
  - **Embed:** one embed per artist loads.

  A song failing a check would be marked "partial"; none did.

### Popularity order: what it is, and what it isn't

Apple doesn't publish play counts, and I didn't invent any.

**The order:** the number of different releases in Apple's catalogue that carry the song. Hits reappear on singles, albums, deluxe editions, greatest-hits records and soundtracks; deep cuts appear once.

**Why not Apple's own search order:** I tested it first and rejected it. Its top three for Eminem were "313", "Tonite" and "Infinite" from a 1996 EP. By release count, Eminem now opens with Lose Yourself, Stan and Without Me.

**Other sources tried:**
- **Deezer:** returned empty track data from this network.
- **ListenBrainz:** real listen counts, but it now requires a token, and I didn't work around that. Add a free `LISTENBRAINZ_TOKEN` to `server/.env` and the build uses it automatically.
- **Spotify:** with `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`, it adds direct track links and popularity.

**Labelling:** each song records which signal ordered it (`popularity.source`), and the artist pages say so.

## 3. How each song plays

| Type | Count | What happens |
|---|---|---|
| **Preview** (authorised) | 882 | Apple's 30-second preview plays in Afterglow's own engine. Apple serves it with CORS, so the lights and visualizer analyse it live (tested: analysis "full", light level moving). |
| **Official embed** | 882 available | "Apple Music player here" in each song's menu opens Apple's official embed: the full song for signed-in subscribers, a preview otherwise. Its audio stays inside Apple's player, so the lights can't follow it. The player says so. |
| **External** | every song | Full song in Apple Music. Spotify and YouTube open as searches, never as fake track links. |
| **Your own files** | — | Upload MP3, WAV, FLAC, M4A… (Files). Full length, analysed, transcribed if needed. |
| **Full authorised streaming in Afterglow** | 0 | Not possible without a licence. Nothing pretends otherwise. |

**Lyrics on previews:** a preview starts somewhere inside the song, so full-song timestamps don't fit it. Afterglow listens to the clip with the local speech recogniser and matches the meaningful words, in order, against the synced lyrics. It only shifts the lyrics when one position clearly wins; otherwise they show as plain text, labelled. Results are cached per song, and the next queued preview is prepared in the background.

Checked against what's actually sung, on 20 popular songs:

| Result | Songs |
|---|---|
| **Synced and verified correct** (the line on screen matches the line heard) | Lose Yourself, Set Fire to the Rain, Yellow, bad guy, As It Was, Levitating, Shape of You, Grenade, drivers license, Believer, One Dance, Kill Bill (12) |
| Shown as plain text (couldn't be placed confidently) | Sunflower, Royals and Lucid Dreams (repeated chorus); Do I Wanna Know? and Summertime Sadness (instrumental opening); Blinding Lights, HUMBLE. and Espresso (too few recognisable words) (8) |
| **Synced but wrong** | **0** |

Kill Bill's automated score was low because the recogniser misheard several lines, but its readable lines matched ("She charged at me" ↔ "…when she charged at me"). Two earlier, looser versions of the matcher put Yellow and Royals at the wrong point; both rules were tightened until they didn't. Syncing usually takes 5–12 seconds (up to about 25 s when a second listening pass is needed), and is instant for a song heard before.

## 4. The library

- **Screens:** Home, Discover, All songs, Artists, Albums, Most popular, Recently added, Favourites, My playlists. Press **L**, or **Library** in the header.
- **Genre collections:** Hip-Hop, Rap, R&B, Alternative, Indie, Pop, Electronic, Rock, International ("International" = artists from outside the US). Electronic is small: only Dua Lipa is tagged, plus songs Apple files under Dance/Electronic.
- **Home shelves:** each is built from catalogue data, never random.
  - **Trending Hip-Hop:** the newest release among each hip-hop artist's top songs.
  - **Popular Rap:** each rapper's #1.
  - **Late Night R&B:** the top R&B songs.
  - **Alternative Essentials:** the top alternative songs.
  - **Indie Discoveries:** songs ranked 4–10 for each indie artist.
  - **Popular International Music:** top songs by artists from outside the US.
  - **Your recently played:** from your history.
  - **Similar artists:** artists sharing genres with what you last played.
  - **New releases:** the latest albums.
- **Search:** your library first (title, artist, album, genre), then live results from Apple's whole catalogue (songs, artists, albums).
- **Add an artist:** from Discover, any artist can be added; they're built and verified the same way in about 15 seconds, saved in `server/catalog/catalog-added.json`, and removable.
- **Artist pages:** name, picture, popular songs, albums, track lists, durations, playback badges, and Apple Music and Spotify links. The picture is the cover of their latest album, because Apple's API has no artist photos.

Screenshots: [home](docs/library/home.jpg) · [artist](docs/library/artist.jpg) · [search](docs/library/search.jpg) · [playlist](docs/library/playlist.jpg) · [embed](docs/library/embed.jpg) · [visualizer](docs/library/visualizer.jpg)

## 5. Catalogue structure

Each song in `server/catalog/catalog.json` has:
- **Identity:** `id`, `title`, `artist`, `artistSlug`, `album`, `albumId`, `releaseDate`, `year`, `duration`, `artwork`, `explicit`, `genre`.
- **Source and links:** `provider` (`apple`), `providerTrackId`, `appleMusicUrl`, `embedUrl`, `spotifyUrl` (null without keys), `spotifySearchUrl`, `youtubeUrl` (null: no verified per-track YouTube source), `youtubeSearchUrl`, `previewUrl`.
- **Playback and trust:** `playbackType` (`preview` or `external`), `popularity` {`source`, `rank`, `releases`}, `verification` {`status`, `checkedAt`, `checks`}.

To rebuild: `npm run catalog:build`. It resumes if interrupted; add `--fresh` to start over or slugs to rebuild single artists. A full build takes about 15–18 minutes.

## 6. What was missing or failed

- **Build failures:** none. Missing artwork, durations, previews or Apple links: none.
- **Fewer than 15 songs** (because collaborations are listed once, under the first credited artist): Metro Boomin 10, Lil Wayne 14, JAŸ-Z 14, Childish Gambino 14, JID 14, Lil Uzi Vert 14, The Weeknd 13, Joji 14, Ed Sheeran 14, Imagine Dragons 13, LINKIN PARK 14, Ariana Grande 14. All of these songs still appear on every credited artist's page.
- **Names as Apple spells them:** JAŸ-Z, GIVĒON, LINKIN PARK.
- **No direct Spotify or YouTube links** without API keys; search links instead.
- **Popularity is a proxy** (release count), as explained above.
- **Hindi and other non-English catalogue artists:** none requested, so none built. Any can be added from Discover.

## 7. Tests (final build)

| Suite | Result |
|---|---|
| **Library, end to end** (new) | **25/25** |
| Lyrics sync | **24/24** |
| Views, lyrics, artists, settings | **44/44** |
| Playback, sources, lighting | **35/35** |
| Hindi lookups and transcription | **8/9** |
| Preview lyric alignment, 20 songs | **12 synced (all correct) · 8 text · 0 wrong** |
| `npm run build` | passes |

**What the library test covers:**
- the stage leads with the library, not a demo;
- 60 artists with at least 10 songs each, and no duplicates;
- a preview plays through the engine, with live analysis and moving lights;
- the title and artist show;
- the visualizer runs;
- preview lyrics are synced only when lined up;
- artist and album pages;
- search, including genre search;
- favourites and playlists survive a reload;
- the Apple Music embed opens;
- adding and removing an artist;
- no page errors.

**Changed expectations in older tests:** "Discover" is now "Free music", the demo button is now a lighting-test link, and **L** opens the library. The old rule that preview lyrics are never synced became "synced only when lined up by listening".

**The 8/9 failure:** on a fresh 3-minute transcription, the word "give" wasn't recognised in one of six repeats. The same check failed this way before these changes; transcription results depend on where playback was when the job started.

## 8. Artists and their top songs

**Hip-hop and rap**

| Artist | Songs | Albums | Top three (by Apple release count) |
|---|---|---|---|
| Drake | 15 | 12 | One Dance (feat. Wizkid & Kyla) · Toosie Slide · Finesse |
| Kendrick Lamar | 15 | 10 | HUMBLE. · Money Trees (feat. Jay Rock) · family ties |
| Kanye West | 15 | 12 | Forever · Heartless · Love Lockdown |
| Travis Scott | 15 | 5 | goosebumps · FRANCHISE (feat. Young Thug & M.I.A.) · MELTDOWN (feat. Drake) |
| Future | 15 | 12 | Where Ya At (feat. Drake) · I Won (feat. Kanye West) · WAIT FOR U (feat. Drake & Tems) |
| J. Cole | 15 | 12 | MIDDLE CHILD · Shea Butter Baby · Intro |
| Tyler, The Creator | 15 | 12 | Sticky (feat. GloRilla, Sexyy Red & Lil Wayne) · Like Him (feat. Lola Young) · St. Chroma (feat. Daniel Caesar) |
| Eminem | 15 | 12 | Lose Yourself · Stan (feat. Dido) · Without Me |
| 21 Savage | 15 | 11 | Good Good · Creepin' · WTF GOIN |
| Metro Boomin | 10 | 11 | Too Many Nights (feat. Don Toliver) · Ghostface Killers (feat. Travis Scott) · Call Me |
| Lil Wayne | 14 | 12 | How To Love · Dark Side of the Moon (feat. Nicki Minaj) · Right Above It (feat. Drake) |
| JAŸ-Z | 14 | 12 | Numb / Encore · Empire State Of Mind (feat. Alicia Keys) · Run This Town (feat. Rihanna & Kanye West) |
| Nas | 15 | 12 | The World Is Yours · Hate Me Now (feat. Diddy) · Street Dreams |
| A$AP Rocky | 15 | 5 | M'$ (feat. Lil Wayne) · Energy · Everyday (feat. Rod Stewart x Miguel x Mark Ronson) |
| Playboi Carti | 15 | 5 | Timeless · Miss The Rage · I LUV IT |
| Don Toliver | 15 | 7 | Lemonade (feat. NAV) · BANDIT · Private Landing (feat. Justin Bieber & Future) |
| Childish Gambino | 14 | 8 | This Is America · Heartbeat · V. 3005 |
| Juice WRLD | 15 | 7 | Lucid Dreams · Hate Me · Come & Go |
| XXXTENTACION | 15 | 8 | introduction · Look At Me! · whoa (mind in awe) |
| Post Malone | 15 | 11 | I Had Some Help (feat. Morgan Wallen) · Wow. · Sunflower (Spider-Man: Into the Spider-Verse) |
| Central Cee | 15 | 6 | BAND4BAND · Did It First · Which One |
| JID | 14 | 5 | Enemy (From Arcane: League of Legends) · Surround Sound (feat. 21 Savage & Baby Tate) · Bodies |
| Lil Uzi Vert | 14 | 9 | The Way Life Goes (feat. Oh Wonder) · Neon Guts (feat. Pharrell Williams) · Sauce It Up |
| Nicki Minaj | 15 | 9 | Super Freaky Girl · Bang Bang (Bonus Track) · Starships |
| Doja Cat | 15 | 6 | Say So · Paint The Town Red · Streets |

**R&B and alternative**

| Artist | Songs | Albums | Top three (by Apple release count) |
|---|---|---|---|
| The Weeknd | 13 | 12 | Blinding Lights · Save Your Tears · Take My Breath |
| Frank Ocean | 15 | 2 | Thinkin Bout You · Novacane · In My Room |
| SZA | 15 | 4 | Kill Bill (feat. Doja Cat) · Snooze · Open Arms (just SZA) |
| Brent Faiyaz | 15 | 10 | have to. · butterflies. · four seasons. |
| Daniel Caesar | 15 | 5 | Do You Like Me? · Let Me Go · Get You (feat. Kali Uchis) |
| PARTYNEXTDOOR | 15 | 11 | R e s e n t m e n t · Excitement · LOYAL (feat. Drake) |
| Steve Lacy | 15 | 4 | Bad Habit · Live Without Your Love · Monk's Dream |
| GIVĒON | 15 | 5 | Heartbreak Anniversary · Like I Want You · Last Heartbreak Song |
| Miguel | 15 | 5 | Adorn · Coffee · Sky Walker (feat. Travis Scott) |
| Joji | 14 | 5 | PIXELATED KISSES · SLOW DANCING IN THE DARK · YEAH RIGHT |
| The Neighbourhood | 15 | 8 | Sweater Weather · Private · Softcore |
| Arctic Monkeys | 15 | 9 | R U Mine? · I Bet You Look Good on the Dancefloor · Do I Wanna Know? |
| Chase Atlantic | 15 | 4 | Swim · Into It · Consume (feat. GOON DES GARCONS*) |
| Lana Del Rey | 15 | 11 | Summertime Sadness · Blue Jeans · Young and Beautiful |
| Billie Eilish | 15 | 5 | ocean eyes · bad guy · lovely |
| Rihanna | 15 | 12 | Diamonds · We Found Love (feat. Calvin Harris) · Where Have You Been |
| Beyoncé | 15 | 12 | Single Ladies (Put a Ring on It) · Check On It (feat. Bun B & Slim Thug) · Halo |
| Justin Bieber | 15 | 12 | Holy (feat. Chance the Rapper) · Peaches (feat. Daniel Caesar & GIVĒON) · Ghost |
| Adele | 15 | 4 | Rolling in the Deep · Make You Feel My Love · Set Fire to the Rain |
| Bruno Mars | 15 | 5 | Die With A Smile · Just the Way You Are · Grenade |

**Pop and international**

| Artist | Songs | Albums | Top three (by Apple release count) |
|---|---|---|---|
| Taylor Swift | 15 | 12 | Bad Blood · Anti-Hero (feat. Bleachers) · All Too Well |
| The 1975 | 15 | 10 | The 1975 · Chocolate · Robbers |
| Harry Styles | 15 | 4 | As It Was · Sign of the Times · Coming Up Roses |
| Dua Lipa | 15 | 12 | Levitating · Cold Heart (PNAU Remix) · Physical |
| Ed Sheeran | 14 | 12 | Bad Habits · Shivers · Don't |
| Olivia Rodrigo | 15 | 9 | good 4 u · drivers license · love is embarrassing |
| Coldplay | 15 | 12 | My Universe · Yellow · Viva La Vida |
| Imagine Dragons | 13 | 12 | Radioactive (feat. Kendrick Lamar) · Demons · Believer |
| OneRepublic | 15 | 10 | I Lived · Counting Stars · If I Lose Myself (Alesso vs OneRepublic) |
| LINKIN PARK | 14 | 12 | What I've Done · Leave Out All the Rest · Shadow of the Day |
| Cigarettes After Sex | 15 | 3 | Apocalypse · K. · Sweet |
| Radiohead | 15 | 12 | Let Down · No Surprises · Karma Police |
| Lorde | 15 | 5 | Girl, so confusing featuring lorde · Team · Ribs |
| Ariana Grande | 14 | 12 | 34+35 · we can't be friends (wait for your love) · Into You |
| Sabrina Carpenter | 15 | 10 | Espresso · Manchild · skinny dipping |
