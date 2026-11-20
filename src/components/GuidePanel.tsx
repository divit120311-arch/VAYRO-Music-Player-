import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { closeGuide, uiStore } from '../state/ui';
import { startNowPlaying } from '../state/nowPlaying';
import { cx } from './ui';

/**
 * "Make a viral lyric video": a step-by-step guide with real, labelled screenshots of Vayro.
 * Screenshots live in /public/guide (1424 × 805, captured from the app with its own demo song and
 * sample lyrics). Each mark is a box in % of the image, a number, and a short label.
 */

type Place = 'top' | 'bottom' | 'left' | 'right';
interface Mark {
  n: number;
  /** box, in % of the image */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  place?: Place;
}

/** `strip`: a thin image (one toolbar row): extra room above and below for the numbers and labels */
function Shot({ src, alt, marks, ratio = '1424 / 805', className, strip }: { src: string; alt: string; marks: Mark[]; ratio?: string; className?: string; strip?: boolean }) {
  return (
    <figure className={cx('overflow-hidden rounded-[18px] ring-1 ring-white/10', className)}>
      <div className={cx('bg-black/35', strip ? 'px-4 pb-11 pt-7' : 'p-3')}>
        <div className="relative w-full overflow-visible rounded-[10px]" style={{ aspectRatio: ratio }}>
          <img src={src} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full rounded-[10px] object-cover" />
          {marks.map((m) => (
            <Callout key={m.n} m={m} />
          ))}
        </div>
      </div>
      <figcaption className="grid gap-1.5 bg-black/30 px-4 py-3 text-[12.5px] leading-snug text-ink-2 sm:grid-cols-2">
        {marks.map((m) => (
          <span key={m.n} className="flex items-start gap-2">
            <Num n={m.n} small />
            <span>{m.label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function Num({ n, small }: { n: number; small?: boolean }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-black', small ? 'mt-px h-[18px] w-[18px] text-[11px]' : 'h-6 w-6 text-[12.5px]')}
      style={{ background: 'linear-gradient(180deg, #fff, #ddd3ff)', boxShadow: '0 0 0 2px rgb(0 0 0 / 0.55), 0 0 14px rgb(190 170 255 / 0.9)' }}
    >
      {n}
    </span>
  );
}

/** a glowing box around the control, its number, and a short label on the image */
function Callout({ m }: { m: Mark }) {
  const place = m.place ?? 'bottom';
  const pill: Record<Place, string> = {
    top: 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2',
    bottom: 'top-[calc(100%+8px)] left-1/2 -translate-x-1/2',
    left: 'right-[calc(100%+8px)] top-1/2 -translate-y-1/2',
    right: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2',
  };
  return (
    <div className="pointer-events-none absolute" style={{ left: `${m.x}%`, top: `${m.y}%`, width: `${m.w}%`, height: `${m.h}%` }}>
      <span
        aria-hidden
        className="guide-ring absolute -inset-[5px] rounded-[14px]"
        style={{ border: '2px solid rgb(225 215 255 / 0.95)', boxShadow: '0 0 0 3px rgb(0 0 0 / 0.35), 0 0 22px rgb(180 160 255 / 0.75), inset 0 0 14px rgb(180 160 255 / 0.35)' }}
      />
      <span className="absolute -left-3 -top-3">
        <Num n={m.n} />
      </span>
      <span
        className={cx('absolute whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold text-black max-sm:hidden', pill[place])}
        style={{ background: 'rgb(244 240 255 / 0.96)', boxShadow: '0 6px 18px -6px rgb(0 0 0 / 0.8)' }}
      >
        {m.label.split(':')[0]}
      </span>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-4 border-t border-white/[0.07] py-8 first:border-t-0 first:pt-2"
    >
      <header className="flex items-center gap-3">
        <span className="tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-ink ring-1 ring-white/20" style={{ background: 'radial-gradient(circle at 50% 0%, rgb(255 255 255 / 0.18), rgb(255 255 255 / 0.03))' }}>
          {n}
        </span>
        <h3 className="text-[19px] font-medium tracking-[-0.01em] text-ink">{title}</h3>
      </header>
      <div className="grid gap-4 pl-12 text-[14px] leading-relaxed text-ink-2 max-sm:pl-0">{children}</div>
    </motion.section>
  );
}

const Key = ({ children }: { children: ReactNode }) => (
  <kbd className="inline-flex min-w-[26px] items-center justify-center rounded-md bg-white/[0.08] px-1.5 py-0.5 font-sans text-[12px] font-semibold text-ink ring-1 ring-white/20 [box-shadow:inset_0_-2px_0_rgb(255_255_255/0.08)]">{children}</kbd>
);

/** step 1 has nothing of Vayro's to show: a simple drawing of "a song playing on this PC" */
function SpotifyDrawing() {
  return (
    <div className="relative overflow-hidden rounded-[18px] p-5 ring-1 ring-white/10" style={{ background: 'linear-gradient(135deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.01))' }}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex min-w-[240px] flex-1 items-center gap-3 rounded-2xl bg-black/40 p-3 ring-1 ring-white/10">
          <div className="h-12 w-12 shrink-0 rounded-lg" style={{ background: 'linear-gradient(135deg, #6d5bd0, #1f1a3a)' }} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-ink">Any song</p>
            <p className="text-[12px] text-ink-3">Playing in the Spotify app</p>
            <div className="mt-2 h-1 rounded-full bg-white/10">
              <div className="h-full w-2/5 rounded-full bg-white/70" />
            </div>
          </div>
        </div>
        <span className="text-[22px] text-ink-3" aria-hidden>→</span>
        <div className="flex min-w-[200px] flex-1 flex-col gap-1 rounded-2xl bg-black/40 p-3 ring-1 ring-white/10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3">Vayro sees</p>
          <p className="text-[13px] text-ink">the song name &amp; position</p>
          <p className="text-[12px] text-ink-3">(from your computer — never the audio)</p>
        </div>
      </div>
    </div>
  );
}

export function GuidePanel() {
  const open = useStore(uiStore, (s) => s.guide);
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="guide"
          role="dialog"
          aria-label="How to make a lyric video"
          initial={{ opacity: 0, x: '-50%', y: 14, scale: 0.985 }}
          animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
          exit={{ opacity: 0, x: '-50%', y: 10, scale: 0.985 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="glass fixed bottom-[164px] left-1/2 top-[var(--panel-top)] z-30 flex w-[min(1000px,calc(100vw-48px))] flex-col overflow-hidden rounded-[24px] max-sm:w-[calc(100vw-24px)]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-7 pb-5 pt-6 max-sm:px-5">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-ink-3">Guide</p>
              <h2 className="mt-1 text-[26px] font-light tracking-[-0.02em] text-ink">Make a viral lyric video</h2>
              <p className="mt-1 max-w-[620px] text-[13.5px] text-ink-3">
                Time-synced lyrics, glowing edges, fullscreen — then record your screen. About two minutes, start to finish.
              </p>
            </div>
            <button type="button" onClick={closeGuide} aria-label="Close guide" className="press rounded-full p-2 text-ink-2 hover:bg-white/10 hover:text-ink">
              <X size={18} />
            </button>
          </div>

          <div data-scroll-main className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-7 pb-6 max-sm:px-5">
            <Step n={1} title="Play a song on Spotify">
              <p>
                Open <b className="text-ink">Spotify in another browser tab</b> (open.spotify.com) or the Spotify app, and play any song — a free account works. Keep the window wide enough
                that the times show on both sides of the progress bar.
              </p>
              <SpotifyDrawing />
            </Step>

            <Step n={2} title="Click “Sync lyrics”">
              <p>
                On Vayro’s home page, click the bright <b className="text-ink">Sync lyrics</b> button (or gear menu → <b className="text-ink">Sync Spotify lyrics</b>). Your browser asks what to share: pick
                your <b className="text-ink">Spotify tab</b> (or the Spotify app’s window) and click <b className="text-ink">Share</b>. Vayro reads the song and its time from Spotify’s player bar, on this computer only.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <Shot
                  src="/guide/1-hero.jpg"
                  alt="Vayro home page with the Sync lyrics button"
                  marks={[
                    { n: 1, x: 36.23, y: 62.16, w: 12.41, h: 6.95, label: 'Sync lyrics: click to start', place: 'bottom' },
                    { n: 2, x: 94.66, y: 1.24, w: 3.37, h: 5.96, label: 'Menu: the other way in', place: 'left' },
                  ]}
                />
                <Shot
                  src="/guide/2-menu.jpg"
                  alt="The gear menu with Sync Spotify lyrics"
                  marks={[{ n: 3, x: 80.27, y: 20.06, w: 17.27, h: 5.24, label: 'Sync Spotify lyrics: same thing, from the menu', place: 'left' }]}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  startNowPlaying();
                  closeGuide();
                }}
                className="press w-fit rounded-full bg-white/90 px-5 py-2 text-[13px] font-medium text-black"
              >
                Start syncing now
              </button>
            </Step>

            <Step n={3} title="Watch the lyrics follow the song">
              <p>
                The Lyrics view opens and the words light up as they’re sung. The badge under the lyrics tells you how exact the timing is: <b className="text-ink">Word-synced</b> is
                word-perfect; <b className="text-ink">Line-synced · word timing estimated</b> means each line is on time and the words in between are spread out.
              </p>
              <Shot
                src="/guide/3-lyrics.jpg"
                alt="Lyrics playing in the Reel style"
                marks={[
                  { n: 1, x: 22, y: 33, w: 56, h: 41, label: 'The lyrics: timed to the song', place: 'top' },
                  { n: 2, x: 36.14, y: 76.5, w: 5.82, h: 2.64, label: 'Timing badge: how exact the sync is', place: 'left' },
                  { n: 3, x: 57.51, y: 76.57, w: 7.8, h: 2.48, label: 'Style: Reel is the viral look', place: 'right' },
                ]}
              />
            </Step>

            <Step n={4} title="Early or late? Nudge the timing">
              <p>
                If the words come a little early or late, use <b className="text-ink">Sync − / +</b>: each click moves the lyrics by 0.1 s (− = later, + = earlier). Vayro
                remembers it for that song. <b className="text-ink">‹ Line ›</b> (or the <Key>,</Key> <Key>.</Key> keys) jumps the song to the previous or next line.
              </p>
              <Shot
                src="/guide/4-fix-timing.jpg"
                alt="The lyrics toolbar: timing badge, Line and Sync controls, style"
                ratio="1510 / 58"
                strip
                className="[&_.guide-ring]:-inset-[3px]"
                marks={[
                  { n: 1, x: 38.2, y: 8, w: 17.1, h: 84, label: 'Sync − / +: 0.1 s per click' },
                  { n: 2, x: 28.5, y: 8, w: 8.3, h: 84, label: 'Line ‹ ›: previous / next line' },
                ]}
              />
            </Step>

            <Step n={5} title="Pick the lighting">
              <p>
                Click <b className="text-ink">Lighting</b> on the player bar and choose a mode. Calm ones (Amber Glow, Purple Dream) look great on video; <b className="text-ink">Bass Pulse</b>
                {' '}flashes on the beat for songs playing in Vayro itself.
              </p>
              <Shot
                src="/guide/5-lighting.jpg"
                alt="The lighting panel open from the player bar"
                marks={[
                  { n: 1, x: 79.97, y: 85.72, w: 6.91, h: 4.47, label: 'Lighting: opens the panel', place: 'left' },
                  { n: 2, x: 55.97, y: 18.5, w: 30.9, h: 56, label: 'Modes: tap one to switch', place: 'left' },
                ]}
              />
            </Step>

            <Step n={6} title="Go fullscreen">
              <p>
                Press <Key>F</Key> or the <b className="text-ink">fullscreen</b> button (top right). Everything but the lyrics and the light fades away. Press <Key>Esc</Key> to come back.
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <Shot src="/guide/3-lyrics.jpg" alt="The fullscreen button, top right" marks={[{ n: 1, x: 90.44, y: 1.24, w: 3.37, h: 5.96, label: 'Fullscreen: or press F', place: 'left' }]} />
                <Shot src="/guide/6-fullscreen.jpg" alt="Immersive fullscreen: only lyrics and light" marks={[{ n: 2, x: 25, y: 30, w: 52, h: 50, label: 'Fullscreen: just the lyrics and the glow', place: 'top' }]} />
              </div>
            </Step>

            <Step n={7} title="Record your screen">
              <p>Built-in recorders:</p>
              <ul className="grid gap-2">
                <li className="flex flex-wrap items-center gap-2">
                  <Key>Win</Key>+<Key>Shift</Key>+<Key>R</Key>
                  <span>
                    <b className="text-ink">Snipping Tool</b> (Windows): drag over the area, press Start. Turn on system audio in its toolbar to capture the song.
                  </span>
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <Key>Win</Key>+<Key>Alt</Key>+<Key>R</Key>
                  <span>
                    <b className="text-ink">Xbox Game Bar</b> (Windows): records the browser window with sound; press again to stop.
                  </span>
                </li>
                <li className="flex flex-wrap items-center gap-2">
                  <Key>⌘</Key>+<Key>Shift</Key>+<Key>5</Key>
                  <span>
                    <b className="text-ink">Mac screen recorder</b>: choose Record Selected Portion. It can’t capture the song’s sound, so add the track in your video app afterwards.
                  </span>
                </li>
              </ul>
              <p className="text-ink-3">
                Tip: for Reels / TikTok / Shorts, crop the recording to 9:16 around the lyrics. Songs and lyrics are copyrighted — if you post, the platform’s own licensed version of the
                track is the safest choice.
              </p>
            </Step>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
