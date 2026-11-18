import { createStore } from '../store';

/**
 * Spotify account connection: OAuth 2.0 Authorization Code flow with PKCE (Spotify's recommended
 * flow for browser apps — no client secret exists in the browser, and Vayro never sees the
 * listener's password: they sign in on accounts.spotify.com).
 *
 * Spotify's rules this follows:
 *  - redirect URIs must use the loopback IP (127.0.0.1), not "localhost";
 *  - full-track streaming (Web Playback SDK) needs a Spotify Premium account;
 *  - apps in development mode work only for the owner + up to 5 users they allowlist in the
 *    Spotify Developer Dashboard;
 *  - Spotify's developer terms don't allow syncing its recordings with lyrics, so Vayro turns
 *    lyrics off while Spotify plays.
 */
export type SpotifyStatus =
  | 'not-configured' // no SPOTIFY_CLIENT_ID on the server
  | 'disconnected'
  | 'connecting'
  | 'connected' // Premium: full tracks available
  | 'premium-required' // signed in, but streaming needs Premium
  | 'expired' // the refresh token was revoked: connect again
  | 'error';

interface Tokens { access: string; refresh: string; expires: number; scope: string }

export const spotifyStore = createStore<{
  status: SpotifyStatus;
  clientId: string | null;
  user: { name: string; product: string; country: string } | null;
  error: string | null;
}>({ status: 'not-configured', clientId: null, user: null, error: null });

const KEY = 'afterglow:spotify:v1';
const PKCE = 'afterglow:spotify:pkce';
const SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state', 'user-modify-playback-state'];
const set = spotifyStore.setState;

/** Spotify only accepts loopback IP literals for http redirects */
export const redirectUri = () => `http://127.0.0.1:${location.port || '80'}/`;

function readTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}
function writeTokens(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch { /* storage blocked: the connection lasts this session only */ }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function startSpotifyConnect() {
  const { clientId } = spotifyStore.getState();
  if (!clientId) return;
  // tokens are stored per origin: the whole flow must happen on 127.0.0.1
  if (location.hostname !== '127.0.0.1') {
    location.href = `${location.protocol}//127.0.0.1:${location.port}${location.pathname}?spotify=connect`;
    return;
  }
  const verifier = random(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random(16);
  sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES.join(' '),
  });
  set({ status: 'connecting', error: null });
  location.href = `https://accounts.spotify.com/authorize?${q}`;
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `Spotify sign-in failed (${r.status}).`), { code: j.error });
  const prev = readTokens();
  return { access: j.access_token, refresh: j.refresh_token ?? prev?.refresh ?? '', expires: Date.now() + (j.expires_in - 60) * 1000, scope: j.scope ?? prev?.scope ?? '' };
}

/** a valid access token (refreshed when needed), or null when not connected */
export async function spotifyToken(): Promise<string | null> {
  const t = readTokens();
  const { clientId } = spotifyStore.getState();
  if (!t || !clientId) return null;
  if (t.expires > Date.now()) return t.access;
  try {
    const n = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: clientId });
    writeTokens(n);
    return n.access;
  } catch (e) {
    if ((e as { code?: string }).code === 'invalid_grant') {
      writeTokens(null);
      set({ status: 'expired', user: null, error: 'Your Spotify sign-in expired or was revoked. Connect again.' });
    }
    return null;
  }
}

export async function spotifyApi<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const token = await spotifyToken();
  if (!token) return null;
  const r = await fetch(`https://api.spotify.com/v1${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 204) return null;
  if (r.status === 401) {
    // token rejected: force a refresh next time
    const t = readTokens();
    if (t) writeTokens({ ...t, expires: 0 });
    throw new Error('Spotify rejected the sign-in. Try again.');
  }
  if (r.status === 403) throw Object.assign(new Error('Spotify refused this request. Development-mode apps only work for accounts allowlisted in the Spotify Developer Dashboard (owner + 5 users).'), { status: 403 });
  if (r.status === 429) throw new Error('Spotify is rate-limiting requests. Try again in a moment.');
  if (!r.ok) throw new Error(`Spotify responded with HTTP ${r.status}.`);
  return (await r.json()) as T;
}

/** validate the stored sign-in against Spotify and record the account's plan */
async function checkAccount() {
  try {
    const me = await spotifyApi<{ display_name: string | null; product: string; country: string; id: string }>('/me');
    if (!me) return set({ status: 'disconnected', user: null });
    set({
      user: { name: me.display_name || me.id, product: me.product, country: me.country },
      status: me.product === 'premium' ? 'connected' : 'premium-required',
      error: null,
    });
  } catch (e) {
    set({ status: 'error', error: (e as Error).message });
  }
}

export function disconnectSpotify() {
  writeTokens(null);
  set({ status: spotifyStore.getState().clientId ? 'disconnected' : 'not-configured', user: null, error: null });
}

/** at startup: read the server config, finish a sign-in that just came back, restore a session */
export async function initSpotify() {
  let clientId: string | null = null;
  try {
    const r = await fetch('/api/config');
    clientId = (await r.json()).spotifyClientId ?? null;
  } catch { /* server not running */ }
  set({ clientId, status: clientId ? 'disconnected' : 'not-configured' });
  if (!clientId) return;
  const url = new URL(location.href);
  if (url.searchParams.get('spotify') === 'connect') {
    url.searchParams.delete('spotify');
    history.replaceState(null, '', url.toString());
    return startSpotifyConnect();
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');
  if (code || err) {
    for (const k of ['code', 'state', 'error']) url.searchParams.delete(k);
    history.replaceState(null, '', url.toString());
    if (err) return set({ status: 'disconnected', error: err === 'access_denied' ? 'Spotify connection was cancelled.' : `Spotify sign-in failed: ${err}` });
    let saved: { verifier: string; state: string } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(PKCE) || 'null');
    } catch { /* ignore */ }
    sessionStorage.removeItem(PKCE);
    if (!saved || saved.state !== state) return set({ status: 'error', error: 'The Spotify sign-in response didn’t match this session (state mismatch), so it was ignored.' });
    try {
      writeTokens(await tokenRequest({ grant_type: 'authorization_code', code: code!, redirect_uri: redirectUri(), client_id: clientId, code_verifier: saved.verifier }));
    } catch (e) {
      return set({ status: 'error', error: (e as Error).message });
    }
  }
  if (readTokens()) await checkAccount();
}

/** find the song on Spotify, in the listener's market: a playable URI, or why not */
export async function findOnSpotify(title: string, artist: string, duration?: number): Promise<{ uri: string; durationMs: number } | { unavailable: 'region' | 'not-found' } | null> {
  if (spotifyStore.getState().status !== 'connected') return null;
  const clean = title.replace(/\s*[([].*?[)\]]/g, '').trim();
  const j = await spotifyApi<{ tracks: { items: { uri: string; name: string; duration_ms: number; is_playable?: boolean; artists: { name: string }[] }[] } }>(
    `/search?${new URLSearchParams({ q: `track:${clean} artist:${artist.split(/\s*(?:,|&|feat\.?)\s*/i)[0]}`, type: 'track', limit: '8', market: 'from_token' })}`,
  );
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
  const cands = (j?.tracks.items ?? []).filter((t) => norm(t.name.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '')) === norm(clean));
  if (!cands.length) return { unavailable: 'not-found' };
  const best = [...cands].sort((a, b) => Math.abs(a.duration_ms / 1000 - (duration ?? 0)) - Math.abs(b.duration_ms / 1000 - (duration ?? 0)));
  const playable = best.find((t) => t.is_playable !== false);
  return playable ? { uri: playable.uri, durationMs: playable.duration_ms } : { unavailable: 'region' };
}
