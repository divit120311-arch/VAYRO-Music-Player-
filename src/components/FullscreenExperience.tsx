import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minimize2, SkipBack, SkipForward } from 'lucide-react';
import { useCurrentTrack, usePlayer, useSettings, next, prev } from '../hooks/useAudioPlayer';
import { useFrame, useVisualizerAnchor } from '../hooks/useAudioAnalyzer';
import { PlayButton, ProgressBar } from './PlaybackControls';
import { AnalysisBadge } from './TrackInfo';
import { ThemeSelector } from './ThemeSelector';
import { LockClock, Stage, ViewSwitcher } from './StageView';
import { Artwork, IconButton } from './ui';

/** Immersive "artwork" view: lock-screen clock, the cover, and the title set large. */
function ImmersiveArtwork() {
  const track = useCurrentTrack();
  const showClock = useSettings((s) => s.showClock);
  const showArtwork = useSettings((s) => s.showArtwork);
  const titleRef = useRef<HTMLDivElement>(null);
  const anchor = useVisualizerAnchor('art');

  // the title swells a touch with the kick
  useFrame((f) => {
    const el = titleRef.current;
    if (!el) return;
    const a = f.features;
    el.style.transform = `scale(${1 + (0.03 * a.bass + 0.02 * a.kick) * f.live})`;
  });

  const words = (track?.title ?? 'Vayro').split(/\s+/);
  return (
    <div className="flex h-full flex-col items-center">
      {showClock && <LockClock size="sm" className="mt-[5vh]" />}
      <div className="flex flex-1 flex-col items-center justify-center gap-[3.5vh] px-[8vw]">
        {showArtwork && track && (
          <div ref={anchor} className="relative" style={{ width: 'min(30vh, 26vw)', aspectRatio: '1' }}>
            <div
              aria-hidden
              className="absolute inset-0 scale-125 rounded-[24px] opacity-70"
              style={{ backgroundImage: track.artwork ? `url("${track.artwork}")` : 'linear-gradient(135deg, var(--glow-p), var(--glow-s))', backgroundSize: 'cover', filter: 'blur(50px) saturate(150%)' }}
            />
            <Artwork src={track.artwork} alt="" eager rounded="rounded-[18px]" className="relative h-full w-full ring-1 ring-white/10" />
          </div>
        )}
        <AnimatePresence mode="wait">
          <motion.div key={track?.id ?? 'none'} className="text-center" initial="hidden" animate="show" exit="hidden">
            <div ref={titleRef} className="will-change-transform">
              <h1
                className="text-balance text-[clamp(40px,6.2vw,108px)] font-extrabold leading-[0.95] tracking-[-0.045em]"
                style={{ color: 'color-mix(in srgb, var(--glow-p) 30%, white)', textShadow: '0 0 60px color-mix(in srgb, var(--glow-p) 30%, transparent)' }}
              >
                {words.map((w, i) => (
                  <motion.span
                    key={`${w}-${i}`}
                    className="inline-block whitespace-pre"
                    variants={{ hidden: { opacity: 0, y: 24, filter: 'blur(8px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)' } }}
                    transition={{ duration: 0.7, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {w}
                    {i < words.length - 1 ? ' ' : ''}
                  </motion.span>
                ))}
              </h1>
            </div>
            <motion.p variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }} transition={{ duration: 0.8, delay: 0.3 }} className="mt-4 text-[clamp(15px,1.5vw,22px)] font-medium text-ink-2">
              {track ? track.artist : 'Nothing playing — press Esc and pick some music'}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/**
 * Immersive mode — the screen becomes a dedicated music display. It shows the selected view
 * (artwork, lyrics, visualizer, clock or ambient); controls surface on pointer movement and
 * fade after a moment of stillness, taking the cursor with them.
 */
export function FullscreenExperience({ onExit }: { onExit: () => void }) {
  const analysis = usePlayer((s) => s.analysis);
  const [awake, setAwake] = useState(true);
  const timer = useRef<number>(0);
  const controlsHover = useRef(false);

  useEffect(() => {
    const wake = () => {
      setAwake(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => !controlsHover.current && setAwake(false), 2600);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      data-idle={!awake}
      className="cursor-none-idle fixed inset-0 z-40 flex flex-col"
      onDoubleClick={onExit}
    >
      <div className="min-h-0 flex-1">
        <Stage immersive artwork={<ImmersiveArtwork />} />
      </div>

      <motion.div
        animate={{ opacity: awake ? 1 : 0, y: awake ? 0 : 12 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center pb-7"
        style={{ pointerEvents: awake ? 'auto' : 'none' }}
      >
        <div
          className="glass flex w-[min(820px,calc(100vw-64px))] flex-col gap-2 rounded-[22px] px-5 py-3"
          onPointerEnter={() => (controlsHover.current = true)}
          onPointerLeave={() => (controlsHover.current = false)}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconButton label="Previous" onClick={prev}>
                <SkipBack size={18} fill="currentColor" strokeWidth={1.2} />
              </IconButton>
              <PlayButton size={42} />
              <IconButton label="Next" onClick={() => next()}>
                <SkipForward size={18} fill="currentColor" strokeWidth={1.2} />
              </IconButton>
            </div>
            <ViewSwitcher />
            <div className="flex items-center gap-2">
              <ThemeSelector />
              <IconButton label="Exit immersive mode (Esc)" onClick={onExit}>
                <Minimize2 size={16} />
              </IconButton>
            </div>
          </div>
          <ProgressBar />
        </div>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-3">
          <AnalysisBadge status={analysis} />
          <span>Esc to exit · Space to play/pause · V to change view</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
