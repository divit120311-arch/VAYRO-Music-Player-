import { createStore } from '../store';
import { systemPlayer, type SystemState } from '../engine/systemPlayer';
import { currentTrack, playTracks, playerStore } from './player';
import { searchLive } from '../services/libraryCatalog';
import { updateSettings } from './settings';
import { notify } from './player';
import { CAN_FOLLOW_SPOTIFY } from '../config/downloads';
import { SpotifyTabReader, canShareTab, preloadReader, sameText, type TabStatus } from '../services/spotifyTab';
import { hasIndicScript, romanize } from '../utils/romanize';
import { closePanels, openMusic } from './ui';
import type { Track } from '../types/music';

/**
 * Now Playing mode: follow whatever this computer is playing in another app (the Spotify app —
 * free accounts too — Apple Music, a browser tab…) and show that song's synced lyrics here.
 *
 * Every ~500 ms the local server reports the song and its position (Windows' media session).
 * When the song changes, it becomes the current track (provider 'system'), so lyrics, lighting and
 * the player bar all follow it. Play/pause/seek/skip in Vayro are passed back to that app.
 * With Vayro's server on this computer (localhost): Windows' media session, or macOS's Spotify /
 * Music scripting. On the website: the listener shares their Spotify tab (or the Spotify app's
 * window) and Vayro reads its player bar on this computer (services/spotifyTab.ts).
 */
export type NowPlayingStatus = 'off' | 'starting' | 'waiting' | 'following' | 'unsupported' | 'error';

export const nowPlayingStore = createStore<{ status: NowPlayingStatus; app: string | null; message: string | null }>({
  status: 'off',
  app: null,
  message: null,
});

const POLL_MS = 500;
let timer: number | null = null;
let songKey = '';
const artCache = new Map<string, string | undefined>();

/** a readable name for the app Windows reports ("Spotify.exe" → "Spotify") */
export function appName(id?: string | null) {
  if (!id) return 'another app';
  if (/spotify/i.test(id)) return 'Spotify';
  if (/apple ?music|AppleInc\.AppleMusic/i.test(id) || id === 'Music') return 'Apple Music';
  if (/chrome/i.test(id)) return 'Chrome';
  if (/msedge|edge/i.test(id)) return 'Edge';
  if (/firefox/i.test(id)) return 'Firefox';
  if (/zune|ZuneMusic|Media/i.test(id)) return 'Media Player';
  return id.replace(/\.exe$/i, '').replace(/^.*[!.]/, '');
}

/** cover art for the song, from the Apple catalogue (best effort) */
async function artworkFor(artist: string, title: string): Promise<string | undefined> {
  const k = `${artist}|${title}`.toLowerCase();
  if (artCache.has(k)) return artCache.get(k);
  let art: string | undefined;
  try {
    const r = await searchLive(`${artist} ${title}`);
    const norm = (s: string) => s.toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
    const hit = r.tracks.find((t) => norm(t.title) === norm(title)) ?? r.tracks[0];
    art = hit?.artwork ?? undefined;
  } catch { /* no artwork */ }
  artCache.set(k, art);
  return art;
}

/**
 * A title read off the screen may hold a misread letter: take the catalogue's spelling when the
 * catalogue has a song that's clearly the same one (so the lyrics lookup gets the real name).
 */
async function canonical(artist: string, title: string, duration?: number): Promise<{ artist: string; title: string; art?: string }> {
  const lead = artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)[0] ?? '';
  // a Hindi / Punjabi title in its own script: the catalogue lists most of these in Latin letters
  const indic = hasIndicScript(title);
  const key = indic ? romanize(title) : title;
  try {
    const r = await searchLive(`${lead} ${key}`.trim());
    // "(Live)", "- Remix" …: versions; only take one when that's what was read
    const extra = (t: string) => /[([].*?[)\]]|\s-\s/.test(t);
    const bare = (t: string) => t.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '');
    // a converted title is spelt loosely (braun munde / Brown Munde): allow more difference
    const titled = r.tracks.filter((t) => sameText(bare(t.title), bare(key), indic ? 0.4 : 0.25));
    // a reading with an artist must match it: never swap in a cover by someone else
    const artists = (t: string) => t.split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?)\s*/i);
    const byArtist = lead ? titled.filter((t) => artists(t.artist).some((x) => sameText(x, lead))) : titled;
    // the song's length (read off the player bar) tells versions apart best: live, remix, radio edit…
    const lengthFits = (t: { duration?: number | null }) => !!duration && !!t.duration && Math.abs(t.duration - duration) <= 2;
    const hit =
      byArtist.find((t) => lengthFits(t) && extra(t.title) === extra(title)) ??
      byArtist.find(lengthFits) ??
      byArtist.find((t) => extra(t.title) === extra(title)) ??
      byArtist[0];
    if (hit) return { artist: hit.artist, title: hit.title, art: hit.artwork ?? undefined };
  } catch { /* offline: use what was read */ }
  return { artist, title };
}

/** "Artist 1, Artist 2" — some apps join artists with semicolons or slashes */
const cleanArtist = (a: string) => a.split(/\s*[;/]\s*/).filter(Boolean).join(', ');

async function follow(s: SystemState) {
  if (!s.title) return;
  const artist = cleanArtist(s.artist || '');
  const key = `${s.app}|${artist}|${s.title}`;
  systemPlayer.update(s);
  if (key === songKey) return;
  songKey = key;
  const duration = s.end && s.end > 0 ? s.end - (s.start ?? 0) : undefined;
  type Names = { artist: string; title: string; art?: string };
  const read: Names = { artist, title: s.title };
  const show = (names: Names) => {
    const track: Track = {
      id: `system:${names.artist}|${names.title}`.toLowerCase(),
      provider: 'system',
      source: appName(s.app),
      title: names.title,
      artist: names.artist || 'Unknown artist',
      artwork: names.art,
      album: s.album || undefined,
      duration,
      streamUrl: '',
      playable: true,
      playback: 'FULL_TRACK',
    };
    playTracks([track]);
    // loading a track resets the player's clock: re-apply the latest reading
    const latest = systemPlayer.state;
    systemPlayer.update({ ...(latest ?? s) });
    return track;
  };
  // A name read off the screen is checked against the catalogue (its spelling, and Latin letters for
  // Hindi / Punjabi titles). The lyrics don't wait long for that: after 2.5 s they start with the
  // name as read, and if the catalogue answers later with a better name, the song switches to it.
  const canon = s.fuzzy ? canonical(artist, s.title, duration) : null;
  const names = canon ? await Promise.race([canon, new Promise<Names>((r) => setTimeout(() => r(read), 2500))]) : read;
  if (songKey !== key) return; // the song changed again meanwhile
  let track = show(names);
  if (canon && names === read) {
    const better = await canon;
    if (songKey !== key) return;
    if (better.title !== read.title || better.artist !== read.artist) track = show(better);
    if (better.art) return;
  }
  if (names.art) return;
  // the cover arrives a moment later; swap it in without reloading the song
  const art = await artworkFor(track.artist, track.title);
  if (art && songKey === key) {
    const st = playerStore.getState();
    const q = st.queue.map((t) => (t.id === track.id ? { ...t, artwork: art } : t));
    playerStore.setState({ queue: q });
  }
}

async function poll() {
  try {
    const r = (await (await fetch('/api/nowplaying', { cache: 'no-store' })).json()) as { supported: boolean; state: SystemState | null; error?: string };
    if (timer === null) return; // turned off meanwhile
    if (!r.supported) {
      stopNowPlaying();
      notify(r.error ?? 'Syncing with Spotify isn’t supported on this computer.', 'error');
      return nowPlayingStore.setState({ status: 'unsupported', message: r.error ?? 'Not supported on this computer.' });
    }
    // the listener played something else in Vayro: leave Now Playing mode
    const cur = currentTrack();
    if (songKey && cur && cur.provider !== 'system') {
      stopNowPlaying();
      return;
    }
    const s = r.state;
    if (!s || s.none || !s.title) {
      nowPlayingStore.setState({ status: 'waiting', app: null, message: 'Play a song in Spotify (or any music app) on this computer.' });
      if (s?.none) systemPlayer.update({ status: 'Stopped' });
      return;
    }
    if (s.error) {
      if (nowPlayingStore.getState().status !== 'error') notify(s.error, 'error');
      return nowPlayingStore.setState({ status: 'error', message: s.error });
    }
    nowPlayingStore.setState({ status: 'following', app: appName(s.app), message: null });
    await follow({ ...s });
  } catch {
    if (timer === null) return;
    if (nowPlayingStore.getState().status !== 'error') notify('Can’t reach Vayro’s server, so Spotify can’t be followed. Is it running?', 'error');
    nowPlayingStore.setState({ status: 'error', message: 'Can’t reach Vayro’s server.' });
  }
}

export function startNowPlaying() {
  if (timer !== null) return;
  // On the website (Windows, Mac, any browser): a web page can't see the visitor's other apps, so it
  // can't follow the Spotify app. What it does: time-synced lyrics for what plays in Vayro — show
  // them for the current song, or open the Library to pick one.
  if (!CAN_FOLLOW_SPOTIFY) {
    if (canShareTab()) return startTabFollow();
    // phones: no tab sharing. Synced lyrics for what plays in Vayro instead
    if (currentTrack()) {
      updateSettings({ view: 'lyrics' });
      closePanels();
      notify('Lyrics in sync with the song playing in Vayro.', 'info');
    } else {
      openMusic('home');
      notify('Pick any song — its lyrics play in sync with it, right here in your browser.', 'info');
    }
    return;
  }
  songKey = '';
  // the point of following Spotify is its synced lyrics: show them
  updateSettings({ view: 'lyrics' });
  nowPlayingStore.setState({ status: 'starting', app: null, message: null });
  timer = window.setInterval(poll, POLL_MS);
  void poll();
}

// ---- the website: follow a shared Spotify tab ----------------------------------------------------
let reader: SpotifyTabReader | null = null;
const TAB_TIMER = -1; // `timer` marks Now Playing as on; there's no interval in this mode

function startTabFollow() {
  songKey = '';
  timer = TAB_TIMER;
  const pick = 'In the window that just opened, pick your Spotify tab (or the Spotify app’s window) and click Share.';
  nowPlayingStore.setState({ status: 'starting', app: null, message: pick });
  notify(pick, 'info');
  const onStatus = (st: TabStatus) => {
    if (reader === null) return;
    if (st.kind === 'ended') {
      stopNowPlaying();
      notify('You stopped sharing Spotify, so the lyrics stopped following it.', 'info');
    } else if (st.kind === 'preparing') {
      const message = 'Getting ready to read Spotify… The first time this downloads about 10 MB, so it can take a little while. Don’t click again.';
      nowPlayingStore.setState({ status: 'waiting', app: null, message });
      notify(message, 'info');
    } else if (st.kind === 'looking') {
      const message = 'Reading your Spotify tab… Play a song there if nothing is playing. The lyrics open here in a few seconds.';
      nowPlayingStore.setState({ status: 'waiting', app: null, message });
      notify(message, 'info');
    } else if (st.kind === 'notFound') {
      const message =
        'Vayro can’t find Spotify’s player bar in what you shared. Check that you shared the Spotify tab (not another one), a song is playing, and the window is wide enough to show the times on both sides of the progress bar.';
      nowPlayingStore.setState({ status: 'waiting', app: null, message });
      notify(message, 'error');
    } else {
      updateSettings({ view: 'lyrics' });
      closePanels();
      if (nowPlayingStore.getState().status !== 'following') notify('Found Spotify — lyrics are following it now.', 'info');
      nowPlayingStore.setState({ status: 'following', app: 'Spotify', message: null });
    }
  };
  const onState = (s: SystemState) => {
    if (reader === null) return;
    // the listener played something else in Vayro: stop following
    const cur = currentTrack();
    if (songKey && cur && cur.provider !== 'system') return stopNowPlaying();
    void follow(s);
  };
  const r = new SpotifyTabReader(onState, onStatus);
  reader = r;
  r.start().catch((e: Error) => {
    if (reader !== r) return;
    stopNowPlaying();
    notify(
      e?.name === 'NotAllowedError'
        ? 'Sharing was cancelled. To sync with Spotify, click Sync lyrics and share your Spotify tab.'
        : `Couldn’t start following Spotify: ${e?.message ?? e}`,
      e?.name === 'NotAllowedError' ? 'info' : 'error',
    );
  });
}

export function stopNowPlaying() {
  if (timer !== null && timer !== TAB_TIMER) window.clearInterval(timer);
  timer = null;
  reader?.stop();
  reader = null;
  songKey = '';
  nowPlayingStore.setState({ status: 'off', app: null, message: null });
}

/** start loading the Spotify-tab reader early (pointer over / focus on a Sync lyrics button) */
export function warmUpNowPlaying() {
  if (!CAN_FOLLOW_SPOTIFY && canShareTab()) void preloadReader().catch(() => {});
}

export const toggleNowPlaying = () => (timer === null ? startNowPlaying() : stopNowPlaying());
