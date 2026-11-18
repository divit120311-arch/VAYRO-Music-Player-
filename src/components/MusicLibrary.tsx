import { useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, AudioLines, Compass, ExternalLink, FolderOpen, Link2, ListMusic, Loader2, Play, Plus, Trash2, Upload, X,
} from 'lucide-react';
import { useStore } from '../store';
import { closeLibrary, openLibrary, openMusic, uiStore, type LibraryTab } from '../state/ui';
import { usePlayer, playNow, jumpTo, removeFromQueue, clearQueue } from '../hooks/useAudioPlayer';
import { parseAudioUrl, resolveAudioUrl } from '../services/audioUrlService';
import { trackFromProviderLink } from '../services/fullSources';
import type { Track } from '../types/music';
import { Artwork, IconButton, cx, formatTime } from './ui';

const TABS: { id: LibraryTab; label: string; icon: typeof Compass }[] = [
  { id: 'link', label: 'Link', icon: Link2 },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'queue', label: 'Queue', icon: ListMusic },
];

function TrackRow({ track, onPlay, onAdd, active, index, trailing }: {
  track: Track; onPlay: () => void; onAdd?: () => void; active?: boolean; index?: number; trailing?: React.ReactNode;
}) {
  return (
    <li
      className={cx(
        'group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors',
        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.035]',
        !track.playable && 'opacity-50',
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        disabled={!track.playable}
        aria-label={`Play ${track.title} by ${track.artist}`}
        className="relative h-11 w-11 shrink-0"
      >
        <Artwork src={track.artwork} alt="" className="h-11 w-11" rounded="rounded-[9px]" />
        <span className={cx('absolute inset-0 flex items-center justify-center rounded-[9px] bg-black/55 transition-opacity', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
          {active ? <AudioLines size={16} className="text-ink" /> : <Play size={15} fill="currentColor" className="ml-0.5 text-ink" />}
        </span>
      </button>
      <button type="button" onClick={onPlay} disabled={!track.playable} className="min-w-0 flex-1 text-left">
        <p className={cx('truncate text-[13px] font-medium', active ? 'text-ink' : 'text-ink/90')}>
          {index !== undefined && <span className="tabular mr-2 font-mono text-[11px] text-ink-4">{String(index + 1).padStart(2, '0')}</span>}
          {track.title}
        </p>
        <p className="truncate text-[11.5px] text-ink-3">
          {track.artist}
          {track.license && <span className="text-ink-4"> · {track.license.name}</span>}
        </p>
      </button>
      {track.duration ? <span className="tabular shrink-0 font-mono text-[11px] text-ink-3">{formatTime(track.duration)}</span> : null}
      {track.pageUrl && track.provider !== 'url' && track.provider !== 'local' && (
        <a
          href={track.pageUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${track.title} on its source site`}
          title="Source & licence"
          className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-white/[0.06] hover:text-ink group-hover:flex"
        >
          <ExternalLink size={13} />
        </a>
      )}
      {onAdd && (
        <IconButton label="Add to queue" size="sm" onClick={onAdd} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" disabled={!track.playable}>
          <Plus size={15} />
        </IconButton>
      )}
      {trailing}
    </li>
  );
}

// ---------------------------------------------------------------------------- link
function LinkTab() {
  const backendOk = usePlayer((s) => s.backend.ok);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerLink = /open\.spotify\.com\/(?:intl-[a-z]+\/)?track\/|spotify:track:/.test(value) ? 'spotify' : null;
  const hint = !value.trim()
    ? null
    : providerLink === 'spotify'
      ? { ok: true as const, url: value, title: '', note: 'Spotify track: plays in full with a connected Spotify Premium account.' }
      : parseAudioUrl(value);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const viaProvider = providerLink ? await trackFromProviderLink(value).catch((er) => ({ ok: false as const, error: (er as Error).message })) : null;
    if (viaProvider) {
      setBusy(false);
      if (!viaProvider.ok) return setError(viaProvider.error);
      playNow(viaProvider.track);
      setValue('');
      return;
    }
    const res = await resolveAudioUrl(value, backendOk);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    playNow(res.track);
    setValue('');
  };

  return (
    <div data-scroll-main className="scroll-quiet flex-1 overflow-y-auto px-4">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <label htmlFor="audio-url" className="text-[12.5px] text-ink-2">
          Audio file or Spotify track link
        </label>
        <div className="relative">
          <Link2 size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            id="audio-url"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="https://example.com/track.mp3"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className={cx(
              'h-11 w-full rounded-xl bg-white/[0.045] pl-10 pr-3 font-mono text-[12.5px] text-ink ring-1 outline-none placeholder:text-ink-4',
              error || (hint && !hint.ok) ? 'ring-red-400/30' : 'ring-line focus:ring-line-2',
            )}
          />
        </div>
        {(error || (hint && !hint.ok)) && (
          <p role="alert" className="flex gap-2 text-[12px] leading-relaxed text-red-200/85">
            <AlertTriangle size={13} className="mt-[3px] shrink-0" />
            {error ?? (hint && !hint.ok ? hint.error : '')}
          </p>
        )}
        {hint?.ok && hint.note && !error && <p className="text-[12px] text-ink-3">{hint.note}</p>}
        <button
          type="submit"
          disabled={busy || !value.trim() || (hint !== null && !hint.ok)}
          className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-ink text-[13px] font-semibold text-black transition-opacity disabled:opacity-35"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
          {busy ? 'Checking link…' : 'Load & play'}
        </button>
      </form>

      <div className="mt-6 space-y-3 rounded-2xl bg-white/[0.025] p-4 text-[12px] leading-relaxed text-ink-3 ring-1 ring-line">
        <p className="font-medium text-ink-2">What works</p>
        <p>Direct links to MP3, AAC/M4A, OGG/Opus, WAV, FLAC or WebM audio files and simple HTTP streams.</p>
        <p>
          If the host doesn’t send CORS headers, the browser won’t let Web Audio read the samples. Vayro then relays the
          file through its own server so the lights can still react; if that fails too, it plays without reactive lighting and tells you.
        </p>
        <p className="font-medium text-ink-2">Spotify</p>
        <p>
          A Spotify track link plays in full through Spotify’s own player with a connected Premium account (Settings → Full songs).
          Its audio stays inside that player: Vayro never extracts or downloads it.
        </p>
        <p className="font-medium text-ink-2">What doesn’t</p>
        <p>
          YouTube, Apple Music, SoundCloud, TIDAL, Deezer and similar links are player pages protected by DRM and platform terms. They aren’t
          audio files, and Vayro won’t try to extract them.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------- files
function FilesTab({ onOpenFiles }: { onOpenFiles: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);
  const local = queue.filter((t) => t.provider === 'local');
  return (
    <div data-scroll-main className="scroll-quiet flex-1 overflow-y-auto px-4">
      <button
        type="button"
        onClick={onOpenFiles}
        className="group flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-line-2 px-4 py-9 text-center transition-colors hover:border-white/25 hover:bg-white/[0.02]"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.05] text-ink-2 transition-colors group-hover:text-ink">
          <Upload size={18} />
        </span>
        <span className="text-[13px] font-medium text-ink">Choose audio files</span>
        <span className="text-[12px] text-ink-3">or drag & drop them anywhere · MP3, WAV, OGG, M4A, FLAC…</span>
      </button>
      <p className="mt-3 text-[11.5px] text-ink-3">Files stay on your device — nothing is uploaded to a server.</p>
      {local.length > 0 && (
        <>
          <h4 className="mb-1 mt-5 px-2 text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink-3">Your files</h4>
          <ul className="-mx-2 flex flex-col gap-0.5 pb-4">
            {local.map((t) => (
              <TrackRow key={t.id} track={t} active={t.id === currentId} onPlay={() => jumpTo(queue.indexOf(t))} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------- queue
function QueueTab() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  if (!queue.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
        <ListMusic size={22} className="text-ink-3" />
        <p className="text-[13px] text-ink-2">Your queue is empty</p>
        <p className="text-[12px] text-ink-3">Add songs from the library, a link, or your files.</p>
        <button type="button" onClick={() => openMusic('home')} className="mt-2 rounded-full px-4 py-1.5 text-[12px] font-medium text-ink ring-1 ring-line-2 hover:bg-white/[0.05]">
          Browse the library
        </button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-5 pb-2 text-[12px] text-ink-3">
        <span>
          {queue.length} track{queue.length === 1 ? '' : 's'}
        </span>
        <button type="button" onClick={clearQueue} className="inline-flex items-center gap-1.5 hover:text-ink">
          <Trash2 size={12} /> Clear
        </button>
      </div>
      <ul data-scroll-main className="scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {queue.map((t, i) => (
          <TrackRow
            key={t.id}
            track={t}
            index={i}
            active={i === index}
            onPlay={() => jumpTo(i)}
            trailing={
              <IconButton label={`Remove ${t.title} from queue`} size="sm" onClick={() => removeFromQueue(t.id)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                <X size={14} />
              </IconButton>
            }
          />
        ))}
      </ul>
    </div>
  );
}

export function MusicLibrary({ onOpenFiles }: { onOpenFiles: () => void }) {
  const tab = useStore(uiStore, (s) => s.library);
  const queueLen = usePlayer((s) => s.queue.length);
  const panelRef = useRef<HTMLElement>(null);

  return (
    <AnimatePresence>
      {tab && (
        <motion.aside
          ref={panelRef}
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Music library"
          className="glass fixed bottom-[164px] left-6 top-[var(--panel-top)] z-30 flex w-[420px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[22px]"
        >
          <div className="flex items-center justify-between px-4 pb-3 pt-4">
            <div role="tablist" aria-label="Library" className="flex gap-0.5">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  onClick={() => openLibrary(id)}
                  className={cx(
                    'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                    tab === id ? 'bg-white/[0.09] text-ink' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  <Icon size={13} />
                  {label}
                  {id === 'queue' && queueLen > 0 && <span className="tabular font-mono text-[10.5px] text-ink-3">{queueLen}</span>}
                </button>
              ))}
            </div>
            <IconButton label="Close library" size="sm" onClick={closeLibrary}>
              <X size={16} />
            </IconButton>
          </div>
          {tab === 'link' && <LinkTab />}
          {tab === 'files' && <FilesTab onOpenFiles={onOpenFiles} />}
          {tab === 'queue' && <QueueTab />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
