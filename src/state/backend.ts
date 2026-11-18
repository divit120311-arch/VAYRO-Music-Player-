import { playerStore } from './player';
import { audioEngine } from '../engine/audioEngine';
import { checkBackend } from '../services/musicProvider';

/**
 * Is Vayro's API reachable? Trusts a good answer; otherwise asks again. One slow answer must not
 * count for the whole visit: on the website the API is a serverless function whose first request
 * after a quiet spell (a "cold start") can take several seconds, and a busy computer can be slow
 * to process the reply while the page is still starting.
 */
let inflight: Promise<boolean> | null = null;

export function ensureBackend(timeoutMs = 12_000): Promise<boolean> {
  if (playerStore.getState().backend.ok) return Promise.resolve(true);
  inflight ??= checkBackend(timeoutMs)
    .then((h) => {
      audioEngine.backendAvailable = h.ok;
      playerStore.setState({ backend: { checked: true, ok: h.ok, jamendo: h.providers.jamendo } });
      if (!h.ok) console.warn('[vayro] the API (/api/health) did not answer — library and lyrics need it');
      return h.ok;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
