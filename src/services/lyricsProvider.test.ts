import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLyricsLookups, lookupLyrics, withRetry } from './lyricsProvider';
import { ApiError } from './musicProvider';
import type { Track } from '../types/music';

const track = (over: Partial<Track> = {}): Track =>
  ({ id: 'x', provider: 'apple', title: 'One Dance', artist: 'Drake', streamUrl: '', playable: true, ...over }) as Track;
const lrc = '[00:03.44] Baby, I like your style\n[00:11.44] Grips on your waist';
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.restoreAllMocks();
  clearLyricsLookups();
});

describe('lyrics lookups', () => {
  it('shares one request between callers asking for the same song at once (no duplicates)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ found: true, syncedLyrics: lrc }));
    const [a, b] = await Promise.all([lookupLyrics(track(), 174, 'latin'), lookupLyrics(track(), 174, 'latin')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(a.kind).toBe('doc');
    expect(b.kind).toBe('doc');
    // and remembers it
    await lookupLyrics(track(), 174, 'latin');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps different versions apart (another length = another request)', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json({ found: true, syncedLyrics: lrc }));
    await lookupLyrics(track(), 174, 'latin');
    await lookupLyrics(track(), 253, 'latin');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('lets a caller give up (its song changed) without breaking the lookup for others', async () => {
    let release!: () => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((r) => (release = () => r(json({ found: true, syncedLyrics: lrc })))));
    const ac = new AbortController();
    const first = lookupLyrics(track(), 174, 'latin', ac.signal);
    const second = lookupLyrics(track(), 174, 'latin');
    ac.abort();
    await expect(first).rejects.toThrow(/Abort/);
    release();
    expect((await second).kind).toBe('doc');
  });

  it('never looks up a song read off a Spotify tab by its title alone', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const r = await lookupLyrics(track({ provider: 'system', artist: 'Unknown artist', title: 'Sensation' }), 168, 'latin');
    expect(r.kind).toBe('none');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('withRetry', () => {
  it('retries a temporary failure, then succeeds', async () => {
    let n = 0;
    const r = await withRetry(async () => {
      if (++n < 3) throw new ApiError('busy', undefined, 503);
      return 'ok';
    }, [1, 1]);
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });
  it('gives up after its retries (no endless loop) and never retries a definite answer', async () => {
    let n = 0;
    await expect(withRetry(async () => (n++, Promise.reject(new ApiError('down', 'backend_down'))), [1, 1])).rejects.toThrow('down');
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry(async () => (m++, Promise.reject(new ApiError('bad', undefined, 400))), [1, 1])).rejects.toThrow('bad');
    expect(m).toBe(1);
  });
});
