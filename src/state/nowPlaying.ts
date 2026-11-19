import { createStore } from '../store';
import { systemPlayer, type SystemState } from '../engine/systemPlayer';
import { currentTrack, playTracks, playerStore } from './player';
import { searchLive } from '../services/libraryCatalog';
import { updateSettings } from './settings';
import { notify } from './player';
import { APP_PLATFORM, CAN_FOLLOW_SPOTIFY, type AppBuild } from '../config/downloads';
import { closePanels, openMusic } from './ui';
import type { Track } from '../types/music';

/**
 * Now Playing mode: follow whatever this computer is playing in another app (the Spotify app —
 * free accounts too — Apple Music, a browser tab…) and show that song's synced lyrics here.
 *
 * Every ~500 ms the local server reports the song and its position (Windows' media session).
 * When the song changes, it becomes the current track (provider 'system'), so lyrics, lighting and
 * the player bar all follow it. Play/pause/seek/skip in Vayro are passed back to that app.
 * Only works on the computer running Vayro's server: Windows (media session) or macOS (the
 * Spotify / Music apps' scripting interface).
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
  const track: Track = {
    id: `system:${artist}|${s.title}`.toLowerCase(),
    provider: 'system',
    source: appName(s.app),
    title: s.title,
    artist: artist || 'Unknown artist',
    album: s.album || undefined,
    duration,
    streamUrl: '',
    playable: true,
    playback: 'FULL_TRACK',
  };
  playTracks([track]);
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
  // On the website: a web page can't see the visitor's other apps, so it can't follow the Spotify
  // app. On a Mac or Windows PC, that's what the Vayro app is for: say so and open its download
  // menu (and still show synced lyrics for whatever plays in Vayro). Elsewhere (phones, Linux),
  // synced lyrics for songs played in Vayro.
  if (!CAN_FOLLOW_SPOTIFY) {
    const playing = !!currentTrack();
    if (playing) {
      updateSettings({ view: 'lyrics' });
      closePanels();
    }
    if (APP_PLATFORM) {
      // the start screen (with the Download button) shows only while nothing plays: then open its
      // menu; otherwise put the download right on the notice
      const get = (build: AppBuild) => () => void import('../components/MacDownload').then((m) => m.downloadApp(build));
      const actions = !playing
        ? undefined
        : APP_PLATFORM === 'Windows'
          ? [{ label: 'Download for Windows', run: get('windows') }]
          : [
              { label: 'Mac · Apple Silicon', run: get('appleSilicon') },
              { label: 'Mac · Intel', run: get('intel') },
            ];
      if (playing)
        notify(
          `To sync with the Spotify app, get the Vayro app for ${APP_PLATFORM} — websites can’t see your other apps. Meanwhile, lyrics follow the song playing in Vayro.`,
          'info',
          actions,
        );
      // the menu explains it itself (a notice would sit on top of the buttons around it)
      else window.dispatchEvent(new Event('vayro:need-app'));
    } else if (playing) {
      notify('Lyrics in sync with the song playing in Vayro.', 'info');
    } else {
      openMusic('home');
      notify('Pick any song — its lyrics play in sync with it.', 'info');
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

export function stopNowPlaying() {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  songKey = '';
  nowPlayingStore.setState({ status: 'off', app: null, message: null });
}

export const toggleNowPlaying = () => (timer === null ? startNowPlaying() : stopNowPlaying());
