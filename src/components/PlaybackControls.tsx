import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Heart, Lightbulb, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX } from 'lucide-react';
import { audioEngine } from '../engine/audioEngine';
import { useFrame } from '../hooks/useAudioAnalyzer';
import {
  useCurrentTrack, useIsPlaying, usePlayer, cycleRepeat, next, prev, seek, setVolume, toggleMute, togglePlay, toggleShuffle,
} from '../hooks/useAudioPlayer';
import { ColourControls, ModeGrid } from './ThemeSelector';
import { MagneticButton } from './motion';
import { useStore } from '../store';
import { isFavorite, libraryStore, toggleFavorite } from '../state/library';
import { fromTrack } from '../services/libraryCatalog';
import { Artwork, IconButton, Slider, cx, formatTime } from './ui';

/** Scrubber: the fill and times are written from the render loop; dragging previews then seeks. */
export function ProgressBar({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const bufRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLSpanElement>(null);
  const durRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef<number | null>(null);
  const storeDuration = usePlayer((s) => s.duration);
  const hasTrack = usePlayer((s) => s.index >= 0);

  useFrame(() => {
    const d = audioEngine.duration || storeDuration;
    const t = dragging.current ?? audioEngine.currentTime;
    const pct = d ? Math.min(100, (t / d) * 100) : 0;
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
    if (knobRef.current) knobRef.current.style.left = `${pct}%`;
    if (bufRef.current) bufRef.current.style.width = `${d ? Math.min(100, (audioEngine.bufferedEnd / d) * 100) : 0}%`;
    if (curRef.current) curRef.current.textContent = formatTime(t);
    if (durRef.current) durRef.current.textContent = formatTime(d);
    barRef.current?.setAttribute('aria-valuenow', String(Math.round(t)));
    barRef.current?.setAttribute('aria-valuemax', String(Math.round(d)));
    barRef.current?.setAttribute('aria-valuetext', `${formatTime(t)} of ${formatTime(d)}`);
  });

  const timeAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (audioEngine.duration || storeDuration);
  };

  return (
    <div className={cx(stacked ? 'grid grid-cols-2 gap-y-1.5 text-[12px] text-ink-3' : 'flex items-center gap-3 text-[11px] text-ink-3', className)}>
      <span ref={curRef} className={cx('tabular', stacked ? 'row-start-2' : 'w-10 text-right font-mono')}>0:00</span>
      <div
        ref={barRef}
        role="slider"
        tabIndex={hasTrack ? 0 : -1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-disabled={!hasTrack}
        className={cx('group relative flex h-4 flex-1 touch-none items-center', stacked && 'col-span-2 row-start-1', hasTrack ? 'cursor-pointer' : 'pointer-events-none opacity-40')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = timeAt(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current !== null) dragging.current = timeAt(e.clientX);
        }}
        onPointerUp={(e) => {
          if (dragging.current === null) return;
          seek(timeAt(e.clientX));
          dragging.current = null;
        }}
        onPointerCancel={() => (dragging.current = null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') seek(audioEngine.currentTime + 5);
          else if (e.key === 'ArrowLeft') seek(audioEngine.currentTime - 5);
          else if (e.key === 'Home') seek(0);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/[0.08] transition-[height] group-hover:h-[5px]">
          <div ref={bufRef} className="absolute inset-y-0 left-0 bg-white/[0.08]" />
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 rounded-full"
            style={
              stacked
                ? { background: 'linear-gradient(90deg, #8f7dff, #e9e4ff)', boxShadow: '0 0 12px rgb(170 150 255 / 0.8)' }
                : { background: 'linear-gradient(90deg, var(--glow-s), var(--glow-p))', boxShadow: '0 0 12px var(--glow-p)' }
            }
          />
        </div>
        <div
          ref={knobRef}
          className={cx(
            'pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-ink transition-opacity group-hover:opacity-100',
            stacked ? 'opacity-100 shadow-[0_0_14px_rgb(190_175_255/0.95)]' : 'opacity-0 shadow-[0_0_14px_var(--glow-p)]',
          )}
        />
      </div>
      <span ref={durRef} className={cx('tabular', stacked ? 'row-start-2 justify-self-end' : 'w-10 font-mono')}>{formatTime(storeDuration)}</span>
    </div>
  );
}

export function PlayButton({ size = 44, glass = false }: { size?: number; glass?: boolean }) {
  const playing = useIsPlaying();
  const hasTrack = usePlayer((s) => s.index >= 0);
  return (
    <MagneticButton
      onClick={togglePlay}
      disabled={!hasTrack}
      aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
      title={playing ? 'Pause (Space)' : 'Play (Space)'}
      className={cx('flex shrink-0 items-center justify-center rounded-full transition-shadow duration-[var(--dur-slow)] disabled:opacity-30', glass ? 'text-ink' : 'text-black')}
      style={
        glass
          ? {
              // a dark glass disc with a bright rim, like the mockup
              width: size,
              height: size,
              background: 'radial-gradient(120% 100% at 50% 0%, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.03) 60%), rgb(20 18 30 / 0.55)',
              boxShadow: playing
                ? 'inset 0 1px 0.5px rgb(255 255 255 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.22), 0 8px 24px -8px rgb(0 0 0 / 0.8), 0 0 28px -6px rgb(170 150 255 / 0.65)'
                : 'inset 0 1px 0.5px rgb(255 255 255 / 0.55), inset 0 0 0 1px rgb(255 255 255 / 0.22), 0 8px 24px -8px rgb(0 0 0 / 0.8)',
              backdropFilter: 'blur(10px)',
            }
          : {
              width: size,
              height: size,
              background: 'linear-gradient(180deg, #fffaf3, #e6dfd4)',
              boxShadow: playing
                ? 'inset 0 1px 0 rgb(255 255 255 / 0.9), 0 2px 6px rgb(0 0 0 / 0.45), 0 0 30px -6px var(--glow-p)'
                : 'inset 0 1px 0 rgb(255 255 255 / 0.9), 0 2px 6px rgb(0 0 0 / 0.45)',
            }
      }
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={playing ? 'pause' : 'play'}
          initial={{ opacity: 0, scale: 0.6, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, rotate: 45 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="flex"
        >
          {playing ? <Pause size={size * 0.4} fill="currentColor" strokeWidth={0} /> : <Play size={size * 0.4} fill="currentColor" strokeWidth={0} className="ml-[2px]" />}
        </motion.span>
      </AnimatePresence>
    </MagneticButton>
  );
}

/** heart: favourite the playing song in the Library (shown when it is a Library song) */
function FavoriteButton() {
  const track = useCurrentTrack();
  const cat = track ? fromTrack(track) : null;
  const fav = useStore(libraryStore, (s) => (cat ? isFavorite(cat.id, s) : false));
  if (!cat) return null;
  return (
    <IconButton label={fav ? 'Remove from favourites' : 'Add to favourites'} active={fav} onClick={() => toggleFavorite(cat)} className="max-md:hidden">
      <motion.span
        key={fav ? 'on' : 'off'}
        className="relative flex"
        initial={fav ? { scale: 0.55 } : false}
        animate={{ scale: [null, fav ? 1.25 : 1, 1] }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        {fav && (
          <motion.span
            aria-hidden
            className="absolute inset-[-6px] rounded-full border"
            style={{ borderColor: 'color-mix(in srgb, var(--glow-p) 60%, #ff6b8b)' }}
            initial={{ opacity: 0.9, scale: 0.4 }}
            animate={{ opacity: 0, scale: 1.5 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          />
        )}
        <Heart size={20} strokeWidth={1.8} fill={fav ? 'currentColor' : 'none'} style={fav ? { color: 'color-mix(in srgb, var(--glow-p) 60%, #ff6b8b)' } : undefined} />
      </motion.span>
    </IconButton>
  );
}

function VolumeControl({ wide = false }: { wide?: boolean }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const [hover, setHover] = useState(false);
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.33 ? Volume : volume < 0.7 ? Volume1 : Volume2;
  return (
    <div className={cx('flex items-center gap-1', wide && 'gap-3')} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <IconButton label={muted ? 'Unmute (M)' : 'Mute (M)'} onClick={toggleMute} size="sm">
        <Icon size={16} strokeWidth={1.8} />
      </IconButton>
      <Slider
        label="Volume"
        value={muted ? 0 : volume}
        onChange={setVolume}
        format={(v) => `${Math.round(v * 100)}%`}
        className={cx(wide ? 'flex-1' : 'w-[84px]', 'transition-opacity', hover || wide ? 'opacity-100' : 'opacity-80')}
      />
    </div>
  );
}

/** "⋯": volume, lighting mode and colours, in one panel (kept off the bar, like the mockup) */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <IconButton label="Lighting: mode, colours and volume" active={open} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="!w-auto gap-2 !px-3">
        <span className="relative flex">
          <Lightbulb size={20} strokeWidth={1.8} />
          {/* the current light colour, glowing */}
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-1 ring-black/40"
            style={{ background: 'var(--glow-p)', boxShadow: '0 0 8px 1px var(--glow-p)' }}
          />
        </span>
        <span className="text-[12px] font-medium tracking-[0.02em]">Lighting</span>
      </IconButton>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass scroll-quiet absolute bottom-[calc(100%+18px)] right-0 max-h-[calc(100vh-200px)] w-[440px] max-w-[calc(100vw-32px)] origin-bottom-right overflow-y-auto rounded-2xl p-2.5"
          >
            <p className="px-2 pb-2 pt-1 text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink-3">Volume</p>
            <div className="px-2 pb-3">
              <VolumeControl wide />
            </div>
            <div className="mb-3 border-t border-line" />
            <p className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink-3">Lighting mode</p>
            <p className="px-2 pb-2.5 text-[11px] text-ink-3">How the light around your screen looks and moves, then its colour and the lyrics’ colour.</p>
            <ModeGrid />
            <div className="my-3 border-t border-line" />
            <ColourControls />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * A soft halo behind the player bar that breathes with the bass. Only when the analyser is really
 * hearing the music (`live`): with no accessible audio (Spotify SDK, system player, DRM) it stays
 * off rather than faking a beat. Written straight to the DOM: opacity only, no React renders.
 */
function AudioHalo() {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(-1);
  useFrame((f) => {
    const v = Math.min(1, f.live * (0.55 * f.features.bass + 0.45 * f.features.kick));
    const q = Math.round(v * 40) / 40;
    if (q !== last.current && ref.current) {
      last.current = q;
      ref.current.style.opacity = String(q * 0.85);
    }
  });
  return <div ref={ref} aria-hidden className="audio-halo" style={{ opacity: 0 }} />;
}

export function PlaybackControls() {
  const track = useCurrentTrack();
  const hasQueue = usePlayer((s) => s.queue.length > 0);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-6 pb-6 max-sm:px-3 max-sm:pb-3">
      <div
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty('--px', `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty('--py', `${e.clientY - r.top}px`);
        }}
        className="glass-strong glare pointer-events-auto relative grid w-full max-w-[1100px] grid-cols-[minmax(220px,300px)_minmax(0,1fr)_auto] items-center gap-6 rounded-[36px] px-6 py-4 max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-3 max-md:rounded-[28px] max-md:px-4 max-md:py-3">
        <AudioHalo />
        {/* track: the cover and title slide over when the song changes */}
        <div className="flex min-w-0 items-center gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={track?.id ?? 'none'}
              initial={{ opacity: 0, scale: 0.86, rotateY: -25, filter: 'blur(6px)' }}
              animate={{ opacity: 1, scale: 1, rotateY: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.9, rotateY: 25, filter: 'blur(6px)' }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="art-hover shrink-0 [perspective:600px]"
            >
              <Artwork src={track?.artwork} alt="" className="h-[96px] w-[96px] shrink-0 shadow-[0_10px_28px_-10px_rgb(0_0_0/0.9)] ring-1 ring-white/10 max-md:h-14 max-md:w-14" rounded="rounded-[16px] max-md:rounded-[12px]" />
            </motion.div>
          </AnimatePresence>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={track?.id ?? 'none'}
              className="min-w-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
            >
              <p className="truncate text-[18px] font-medium tracking-[-0.01em] text-ink max-md:text-[14px]">{track?.title ?? 'Nothing playing'}</p>
              <p className="truncate text-[14px] text-ink-3 max-md:text-[12px]">{track?.artist ?? 'Pick a song from the Library'}</p>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* transport */}
        <div className="flex w-full flex-col items-center gap-2 max-md:w-auto">
          <div className="flex items-center gap-5 max-md:gap-1">
            <IconButton label={shuffle ? 'Shuffle on' : 'Shuffle off'} active={shuffle} onClick={toggleShuffle} disabled={!hasQueue} className="max-md:hidden">
              <Shuffle size={19} strokeWidth={1.8} />
            </IconButton>
            <IconButton label="Previous (P)" onClick={prev} disabled={!hasQueue} size="lg">
              <SkipBack size={22} fill="currentColor" strokeWidth={1.2} />
            </IconButton>
            {/* phones: a smaller disc so the transport fits beside the song */}
            <span className="flex max-md:-mx-[7px] max-md:scale-[0.78]">
              <PlayButton size={64} glass />
            </span>
            <IconButton label="Next (N)" onClick={() => next()} disabled={!hasQueue} size="lg">
              <SkipForward size={22} fill="currentColor" strokeWidth={1.2} />
            </IconButton>
            <IconButton
              label={repeat === 'one' ? 'Repeat one' : repeat === 'all' ? 'Repeat all' : 'Repeat off'}
              active={repeat !== 'off'}
              onClick={cycleRepeat}
              disabled={!hasQueue}
              className="max-md:hidden"
            >
              {repeat === 'one' ? <Repeat1 size={19} strokeWidth={1.8} /> : <Repeat size={19} strokeWidth={1.8} />}
            </IconButton>
          </div>
          <ProgressBar stacked className="w-full max-md:hidden" />
        </div>

        {/* phones: a thin scrubber across the bottom of the bar */}
        <ProgressBar className="col-span-2 w-full text-[11px] md:hidden" />

        {/* right: favourite + more */}
        <div className="flex items-center justify-end gap-2 max-md:hidden">
          <FavoriteButton />
          <MoreMenu />
        </div>
      </div>
    </div>
  );
}
