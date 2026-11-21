import { useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AudioLines, ChevronLeft, ChevronRight, FileText, Loader2, Minus, Mic2, PencilLine, Plus, Power, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { useStore } from '../../store';
import {
  cancelTranscription, canTranscribe, lyricsStore, nudgeOffset, playWithoutWaiting, removeUserLyrics, resetOffset, retryLyrics, savedLyricsText, setUserLyrics, stepLine, transcribeCurrent,
} from '../../state/lyrics';
import { updateSettings } from '../../state/settings';
import { nowPlayingStore } from '../../state/nowPlaying';
import { useCurrentTrack, usePlayer, useSettings } from '../../hooks/useAudioPlayer';
import { LyricsSearch } from './LyricsSearch';
import { hasGurmukhi, hasIndicScript, romanize } from '../../utils/translit';
import type { LyricsStyle } from '../../types/lyrics';
import { PlainLyrics, SyncedLyrics } from './LyricsDisplay';
import { IconButton, cx } from '../ui';

export const LYRIC_STYLES: { id: LyricsStyle; name: string; blurb: string; group: 'reference' | 'line' | 'word' }[] = [
  { id: 'reel', name: 'Reel', blurb: 'Reference: one word at a time, next word waiting on a block', group: 'reference' },
  { id: 'overlay', name: 'Reel over art', blurb: 'Reference: the reel straight on full-bleed album art, white type, no blocks', group: 'reference' },
  { id: 'ring', name: 'Reel in a ring', blurb: 'Reference: the reel inside a circular frame, next word on a pale block', group: 'reference' },
  { id: 'kinetic', name: 'Stack', blurb: 'Reference: the line piles up word by word, newest on a block', group: 'reference' },
  { id: 'cinematic', name: 'Cinematic fade', blurb: 'Current line centred, previous drifts up, next waits below', group: 'line' },
  { id: 'scroll', name: 'Vertical scroll', blurb: 'A column of lines; the active one stays centred and lit', group: 'line' },
  { id: 'focus', name: 'Blur focus', blurb: 'Active line sharp, the others out of focus', group: 'line' },
  { id: 'minimal', name: 'Minimal', blurb: 'Only the current line, soft fades', group: 'line' },
  { id: 'glow', name: 'Ambient glow', blurb: 'Glowing type that breathes with the music', group: 'line' },
  { id: 'karaoke', name: 'Karaoke', blurb: 'Each word fills as it is sung (needs word timing)', group: 'word' },
  { id: 'reveal', name: 'Word reveal', blurb: 'Words appear as they are sung, never before', group: 'word' },
  { id: 'typewriter', name: 'Typewriter', blurb: 'Letters typed at the pace of the vocal', group: 'word' },
  { id: 'floating', name: 'Constellation', blurb: 'Reference: the line as a star chart, the sung word glowing', group: 'reference' },
];

function LyricsEditor({ onClose }: { onClose: () => void }) {
  // start from the saved text (e.g. a transcription) so mistakes can be fixed without losing timing
  const [text, setText] = useState(() => savedLyricsText() ?? '');
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const saved = useStore(lyricsStore, (s) => s.saved);
  const save = (t: string, source: 'file' | 'manual') => {
    const e = setUserLyrics(t, source);
    if (e) setErr(e);
    else onClose();
  };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Add lyrics"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 10, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="glass flex w-[min(620px,100%)] flex-col gap-3 rounded-[22px] p-5"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[15px] font-semibold">Add lyrics for this track</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Paste an <span className="font-mono">.lrc</span> (timestamped) or plain lyrics, or load a file. Saved only on this device.
            </p>
          </div>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
          spellCheck={false}
          placeholder={'[00:12.30]First line of the song\n[00:15.80]Second line…\n\n— or plain text without timestamps (shown unsynced)'}
          className="scroll-quiet h-[260px] resize-none rounded-xl bg-black/40 p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none ring-1 ring-line focus:ring-line-2"
        />
        {err && <p className="text-[12px] text-red-200/90">{err}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => file.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium ring-1 ring-line-2 hover:bg-white/[0.05]">
              <Upload size={14} /> Load .lrc / .txt
            </button>
            {saved && (
              <button
                type="button"
                onClick={() => {
                  removeUserLyrics();
                  onClose();
                }}
                className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium text-ink-2 ring-1 ring-line hover:text-ink"
              >
                <Trash2 size={14} /> Remove my lyrics
              </button>
            )}
          </div>
          <button type="button" disabled={!text.trim()} onClick={() => save(text, 'manual')} className="h-9 rounded-full bg-ink px-5 text-[13px] font-semibold text-black disabled:opacity-30">
            Save lyrics
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".lrc,.txt,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > 200_000) return setErr('That file is larger than 200 KB — is it really a lyrics file?');
            save(await f.text(), 'file');
          }}
        />
      </motion.div>
    </motion.div>
  );
}

function Empty({ icon, title, body, onEdit, retry, transcribe, onSearch }: { icon: React.ReactNode; title: string; body?: string; onEdit: () => void; retry?: boolean; transcribe?: boolean; onSearch?: () => void }) {
  return (
    <div className="flex max-w-[460px] flex-col items-center gap-3 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] text-ink-2 ring-1 ring-line">{icon}</span>
      <p className="text-[16px] font-semibold text-ink">{title}</p>
      {body && <p className="text-[13px] leading-relaxed text-ink-3">{body}</p>}
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onEdit} className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-black">
          <PencilLine size={14} /> Add lyrics / LRC
        </button>
        {onSearch && (
          <button type="button" onClick={onSearch} className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium ring-1 ring-line-2 hover:bg-white/[0.05]">
            <Search size={14} /> Search lyrics
          </button>
        )}
        {transcribe && (
          <button type="button" onClick={transcribeCurrent} className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium ring-1 ring-line-2 hover:bg-white/[0.05]">
            <AudioLines size={14} /> Transcribe from audio
          </button>
        )}
        {retry && (
          <button type="button" onClick={retryLyrics} className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-[12.5px] font-medium ring-1 ring-line-2 hover:bg-white/[0.05]">
            <Search size={14} /> Search again
          </button>
        )}
      </div>
    </div>
  );
}

// one-time download sizes (GPU: fp16 encoder + 4-bit decoder; CPU: 8-bit)
// one-time model downloads (8-bit Whisper; the local server and the browser fallback use the same files)
const MODEL_MB = { base: 77, small: 250 } as const;
const PHASE_LABEL = {
  cache: 'Checking for saved lyrics…',
  decode: 'Preparing the audio…',
  upload: 'Handing the audio to the transcriber…',
  model: 'Loading the speech model…',
  listen: 'Transcribing the vocals…',
} as const;
type Job = { phase: keyof typeof PHASE_LABEL; progress: number } | null;

function Transcribing({ job, onSearch }: { job: Job; onSearch: () => void }) {
  const phase = job?.phase ?? 'decode';
  const pct = Math.round((job?.progress ?? 0) * 100);
  const model = useSettings((x) => x.transcribeModel);
  const mb = MODEL_MB[model];
  return (
    <div className="flex w-[min(420px,86%)] flex-col items-center gap-3 text-center" role="status">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] text-ink-2 ring-1 ring-line">
        <AudioLines size={20} className="animate-pulse" />
      </span>
      <p className="text-[16px] font-semibold text-ink">Transcribing lyrics from your file</p>
      <p className="text-[13px] text-ink-3">
        {PHASE_LABEL[phase]} {phase !== 'decode' && <span className="tabular font-mono text-ink-2">{pct}%</span>}
      </p>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full origin-left rounded-full transition-transform duration-300"
          style={{ background: 'var(--glow-p)', transform: `scaleX(${phase === 'decode' ? 0.03 : Math.max(0.03, job?.progress ?? 0)})` }}
        />
      </div>
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        {phase === 'model' && <>First time only: about {mb} MB is downloaded and kept by your browser. </>}
        Lyrics appear section by section, starting where you are in the song. Your audio is never uploaded. A machine
        transcription mishears words, so if the song is known, <b className="font-semibold text-ink-2">Search lyrics</b> is faster and exact.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onSearch} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-4 text-[12px] font-semibold text-black">
          <Search size={13} /> Search lyrics instead
        </button>
        <button type="button" onClick={cancelTranscription} className="h-8 rounded-full px-4 text-[12px] font-medium text-ink-2 ring-1 ring-line hover:text-ink">
          Stop
        </button>
      </div>
    </div>
  );
}

/** Shown while a preview is held: its lyrics are being timed before the song starts. */
function SyncingLyrics({ waiting }: { waiting: boolean }) {
  return (
    <div className="flex w-[min(420px,86%)] flex-col items-center gap-3 text-center" role="status">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.05] text-ink-2 ring-1 ring-line">
        <Loader2 size={20} className="animate-spin" />
      </span>
      <p className="text-[16px] font-semibold text-ink">Syncing lyrics…</p>
      <p className="text-[13px] leading-relaxed text-ink-3">
        Listening to the song to line every word up with the music. {waiting ? 'It starts as soon as the lyrics are ready.' : ''} This only happens the first
        time — after that it plays instantly.
      </p>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: 'var(--glow-p)' }} />
      </div>
      {waiting && (
        <button type="button" onClick={playWithoutWaiting} className="h-8 rounded-full px-4 text-[12px] font-medium text-ink-2 ring-1 ring-line hover:text-ink">
          Play now without waiting
        </button>
      )}
    </div>
  );
}

/** The lyrics stage: status handling, the animated lyrics, and a quiet toolbar. */
export function LyricsView({ compact }: { compact?: boolean }) {
  const track = useCurrentTrack();
  const np = useStore(nowPlayingStore, (s) => s);
  const st = useStore(lyricsStore, (s) => s);
  const style = useSettings((s) => s.lyricsStyle);
  const size = useSettings((s) => s.lyricsSize);
  const position = useSettings((s) => s.lyricsPosition);
  const online = useSettings((s) => s.onlineLyrics);
  const [editing, setEditing] = useState(false);
  // a new key per opening: re-opening during the exit animation must not revive the old editor (and its stale text)
  const [editKey, setEditKey] = useState(0);
  const edit = () => {
    setEditKey((k) => k + 1);
    setEditing(true);
  };

  const local = canTranscribe(track);
  // Devanagari lyrics can be shown in Roman letters — display-only, never stored or translated.
  // Word timings are untouched: only each word's text changes.
  const romanizeOn = useSettings((x) => x.lyricsRomanize);
  const devanagari = useMemo(
    () => !!st.doc && (st.doc.lines.some((l) => hasIndicScript(l.text)) || (st.doc.plain ?? []).some(hasIndicScript)),
    [st.doc],
  );
  const punjabi = useMemo(
    () => !!st.doc && (st.doc.lines.some((l) => hasGurmukhi(l.text)) || (st.doc.plain ?? []).some(hasGurmukhi)),
    [st.doc],
  );
  const shownLines = useMemo(() => {
    const lines = st.doc?.lines ?? [];
    if (!romanizeOn || !devanagari) return lines;
    return lines.map((l) => ({ ...l, text: romanize(l.text), words: l.words?.map((w) => ({ ...w, text: romanize(w.text) })) }));
  }, [st.doc, romanizeOn, devanagari]);
  const shownPlain = useMemo(() => {
    const plain = st.doc?.plain ?? [];
    return romanizeOn && devanagari ? plain.map(romanize) : plain;
  }, [st.doc, romanizeOn, devanagari]);
  const backendOk = usePlayer((p) => p.backend.ok);
  const canSearch = backendOk && !!track;
  const [searching, setSearching] = useState(false);
  const search = () => setSearching(true);
  let body: React.ReactNode;
  if (!track) body = <Empty icon={<Mic2 size={20} />} title="Nothing playing" body="Start a track to see its lyrics here." onEdit={edit} />;
  else if (st.status === 'off')
    body = (
      <div className="flex max-w-[420px] flex-col items-center gap-3 px-6 text-center">
        <p className="text-[16px] font-semibold text-ink">Lyrics are turned off</p>
        <button type="button" onClick={() => updateSettings({ lyricsEnabled: true })} className="inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[12.5px] font-semibold text-black">
          <Power size={14} /> Turn lyrics on
        </button>
      </div>
    );
  else if (st.status === 'transcribing') body = <Transcribing job={st.job} onSearch={search} />;
  else if (st.syncing || (st.waiting && (st.status === 'loading' || st.status === 'idle'))) body = <SyncingLyrics waiting={st.waiting} />;
  else if (st.status === 'loading' || st.status === 'idle')
    body = (
      <div className="flex items-center gap-2 text-[13px] text-ink-3">
        <Loader2 size={16} className="animate-spin" /> Looking for lyrics…
      </div>
    );
  else if (st.status === 'instrumental') body = <Empty icon={<Mic2 size={20} />} title="Instrumental" body="The lyrics database lists this track as instrumental." onEdit={edit} onSearch={canSearch ? search : undefined} />;
  else if (st.status === 'disabled')
    body = <Empty icon={<FileText size={20} />} title="Online lyrics are off" body="Turn on “Look up lyrics online” in settings, or add your own LRC file." onEdit={edit} />;
  else if (st.status === 'unavailable')
    body = (
      <Empty
        icon={<FileText size={20} />}
        title="No lyrics found for this track"
        body={
          st.error ??
          (local
            ? 'Nothing matched in the lyrics database. Vayro can listen to this file and transcribe the vocals with word timing, on your device.'
            : 'Nothing matched in the lyrics database. You can paste lyrics or load an .lrc file — Vayro never invents lyrics or timing.')
        }
        onEdit={edit}
        onSearch={canSearch ? search : undefined}
        retry={online && !local}
        transcribe={local}
      />
    );
  else if (st.status === 'error') body = <Empty icon={<FileText size={20} />} title="Couldn’t load lyrics" body={st.error ?? undefined} onEdit={edit} retry transcribe={local} onSearch={canSearch ? search : undefined} />;
  else if (st.doc?.kind === 'synced') body = <SyncedLyrics lines={shownLines} style={style} offset={st.offset} size={size} position={position} />;
  else if (st.doc?.kind === 'plain') body = <PlainLyrics text={shownPlain} size={size} />;

  const doc = st.status === 'ready' && !st.syncing ? st.doc : null;
  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center">{body}</div>
      </div>

      {doc && (
        <div className={cx('lyrics-toolbar mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-3 transition-opacity duration-500', compact ? 'pb-1' : 'pb-[150px]')}>
          {st.job && (
            <span className="inline-flex items-center gap-1.5 rounded-full py-[1px] pl-2 pr-1 text-ink-2 ring-1 ring-line" role="status">
              <Loader2 size={11} className="animate-spin" />
              Transcribing {Math.round(st.job.progress * 100)}%
              <button type="button" onClick={cancelTranscription} aria-label="Stop transcribing" className="rounded-full p-0.5 hover:bg-white/10 hover:text-ink">
                <X size={11} />
              </button>
            </span>
          )}
          {devanagari && (
            <button
              type="button"
              aria-pressed={romanizeOn}
              onClick={() => updateSettings({ lyricsRomanize: !romanizeOn })}
              title={`Show ${punjabi ? 'Punjabi' : 'Hindi'} in Roman letters (transliteration, not translation)`}
              className={cx('rounded-full px-2 py-[2px] ring-1', romanizeOn ? 'bg-white/[0.1] text-ink ring-line-2' : 'ring-line hover:text-ink')}
            >
              {romanizeOn ? 'Roman ✓' : punjabi ? 'ਅ → A' : 'अ → A'}
            </button>
          )}
          <span title={doc.attribution} className="max-w-[300px] truncate">
            {doc.source === 'lrclib' ? (
              <a href="https://lrclib.net" target="_blank" rel="noreferrer" className="hover:text-ink-2">
                {doc.attribution?.startsWith('LRCLIB · ') ? doc.attribution : 'Lyrics · LRCLIB'}
              </a>
            ) : (
              doc.attribution
            )}
          </span>
          {np.status === 'following' && track?.provider === 'system' && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] ring-1 ring-line" title="Lyrics follow the song playing in Spotify">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              Following {np.app ?? 'Spotify'}
            </span>
          )}
          <span className="rounded-full px-2 py-[2px] ring-1 ring-line">
            {doc.kind === 'plain' ? 'Not time-synced' : doc.hasWordSync ? 'Word-synced' : 'Line-synced · word timing estimated'}
          </span>
          {doc.kind === 'synced' && (
            <span className="inline-flex items-center rounded-full ring-1 ring-line">
              <button type="button" aria-label="Previous lyric line" title="Previous line ( , )" onClick={() => stepLine(-1)} className="rounded-full p-[3px] hover:bg-white/10 hover:text-ink">
                <ChevronLeft size={12} />
              </button>
              <span className="px-0.5">Line</span>
              <button type="button" aria-label="Next lyric line" title="Next line ( . )" onClick={() => stepLine(1)} className="rounded-full p-[3px] hover:bg-white/10 hover:text-ink">
                <ChevronRight size={12} />
              </button>
            </span>
          )}
          {doc.kind === 'synced' && (
            <span className="inline-flex items-center gap-1 rounded-full py-[1px] pl-2 pr-1 ring-1 ring-line" title="Shift lyrics if they run early or late ( [ and ] )">
              Sync
              <button type="button" aria-label="Lyrics later by 0.1 seconds" onClick={() => nudgeOffset(-0.1)} className="rounded-full p-0.5 hover:bg-white/10 hover:text-ink">
                <Minus size={11} />
              </button>
              <span className="tabular w-[46px] text-center font-mono text-ink-2">{st.offset > 0 ? '+' : ''}{st.offset.toFixed(1)}s</span>
              <button type="button" aria-label="Lyrics earlier by 0.1 seconds" onClick={() => nudgeOffset(0.1)} className="rounded-full p-0.5 hover:bg-white/10 hover:text-ink">
                <Plus size={11} />
              </button>
              {st.offset !== 0 && (
                <button type="button" aria-label="Reset lyrics offset" onClick={resetOffset} className="rounded-full p-0.5 hover:bg-white/10 hover:text-ink">
                  <RotateCcw size={11} />
                </button>
              )}
            </span>
          )}
          {doc.kind === 'synced' && (
            <select
              aria-label="Lyrics animation style"
              value={style}
              onChange={(e) => updateSettings({ lyricsStyle: e.target.value as LyricsStyle })}
              className="cursor-pointer rounded-full bg-transparent px-2 py-[2px] text-ink-2 outline-none ring-1 ring-line hover:text-ink"
            >
              {LYRIC_STYLES.map((s) => (
                <option key={s.id} value={s.id} className="bg-panel-solid">
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={edit} className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] ring-1 ring-line hover:text-ink">
            <PencilLine size={11} /> {doc.source === 'transcribed' ? 'Fix words' : st.saved ? 'Edit my lyrics' : 'Use my own'}
          </button>
          {canSearch && (
            <button
              type="button"
              onClick={search}
              title="Find the right lyrics on LRCLIB (pick the version that matches)"
              className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] ring-1 ring-line hover:text-ink"
            >
              <Search size={11} /> {doc.source === 'transcribed' ? 'Find real lyrics' : 'Search lyrics'}
            </button>
          )}
          {local && (
            <button
              type="button"
              onClick={transcribeCurrent}
              title="Listen to this file again and rebuild word-synced lyrics on this device"
              className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] ring-1 ring-line hover:text-ink"
            >
              <AudioLines size={11} /> {doc.source === 'transcribed' ? 'Re-transcribe' : 'Transcribe from audio'}
            </button>
          )}
        </div>
      )}
      <AnimatePresence>{editing && <LyricsEditor key={editKey} onClose={() => setEditing(false)} />}</AnimatePresence>
      <AnimatePresence>{searching && <LyricsSearch onClose={() => setSearching(false)} />}</AnimatePresence>
    </div>
  );
}
