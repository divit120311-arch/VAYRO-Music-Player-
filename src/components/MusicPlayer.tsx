import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { BookOpen, Loader2, Play, Radio } from 'lucide-react';
import { useCurrentTrack, usePlayer, playNow, togglePlay, notify } from '../hooks/useAudioPlayer';
import { useFrame, useVisualizerAnchor } from '../hooks/useAudioAnalyzer';
import { openGuide, openMusic } from '../state/ui';
import { nowPlayingStore, toggleNowPlaying } from '../state/nowPlaying';
import { useStore } from '../store';
import { getDemoTrack } from '../services/demoTrack';
import { audioEngine } from '../engine/audioEngine';
import { TrackInfo } from './TrackInfo';
import { Stage, ViewSwitcher } from './StageView';
import { Artwork, cx } from './ui';
import { MagneticButton } from './motion';
import { MacDownload } from './MacDownload';

export function usePlayDemo() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    audioEngine.unlock(); // rendering takes a moment — keep the click's audio permission
    setBusy(true);
    try {
      playNow(await getDemoTrack());
    } catch (e) {
      notify(`Couldn’t render the demo: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** where the pointer is over an element, as CSS variables (--px, --py) for hover lights */
function followPointer(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--px', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--py', `${e.clientY - r.top}px`);
}

/** headline words rise out of a mask one after another; the mask opens fully once they're up */
/**
 * Letters near the pointer lift a little and glow, easing back with distance (no layout change:
 * only transform and text-shadow). One pointer listener for the whole headline; rAF-throttled.
 */
function useProximityLetters(enabled: boolean) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let x = -9999;
    let y = -9999;
    const paint = () => {
      raf = 0;
      ref.current?.querySelectorAll<HTMLElement>('[data-letter]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
        const k = Math.exp(-(d * d) / (2 * 110 * 110)); // 1 under the pointer → 0 far away
        el.style.transform = k > 0.01 ? `translateY(${(-10 * k).toFixed(2)}px)` : '';
        el.style.textShadow = k > 0.01 ? `0 0 ${(28 * k).toFixed(1)}px rgb(200 185 255 / ${(0.85 * k).toFixed(2)})` : '';
      });
    };
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const leave = () => {
      x = y = -9999;
      if (!raf) raf = requestAnimationFrame(paint);
    };
    window.addEventListener('pointermove', move);
    document.documentElement.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return ref;
}

function RiseWords({ text, delay, className, letters = false }: { text: string; delay: number; className?: string; letters?: boolean }) {
  const reduce = useReduceMotion();
  return (
    <span className={cx('block', className)}>
      {text.split(' ').map((w, i) => (
        <motion.span
          key={i}
          className="inline-block"
          initial={reduce ? false : { y: '60%', opacity: 0, filter: 'blur(10px)', clipPath: 'inset(100% -20% -20% -20%)' }}
          animate={{ y: '0%', opacity: 1, filter: 'blur(0px)', clipPath: 'inset(-40% -20% -40% -20%)' }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: delay + i * 0.09 }}
        >
          {letters
            ? [...w].map((ch, j) => (
                <span key={j} data-letter className="inline-block transition-[transform,text-shadow] duration-500 ease-out-soft">
                  {ch}
                </span>
              ))
            : w}
          {i < text.split(' ').length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </span>
  );
}

function EmptyStage() {
  const reduce = useReduceMotion();
  // Sync lyrics: show that it's listening for Spotify (the lyrics take over once a song is found)
  const np = useStore(nowPlayingStore, (s) => s);
  const waiting = np.status === 'starting' || np.status === 'waiting';
  const headline = useProximityLetters(!reduce);
  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 18, filter: 'blur(6px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] as const, delay },
  });
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -10, filter: 'blur(8px)' }}
      transition={{ duration: 0.6 }}
      className="relative z-[1] flex max-w-[900px] flex-col items-center px-6 pb-[4vh] text-center"
    >
      {/* eyebrow: the letters spread out into place */}
      <motion.p
        initial={reduce ? false : { opacity: 0, letterSpacing: '0.1em' }}
        animate={{ opacity: 1, letterSpacing: '0.42em' }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        className="mb-7 text-[clamp(11px,1vw,14px)] font-normal uppercase text-ink-2"
      >
        Music, reimagined
      </motion.p>
      <h1 ref={headline} className="text-[clamp(46px,6.8vw,108px)] leading-[1] tracking-[-0.035em] text-ink" style={{ fontWeight: 300 }}>
        <RiseWords text="Feel Your Music" delay={0.35} letters />
        <RiseWords text="Differently." delay={0.7} className="hero-gradient-text mt-[0.04em] pb-[0.08em] italic" />
      </h1>
      <motion.p {...rise(1.05)} className="mt-7 max-w-[600px] text-pretty text-[clamp(15px,1.25vw,19px)] font-light leading-relaxed text-ink-2">
        A minimal, immersive music experience with stunning visuals, synchronized lyrics, and more.
      </motion.p>
      <motion.div {...rise(1.25)} className="mt-10 flex flex-wrap items-center justify-center gap-4">
        <MagneticButton
          onClick={toggleNowPlaying}
          aria-pressed={waiting}
          title={waiting ? 'Waiting for a song in Spotify — click to stop' : 'Play a song in the Spotify app on this computer (free accounts too): its lyrics show here, time-synced'}
          className="hero-btn-primary btn-sweep relative inline-flex h-[56px] items-center gap-3 overflow-hidden rounded-full px-9 text-[16px] font-medium"
        >
          {waiting ? (
            <>
              <span className="relative flex h-[17px] w-[17px] items-center justify-center" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-30" />
                <Radio size={17} strokeWidth={2} />
              </span>
              Waiting for Spotify…
            </>
          ) : (
            <>
              <Radio size={17} strokeWidth={2} /> Sync lyrics
            </>
          )}
        </MagneticButton>
        <MagneticButton
          onClick={() => openMusic('home')}
          onPointerMove={followPointer}
          strength={0.18}
          title="Browse the Library: 30-second previews with synced lyrics"
          className="hero-btn-secondary rim-follow relative inline-flex h-[56px] items-center rounded-full px-10 text-[16px] font-medium"
        >
          Explore previews
        </MagneticButton>
      </motion.div>
      <AnimatePresence>
        {waiting && (
          <motion.p
            key="np-wait"
            role="status"
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mt-4 max-w-[460px] overflow-hidden text-[13.5px] leading-relaxed text-ink-2"
          >
            <span className="text-ink">Now play a song in the Spotify app on this computer.</span> Its lyrics open here automatically, in time with the music.{' '}
            <button type="button" onClick={toggleNowPlaying} className="underline underline-offset-4 hover:text-ink">
              Stop
            </button>
          </motion.p>
        )}
      </AnimatePresence>
      <motion.div {...rise(1.45)} className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={openGuide}
          onPointerMove={followPointer}
          className="press rim-follow relative inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-ink-2 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:text-ink"
          style={{ background: 'rgb(255 255 255 / 0.04)' }}
        >
          <BookOpen size={15} strokeWidth={1.9} /> How to make a lyric video
        </button>
        <MacDownload onPointerMove={followPointer} />
      </motion.div>
    </motion.div>
  );
}

export function MusicPlayer() {
  const track = useCurrentTrack();
  const status = usePlayer((s) => s.status);
  const artAnchor = useVisualizerAnchor('art');
  const haloRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);

  // the halo and the cover breathe with the low end — direct style writes, no re-render
  useFrame((f) => {
    const a = f.features;
    const k = f.live;
    if (haloRef.current) {
      haloRef.current.style.opacity = String(0.5 + 0.35 * a.bass * k + 0.15 * a.beat * k);
      haloRef.current.style.transform = `scale(${1.08 + 0.08 * a.bass * k + 0.03 * a.beat * k})`;
    }
    if (artRef.current) artRef.current.style.transform = `scale(${1 + 0.012 * a.beat * k})`;
  });

  return (
    <section className="relative z-10 flex min-h-0 flex-1 flex-col px-6 pb-[164px]">
      {/* how to show the song (artwork, lyrics, visualizer, clock, ambient): only with a song loaded */}
      <AnimatePresence>
        {track && (
          <motion.div
            key="views"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-[2] flex justify-center pb-1 max-md:hidden"
          >
            <ViewSwitcher />
          </motion.div>
        )}
      </AnimatePresence>
      {/* nothing playing: always the hero, whichever view (lyrics, clock…) is selected */}
      {!track ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <AnimatePresence mode="wait">
            <EmptyStage key="empty" />
          </AnimatePresence>
        </div>
      ) : (
      <Stage
        artwork={
    <div className="flex h-full w-full items-center justify-center">
      <AnimatePresence mode="wait">
        {!track ? (
          <EmptyStage key="empty" />
        ) : (
          <motion.div
            key="stage"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-center gap-7"
          >
            <div className="relative" style={{ width: 'clamp(200px, min(40vh, 34vw), 400px)', aspectRatio: '1' }}>
              {/* blurred copy of the cover = the light the artwork throws */}
              <div
                ref={haloRef}
                aria-hidden
                className="absolute inset-0 rounded-[22px] opacity-60 will-change-transform"
                style={{
                  backgroundImage: track.artwork ? `url("${track.artwork}")` : 'linear-gradient(135deg, var(--glow-p), var(--glow-s))',
                  backgroundSize: 'cover',
                  filter: 'blur(48px) saturate(150%)',
                }}
              />
              <div ref={artAnchor} className="absolute inset-0">
                <div ref={artRef} className="h-full w-full will-change-transform">
                  <AnimatePresence mode="popLayout">
                    <motion.div
                      key={track.id}
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.02 }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full w-full"
                    >
                      <Artwork
                        src={track.artwork}
                        alt={`Artwork for ${track.title}`}
                        eager
                        rounded="rounded-[18px]"
                        className="h-full w-full shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08]"
                      />
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
              {(status === 'loading' || status === 'buffering') && (
                <div className="absolute inset-0 flex items-center justify-center rounded-[18px] bg-black/35 backdrop-blur-[2px]">
                  <Loader2 size={28} className="animate-spin text-ink/80" />
                </div>
              )}
              {status === 'blocked' && (
                <button
                  type="button"
                  onClick={togglePlay}
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[18px] bg-black/50 text-[13px] font-medium text-ink backdrop-blur-sm"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-black shadow-[0_0_40px_var(--glow-p)]">
                    <Play size={22} fill="currentColor" className="ml-0.5" />
                  </span>
                  Click to start playback
                </button>
              )}
            </div>
            <TrackInfo />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
        }
      />
      )}
    </section>
  );
}
