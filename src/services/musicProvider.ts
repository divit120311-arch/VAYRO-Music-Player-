import type { CatalogPage, ProviderId, Track } from '../types/music';

export interface SearchParams {
  q: string;
  genre: string;
  page: number;
}

export interface MusicProvider {
  id: Extract<ProviderId, 'openverse' | 'jamendo'>;
  name: string;
  description: string;
  homepage: string;
  search(params: SearchParams, signal?: AbortSignal): Promise<CatalogPage>;
}

export const GENRES = ['ambient', 'electronic', 'lofi', 'chillout', 'synthwave', 'jazz', 'hiphop', 'rock', 'classical', 'pop', 'cinematic', 'piano'];

export class ApiError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
  }
}

const BACKEND_DOWN = 'The Vayro API server is not reachable. Start everything with `npm run dev` (or `npm start` after a build).';

export async function apiJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(BACKEND_DOWN, 'backend_down');
  }
  const type = r.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    // the Vite proxy answers with an HTML/text 5xx when the API process is not running
    throw new ApiError(BACKEND_DOWN, 'backend_down', r.status);
  }
  const body = await r.json();
  if (!r.ok) throw new ApiError(body.error || `Request failed (${r.status}).`, body.code, r.status);
  return body as T;
}

export interface BackendHealth {
  ok: boolean;
  providers: { openverse: boolean; jamendo: boolean };
}

export async function checkBackend(): Promise<BackendHealth> {
  try {
    return await apiJson<BackendHealth>('/api/health', AbortSignal.timeout(4000));
  } catch {
    return { ok: false, providers: { openverse: false, jamendo: false } };
  }
}

export async function searchCatalog(provider: MusicProvider['id'], p: SearchParams, signal?: AbortSignal): Promise<CatalogPage> {
  const qs = new URLSearchParams({ q: p.q, genre: p.genre, page: String(p.page) });
  const page = await apiJson<CatalogPage>(`/api/catalog/${provider}?${qs}`, signal);
  page.tracks = page.tracks.map((t: Track) => ({
    ...t,
    // Jamendo's file storage does not grant CORS to arbitrary origins: go straight to our proxy.
    preferProxy: t.source === 'jamendo' || t.provider === 'jamendo',
  }));
  return page;
}
