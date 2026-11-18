import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, Search, X } from 'lucide-react';
import { audioEngine } from '../../engine/audioEngine';
import { useCurrentTrack } from '../../hooks/useAudioPlayer';
import { cleanTitle, reliableArtist, searchLyrics, type LyricsCandidate } from '../../services/lyricsProvider';
import { pickLyrics } from '../../state/lyrics';
import { IconButton, cx } from '../ui';

const mmss = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '–');

/**
 * Pick the right lyrics yourself: search LRCLIB, see each version's length (vs. this file),
 * whether it's time-synced, its script (Roman / native, e.g. Hinglish vs. देवनागरी) and its first
 * lines. The choice is saved for this song on this device.
 */
export function LyricsSearch({ onClose }: { onClose: () => void }) {
  const track = useCurrentTrack();
  const initial = track ? [cleanTitle(track.title), reliableArtist(track.artist) ? track.artist : ''].filter(Boolean).join(' ') : '';
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<LyricsCandidate[] | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const ac = useRef<AbortController | null>(null);
  const duration = track?.duration || audioEngine.duration || 0;

  const run = async (query: string) => {
    if (!query.trim()) return;
    ac.current?.abort();
    const c = new AbortController();
    ac.current = c;
    setBusy(true);
    setErr(null);
    try {
      const r = await searchLyrics(query.trim(), duration, c.signal);
      if (!c.signal.aborted) setResults(r);
    } catch (e) {
      if (!c.signal.aborted) setErr((e as Error).message);
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    void run(initial);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      ac.current?.abort();
      window.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (id: number) => {
    setPicking(id);
    const e = await pickLyrics(id);
    setPicking(null);
    if (e) setErr(e);
    else onClose();
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        role="dialog"
        aria-label="Search lyrics"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[82vh] w-[min(680px,100%)] flex-col gap-3 rounded-[22px] p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">Search lyrics</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              From LRCLIB. Versions with the same length as this file ({mmss(duration)}) are listed first; those line up best.
            </p>
          </div>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(q);
          }}
          className="flex gap-2"
        >
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Song title (and artist)"
            aria-label="Song title and artist"
            className="h-10 flex-1 rounded-full bg-black/40 px-4 text-[13.5px] text-ink outline-none ring-1 ring-line focus:ring-line-2"
          />
          <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-semibold text-black">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
          </button>
        </form>
        {err && <p className="text-[12px] text-red-200/90">{err}</p>}
        <div className="scroll-quiet -mx-1 min-h-[120px] flex-1 overflow-y-auto px-1">
          {results && !results.length && <p className="py-8 text-center text-[13px] text-ink-3">Nothing found. Try just the song title, or a different spelling.</p>}
          <ul className="flex flex-col gap-1.5">
            {results?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => void choose(r.id)}
                  disabled={picking !== null}
                  className="flex w-full items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left ring-1 ring-transparent transition-colors hover:bg-white/[0.06] hover:ring-line disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">
                      {r.title} <span className="font-normal text-ink-3">· {r.artist}</span>
                    </p>
                    {r.preview.length > 0 && <p className="mt-0.5 truncate text-[12px] text-ink-2">{r.preview.join(' / ')}</p>}
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px]">
                      <span className={cx('rounded-full px-2 py-[1px] ring-1', r.synced ? 'text-emerald-200/90 ring-emerald-300/30' : 'text-ink-3 ring-line')}>
                        {r.wordSync ? 'Word-synced' : r.synced ? 'Time-synced' : 'Text only'}
                      </span>
                      <span className={cx('rounded-full px-2 py-[1px] ring-1', r.diff !== null && r.diff <= 2 ? 'text-emerald-200/90 ring-emerald-300/30' : 'text-ink-3 ring-line')}>
                        {mmss(r.duration)}
                        {r.diff !== null && (r.diff <= 2 ? ' · same length' : ` · ${r.diff}s off`)}
                      </span>
                      {r.script !== 'unknown' && <span className="rounded-full px-2 py-[1px] text-ink-3 ring-1 ring-line">{r.script === 'latin' ? 'Roman letters' : 'Native script'}</span>}
                    </div>
                  </div>
                  <span className="mt-1 flex h-6 w-6 flex-none items-center justify-center rounded-full text-ink-3">
                    {picking === r.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>
    </motion.div>
  );
}
