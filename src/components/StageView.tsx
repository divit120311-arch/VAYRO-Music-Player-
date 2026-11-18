import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AudioWaveform, Clock3, Image as ImageIcon, MicVocal, Sparkles } from 'lucide-react';
import { useCurrentTrack, useSettings } from '../hooks/useAudioPlayer';
import { useFrame, useVisualizerAnchor } from '../hooks/useAudioAnalyzer';
import { updateSettings } from '../state/settings';
import { audioEngine } from '../engine/audioEngine';
import type { StageView } from '../types/lighting';
import { LyricsView } from './lyrics/LyricsView';
import { NavTab, useClock } from './Header';
import { HoverLensGroup } from './HoverLens';
import { cx } from './ui';

export const VIEWS: { id: StageView; label: string; icon: typeof ImageIcon }[] = [
  { id: 'artwork', label: 'Artwork', icon: ImageIcon },
  { id: 'lyrics', label: 'Lyrics', icon: MicVocal },
  { id: 'visualizer', label: 'Visualizer', icon: AudioWaveform },
  { id: 'clock', label: 'Clock', icon: Clock3 },
  { id: 'ambient', label: 'Ambient', icon: Sparkles },
];

export function ViewSwitcher({ className }: { className?: string }) {
  const view = useSettings((s) => s.view);
  return (
    <HoverLensGroup role="radiogroup" aria-label="Display mode" className={cx('glass-strong flex rounded-full p-[3px]', className)}>
      {VIEWS.map(({ id, label, icon: Icon }) => (
        <NavTab
          key={id}
          group="view"
          role="radio"
          on={view === id}
          onClick={() => updateSettings({ view: id })}
          title={`${label} view (V cycles)`}
          icon={<Icon size={13} strokeWidth={2} />}
          label={label}
          compactLabel="max-xl:hidden"
        />
      ))}
    </HoverLensGroup>
  );
}

/** Lock-screen clock from the references: small date, big light-weight time, no AM/PM. */
export function LockClock({ size = 'lg', className }: { size?: 'sm' | 'lg'; className?: string }) {
  const now = useClock();
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]\.?M\.?$/i, '');
  return (
    <div className={cx('select-none text-center', className)}>
      <p className={cx('font-semibold text-ink-2', size === 'lg' ? 'text-[clamp(14px,1.4vw,20px)]' : 'text-[clamp(11px,1vw,14px)]')}>
        {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
      </p>
      <p
        className={cx('tabular leading-[0.95] tracking-[-0.03em] text-ink/80', size === 'lg' ? 'text-[clamp(84px,14vw,220px)]' : 'text-[clamp(44px,5.4vw,84px)]')}
        style={{ fontWeight: 250, textShadow: '0 0 40px color-mix(in srgb, var(--glow-p) 18%, transparent)' }}
      >
        {time}
      </p>
    </div>
  );
}

function MiniNowPlaying({ className }: { className?: string }) {
  const track = useCurrentTrack();
  const bar = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const d = audioEngine.duration;
    if (bar.current) bar.current.style.transform = `scaleX(${d ? audioEngine.currentTime / d : 0})`;
  });
  if (!track) return null;
  return (
    <div className={cx('flex flex-col items-center gap-2 text-center', className)}>
      <p className="text-[clamp(13px,1.2vw,17px)] font-semibold text-ink/85">
        {track.title}
        <span className="font-normal text-ink-3"> — {track.artist}</span>
      </p>
      <div className="h-[2px] w-[140px] overflow-hidden rounded-full bg-white/10">
        <div ref={bar} className="h-full w-full origin-left" style={{ background: 'var(--glow-p)', transform: 'scaleX(0)' }} />
      </div>
    </div>
  );
}

function ClockStage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-[6vh]">
      <LockClock />
      <MiniNowPlaying />
    </div>
  );
}

function VisualizerStage() {
  const anchor = useVisualizerAnchor('art');
  const track = useCurrentTrack();
  return (
    <div className="relative flex h-full flex-col items-center justify-center">
      <div ref={anchor} aria-hidden className="h-[min(42vh,40vw)] w-[min(42vh,40vw)]" />
      {track && (
        <div className="absolute bottom-[4vh] text-center">
          <p className="text-[15px] font-semibold text-ink/85">{track.title}</p>
          <p className="text-[12.5px] text-ink-3">{track.artist}</p>
        </div>
      )}
    </div>
  );
}

function AmbientStage() {
  return (
    <div className="flex h-full items-end justify-center pb-[3vh]">
      <MiniNowPlaying className="opacity-70" />
    </div>
  );
}

/** album art behind the lyrics (off / blurred / clear) plus a scrim for readability */
function LyricsBackdrop({ immersive }: { immersive?: boolean }) {
  const track = useCurrentTrack();
  const mode = useSettings((s) => s.lyricsArtwork);
  const scrim = useSettings((s) => s.lyricsBgOpacity);
  const art = mode !== 'off' ? track?.artwork : undefined;
  return (
    <div aria-hidden className={cx('pointer-events-none absolute inset-0 overflow-hidden', !immersive && 'rounded-[28px]')}>
      <AnimatePresence>
        {art && (
          <motion.img
            key={art + mode}
            src={art}
            alt=""
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: mode === 'blurred' ? 'blur(38px) saturate(1.25)' : 'none', transform: mode === 'blurred' ? 'scale(1.15)' : undefined }}
          />
        )}
      </AnimatePresence>
      <div
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: scrim,
          background: art ? 'rgb(5 5 7)' : 'radial-gradient(60% 55% at 50% 50%, rgb(0 0 0 / 0.85), transparent 75%)',
        }}
      />
    </div>
  );
}

function LyricsStage({ immersive }: { immersive?: boolean }) {
  const showClock = useSettings((s) => s.showClock);
  const position = useSettings((s) => s.lyricsPosition);
  const showInfo = useSettings((s) => s.showTrackInfo);
  const track = useCurrentTrack();
  return (
    <div className="relative flex h-full w-full flex-col items-center">
      <LyricsBackdrop immersive={immersive} />
      {immersive && showInfo && track && (
        <p className="absolute left-[3vw] top-[3.2vh] z-[1] max-w-[40vw] truncate text-[clamp(12px,1vw,15px)] text-ink-3" data-testid="fullscreen-credit">
          <span className="font-semibold text-ink-2">{track.title}</span> · {track.artist}
        </p>
      )}
      {showClock && position !== 'upper' && <LockClock size="sm" className={cx('relative', immersive ? 'mt-[11vh]' : 'mt-1')} />}
      <div className="relative min-h-0 w-full flex-1">
        <LyricsView compact={!immersive} />
      </div>
    </div>
  );
}

/**
 * Renders the selected display mode with animated transitions between modes.
 * `artwork` is supplied by the caller (it differs between the windowed and immersive layouts).
 */
export function Stage({ artwork, immersive }: { artwork: React.ReactNode; immersive?: boolean }) {
  const view = useSettings((s) => s.view);
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0, scale: 0.985, filter: 'blur(10px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        exit={{ opacity: 0, scale: 1.01, filter: 'blur(10px)' }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="h-full w-full"
      >
        {view === 'artwork' && artwork}
        {view === 'lyrics' && <LyricsStage immersive={immersive} />}
        {view === 'visualizer' && <VisualizerStage />}
        {view === 'clock' && <ClockStage />}
        {view === 'ambient' && <AmbientStage />}
      </motion.div>
    </AnimatePresence>
  );
}
