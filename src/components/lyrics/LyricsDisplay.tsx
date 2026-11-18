import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { playbackTime } from '../../engine/playbackClock';
import { seek } from '../../state/player';
import { useLyricBrowse } from '../../hooks/useLyricBrowse';
import { useFrame } from '../../hooks/useAudioAnalyzer';
import { useSettings } from '../../hooks/useAudioPlayer';
import { activeLineIndex, wordTimings } from '../../utils/lrc';
import { LEADING_ICONS, iconFor } from '../../utils/lyricIcons';
import type { LyricLine, LyricWord, LyricsStyle } from '../../types/lyrics';
import type { LyricsAlign, LyricsPosition } from '../../types/lighting';
import { cx } from '../ui';

// =============================================================================================
// CLOCK — the ONLY source of time is the audio element's playback position (+ user offset).
// Paused audio → currentTime stops → nothing advances. Seeking changes currentTime → the active
// line/word is recomputed on the very next animation frame. No timers, no intervals.
// =============================================================================================
interface Timing { words: LyricWord[]; estimated: boolean }

function activeWord(words: LyricWord[], t: number) {
  let i = -1;
  for (let k = 0; k < words.length; k++) if (words[k].t <= t) i = k;
  return i;
}

/** `timeSource` is only for the settings preview (sample lines on a looping clock). */
export function useLyricClock(lines: LyricLine[], offset: number, timeSource?: () => number) {
  const timings = useMemo<Timing[]>(() => lines.map(wordTimings), [lines]);
  const [state, setState] = useState({ line: -1, word: -1 });
  const cur = useRef(state);
  const tRef = useRef(0);
  useFrame(() => {
    const t = (timeSource ? timeSource() : playbackTime()) + offset;
    tRef.current = t;
    const line = activeLineIndex(lines, t);
    const word = line >= 0 ? activeWord(timings[line].words, t) : -1;
    // React only re-renders when the active line or word actually changes
    if (line !== cur.current.line || word !== cur.current.word) {
      cur.current = { line, word };
      setState(cur.current);
    }
  });
  return { ...state, timings, tRef };
}

type Clock = ReturnType<typeof useLyricClock>;
interface Opts { speed: number; wordHL: boolean; visible: number; align: LyricsAlign; fisheye: boolean }
interface StyleProps { lines: LyricLine[]; clock: Clock; size: number; o: Opts }

// Theme: every style reads these CSS variables (set on the SyncedLyrics root), so changing the
// lighting colour / highlight / weight / spacing / glow restyles all modes instantly.
const HL = 'var(--ly-hl)';
const HL2 = 'var(--ly-hl2)';
const TEXT = 'var(--ly-text)';
const WEIGHT = 'var(--ly-w)';
const LIGHTER = 'max(300, calc(var(--ly-w) - 250))';
const GLOW = '0 0 calc(0.6em * var(--ly-glow)) color-mix(in srgb, var(--ly-hl) calc(var(--ly-glow) * 70%), transparent)';
const LH = 'calc(1.12 * var(--ly-lh))';
// Devanagari (Hindi) and Gurmukhi (Punjabi) glyphs come from Noto Sans Devanagari / Gurmukhi (shaped correctly: matras and conjuncts stay intact)
const LYRIC_FONT: CSSProperties = { fontFamily: "'Nunito Variable', 'Noto Sans Devanagari Variable', 'Noto Sans Gurmukhi Variable', 'Inter Tight Variable', 'Nirmala UI', system-ui, sans-serif" };
const EASE = [0.22, 1, 0.36, 1] as const;
const alignText = (a: LyricsAlign) => (a === 'left' ? 'text-left items-start' : a === 'right' ? 'text-right items-end' : 'text-center items-center');

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// =============================================================================================
// FISHEYE LENS — the lyrics bend as if printed on a bubble: the middle swells, the edges shrink
// and lean away, a top line arches up and a bottom line smiles. It is a real distortion of the
// glyphs (SVG feDisplacementMap), stretched over the element's box, so any font works with it.
// =============================================================================================
const LENS_SCALE = 0.16; // largest displacement the map can encode, as a fraction of the box width
const LENS_POWER = 0.46; // centre magnified ~1.8×, edges squeezed and curved (the references' bubble)

const lensMaps = new Map<number, string>();
/**
 * Displacement map: every pixel says where in the source to sample (a barrel / bulge).
 * Chrome scales BOTH axes of feDisplacementMap by the box width in objectBoundingBox units, so
 * the vertical offsets are pre-multiplied by the box's aspect (height / width) to stay round.
 */
function fisheyeMap(aspect: number) {
  const hit = lensMaps.get(aspect);
  if (hit) return hit;
  const N = 384;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(N, N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const u = ((i + 0.5) / N) * 2 - 1;
      const v = ((j + 0.5) / N) * 2 - 1;
      const r2 = u * u + v * v;
      // inside the lens, sample nearer the centre (magnify); falls smoothly to 0 at the rim
      const k = r2 < 1 ? LENS_POWER * (1 - r2) * (1 - r2 * 0.35) : 0;
      const dx = (-k * u) / 2; // fraction of the box width (u spans 2)
      const dy = ((-k * v) / 2) * aspect; // fraction of the box height, expressed in widths
      const o = (j * N + i) * 4;
      img.data[o] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dx / LENS_SCALE)));
      img.data[o + 1] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + dy / LENS_SCALE)));
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL('image/png');
  lensMaps.set(aspect, url);
  return url;
}

const lensId = (aspect: number) => `ly-fisheye-${Math.round(aspect * 100)}`;

/** the filter definition for a box of this aspect (height / width) */
function FisheyeLens({ aspect }: { aspect: number }) {
  const href = useMemo(() => fisheyeMap(aspect), [aspect]);
  if (!href) return null;
  return (
    <svg aria-hidden width="0" height="0" className="pointer-events-none absolute">
      <filter id={lensId(aspect)} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
        <feImage href={href} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        <feDisplacementMap in="SourceGraphic" in2="map" scale={LENS_SCALE} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** bends `ref`'s box through the lens; returns its style and the matching filter definition */
function useLens(ref: MutableRefObject<HTMLElement | null>, on: boolean) {
  const [aspect, setAspect] = useState(0.45);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) setAspect(Math.min(3, Math.max(0.1, Math.round((h / w) * 20) / 20)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
  return on ? { style: { filter: `url(#${lensId(aspect)})` } as CSSProperties, defs: <FisheyeLens aspect={aspect} /> } : { style: undefined, defs: null };
}

/** a block of lyrics bent through the lens as a whole */
function LensBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const lens = useLens(ref, true);
  return (
    <div ref={ref} className="flex w-full flex-col items-center px-[2vw] py-[4vh]" style={lens.style}>
      {lens.defs}
      {children}
    </div>
  );
}

/** shown during instrumental gaps / before the first line */
function Breath() {
  return (
    <div className="flex gap-3" aria-label="Instrumental">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-3 w-3 rounded-full"
          style={{ background: HL }}
          animate={{ opacity: [0.2, 0.9, 0.2], scale: [0.85, 1.1, 0.85] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.25 }}
        />
      ))}
    </div>
  );
}

/** a pictogram for the word, if any; `dark` when it sits on a highlight block */
function WordIcon({ text, dark, ink }: { text: string; dark?: boolean; ink?: string }) {
  const Icon = iconFor(text);
  if (!Icon) return null;
  return <Icon aria-hidden style={{ width: '0.5em', height: '0.5em', color: dark ? '#160b12' : ink ?? HL, flex: 'none' }} strokeWidth={2.4} fill="currentColor" fillOpacity={0.9} />;
}

/**
 * The active line, word by word: sung words full, the current word highlighted, upcoming
 * words dim. Only used with REAL word timestamps — never with estimated ones.
 */
function LineWords({ words, word }: { words: LyricWord[]; word: number }) {
  return (
    <>
      {words.map((w, i) => (
        <span
          key={i}
          className="transition-[color,text-shadow] duration-200"
          style={{ color: i === word ? HL : i < word ? TEXT : 'rgb(243 239 234 / 0.45)', textShadow: i === word ? GLOW : undefined }}
        >
          {w.text}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

// =============================================================================================
// 1. REEL (reference: "Peak music setup", frame-by-frame at 24 fps)
//    prev (48%, left-aligned to the current word) · CURRENT · next (47%, on a solid block).
//    A step takes 3–4 frames (~0.15 s) and smears into stacked ghost copies of the reel at
//    slightly earlier moments — the "fishtank" look — then lands crisp.
//    Everything is a pure function of the playback clock: every frame recomputes each word's
//    pose from currentTime, so pause freezes it, seek jumps exactly, and nothing is scheduled.
// =============================================================================================
interface ReelWord { text: string; t: number; first: boolean; last: boolean }
type ReelRole = 'prev' | 'cur' | 'next' | 'card';
type Slot = { gi: number; role: ReelRole };
const CARD_LEAD = 0.45; // the upcoming line's first word is shown this long before it's sung
const STEP = 0.15; // seconds per word step (reference: 3–4 frames at 24 fps)
const TRAIL = 4; // stroboscopic copies trailing the motion
// a new line: the old one slips up and out while the new one glides up into place — quick, but
// eased, so it reads as one smooth motion instead of a cut
const LINE_IN = 0.26; // seconds for the new line to settle
const LINE_OUT_SHARE = 0.42; // the old line is gone within the first 42% of that (barely overlaps)
const PREV_S = 0.48;
const NEXT_S = 0.47;
const CARD_S = 1;

function reelState(words: ReelWord[], gaps: number[], t: number): Slot[] {
  let lo = 0;
  let hi = words.length - 1;
  let cur = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].t <= t) {
      cur = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const nx = cur + 1;
  const upcoming = words[nx];
  if (upcoming && upcoming.first && t >= upcoming.t - CARD_LEAD) return [{ gi: nx, role: 'card' }];
  if (cur < 0) return [];
  if (gaps.some((g) => g > words[cur].t && g <= t)) return [];
  const out: Slot[] = [];
  if (!words[cur].first && cur > 0) out.push({ gi: cur - 1, role: 'prev' });
  out.push({ gi: cur, role: 'cur' });
  if (!words[cur].last && upcoming) out.push({ gi: nx, role: 'next' });
  return out;
}

/** x/y in em of the reel font, s = scale, o = opacity, b = how much the word sits on its block */
interface Pose {
  x: number; y: number; s: number; o: number;
  /** the "tank" band behind the word (0–1) */
  b: number;
  /** how dark the ink is (1 = submerged in the band, 0 = cream) */
  k: number;
  /** how far the band has risen above the cap line as the word surfaces (0–1) */
  f: number;
}
/** measured at scale 1, in em: total width and where the text starts (after a leading icon) */
interface Geo { w: number; lead: number }

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const easeStep = (p: number) => 1 - Math.pow(1 - p, 3);
/** fast start, long soft landing: the new line arrives quickly and settles without a bump */
const easeArrive = (p: number) => 1 - Math.pow(1 - p, 5);
/** smooth both ends: the old line eases away rather than snapping */
const easeLeave = (p: number) => p * p * (3 - 2 * p);

/**
 * Reel surface treatments, all from the references:
 *  black   — "Peak music setup" / "Ambient lighting in your Mac": cream type, next word on a
 *            solid block in the light colour.
 *  overlay — "Rate the music setup": the reel sits straight on full-bleed album art; white type
 *            with a soft shadow, no blocks (the art stays visible, nothing is dimmed).
 *  ring    — "Music like this >>": the reel inside a circular frame (on that cover the circle is
 *            part of the artwork); pale block under the next word.
 */
type ReelVariant = 'black' | 'overlay' | 'ring';

function Reel({ lines, clock, size, o, variant = 'black' }: StyleProps & { variant?: ReelVariant }) {
  const { timings } = clock;
  const { words, gaps, events } = useMemo(() => {
    const words: ReelWord[] = [];
    const gaps: number[] = [];
    lines.forEach((l, li) => {
      if (!l.text.trim()) return void gaps.push(l.t);
      const ws = timings[li].words;
      ws.forEach((w, wi) => words.push({ text: w.text, t: w.t, first: wi === 0, last: wi === ws.length - 1 }));
    });
    // every moment the reel changes: a word is sung, a line's opening card appears, a gap starts
    const ev = new Set<number>(gaps);
    for (const w of words) {
      ev.add(w.t);
      if (w.first) ev.add(w.t - CARD_LEAD);
    }
    return { words, gaps, events: [...ev].sort((a, b) => a - b) };
  }, [lines, timings]);

  const geo = useRef(new Map<number, Geo>());
  const els = useRef(new Map<number, HTMLElement>());
  const box = useRef<HTMLDivElement>(null);
  const lens = useLens(box, o.fisheye);
  const [forWords, setForWords] = useState(words);
  if (forWords !== words) {
    setForWords(words);
    geo.current = new Map();
  }
  const geoOf = (gi: number): Geo => geo.current.get(gi) ?? { w: 0.56 * Math.min(words[gi]?.text.length ?? 4, 16), lead: 0 };
  const noBlock = variant === 'overlay';

  const poseOf = (gi: number, role: ReelRole, state: Slot[]): Pose => {
    const b = noBlock ? 0 : 1;
    // the group is centred as a whole: a line's first word (current + next, no previous yet) sits
    // higher, so a card surfacing into it also rises — that rise is the vertical smear in the reference
    const hasPrev = state.some((x) => x.role === 'prev');
    const hasNext = state.some((x) => x.role === 'next');
    const lift = hasNext && !hasPrev ? -0.33 : hasPrev && !hasNext ? 0.3 : 0;
    if (role === 'cur') return { x: 0, y: lift, s: 1, o: 1, b: 0, k: 0, f: 0 };
    if (role === 'card') return { x: 0, y: 0, s: CARD_S, o: 1, b, k: b, f: 0 };
    if (role === 'next') return { x: 0, y: 0.71 + lift, s: NEXT_S, o: 1, b, k: b, f: 0 };
    // prev: its text starts where the current word's text starts
    const cur = state.find((x) => x.role === 'cur');
    const g = geoOf(gi);
    let x = 0;
    if (cur) {
      const c = geoOf(cur.gi);
      x = -c.w / 2 + c.lead + 0.03 - g.lead * PREV_S + (g.w * PREV_S) / 2;
    }
    return { x, y: -0.84 + lift, s: PREV_S, o: 1, b: 0, k: 0, f: 0 };
  };

  /** all words and their poses at playback time τ */
  const frameAt = (τ: number) => {
    const to = reelState(words, gaps, τ);
    let lo = 0;
    let hi = events.length - 1;
    let i = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid] <= τ) {
        i = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const start = i >= 0 ? events[i] : -Infinity;
    const next = events[i + 1] ?? Infinity;
    let D = Math.max(0.06, Math.min(STEP, (next - start) * 0.8)) / o.speed;
    const target = new Map(to.map((x) => [x.gi, poseOf(x.gi, x.role, to)]));
    if (!Number.isFinite(start) || τ - start >= D) return { poses: target, start, D, p: 1, cut: false };
    const from = reelState(words, gaps, start - 1e-4);
    // a new line (or a gap) cuts in: the old reel fades where it stands, the card appears whole
    const cut = !to.length || to.some((x) => x.role === 'card' && !from.some((f) => f.gi === x.gi));
    // the line change gets its own (slightly longer) time, but never runs into the next lyric
    if (cut) D = Math.max(0.1, Math.min(LINE_IN, Number.isFinite(next) ? (next - start) * 0.85 : LINE_IN)) / o.speed;
    const p = Math.min(1, (τ - start) / D);
    if (p >= 1) return { poses: target, start, D, p: 1, cut };
    const e = easeStep(p);
    const band = noBlock ? 0 : 1;
    const out = new Map<number, Pose>();
    const src = new Map(from.map((x) => [x.gi, poseOf(x.gi, x.role, from)]));
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    for (const gi of new Set([...src.keys(), ...target.keys()])) {
      if (cut) {
        const from = src.get(gi);
        const to = target.get(gi);
        if (from && !to) {
          // the old line: drifts up a little, shrinks a touch and fades — gone in ~0.15 s
          const q = easeLeave(clamp01(p / LINE_OUT_SHARE));
          out.set(gi, { ...from, y: from.y - 0.42 * q, s: from.s * (1 - 0.08 * q), o: 1 - q });
          continue;
        }
        if (to && !from) {
          // the new line: rises from just below, growing from 90 %, fading in a little ahead of the move
          const m = easeArrive(p);
          const fade = easeStep(clamp01((p - 0.12) / 0.55)); // starts as the old line clears
          out.set(gi, { ...to, y: to.y + 0.32 * (1 - m), s: to.s * (0.9 + 0.1 * m), o: fade });
          continue;
        }
      }
      const a = src.get(gi) ?? { x: 0, y: (target.get(gi)?.y ?? 0.71) + 0.3, s: NEXT_S * 0.85, o: 0, b: band, k: band, f: 0 }; // next word: a short rise into its slot
      const z = target.get(gi) ?? { ...a, y: a.y - 0.14, s: a.s * 0.94, o: 0 }; // oldest word: fades in place, tiny upward drift
      const leaving = !target.has(gi) && !cut;
      const pose: Pose = {
        x: lerp(a.x, z.x, e),
        y: lerp(a.y, z.y, e),
        s: lerp(a.s, z.s, e),
        o: lerp(a.o, z.o, cut ? p : leaving ? clamp01(p * 2) : e),
        b: lerp(a.b, z.b, p),
        k: lerp(a.k, z.k, p),
        f: 0,
      };
      if (a.b > 0.5 && z.b < 0.5) {
        // surfacing (next/card -> current): the band rises past the word while it grows,
        // then within a frame the ink turns cream and the band drains away
        pose.f = clamp01(p / 0.45);
        pose.k = clamp01(1 - (p - 0.45) / 0.12);
        pose.b = clamp01(1 - (p - 0.45) / 0.3);
      }
      out.set(gi, pose);
    }
    return { poses: out, start, D, p, cut };
  };

  const [tick, setTick] = useState(0);
  const last = useRef({ sig: '', moving: false, t: NaN });
  useFrame(() => {
    const t = clock.tRef.current;
    const f = frameAt(t);
    const moving = t - f.start < f.D * 1.9;
    const sig = [...f.poses.keys()].join(',');
    if (moving || last.current.moving || sig !== last.current.sig) setTick((n) => n + 1);
    last.current = { sig, moving, t };
  });
  void tick;

  // measure each word once (em are relative to the reel font, so resizing doesn't invalidate them)
  useLayoutEffect(() => {
    let px = 0;
    for (const [gi, el] of els.current) {
      if (geo.current.has(gi)) continue;
      px ||= box.current ? parseFloat(getComputedStyle(box.current).fontSize) : 0;
      if (!px) return;
      const text = el.querySelector<HTMLElement>('[data-reel-text]');
      geo.current.set(gi, { w: el.offsetWidth / px, lead: (text?.offsetLeft ?? 0) / px });
    }
  });
  useEffect(() => {
    // web fonts arriving change widths
    const reset = () => (geo.current = new Map());
    document.fonts?.addEventListener?.('loadingdone', reset);
    return () => document.fonts?.removeEventListener?.('loadingdone', reset);
  }, []);

  const t = clock.tRef.current;
  const main = frameAt(t);
  const smear = last.current.moving;
  // ghosts: the same reel a few milliseconds earlier, spread over ~60% of the step
  // how fast things are moving right now (0 at rest, 1 mid-step) drives the smear
  // (a line cut is a plain crossfade: no smear)
  const speed = smear && main.p < 1 && !main.cut ? Math.sin(Math.PI * Math.min(1, main.p * 1.1)) : 0;
  const layers: { poses: Map<number, Pose>; alpha: number; ghost: boolean; blur: number }[] = [
    { poses: main.poses, alpha: 1 - 0.4 * speed, ghost: false, blur: 0.016 * speed },
  ];
  if (speed > 0.05)
    for (let j = 1; j <= TRAIL; j++) layers.push({ poses: frameAt(t - j * main.D * 0.12).poses, alpha: (0.4 - j * 0.07) * speed, ghost: true, blur: 0.012 });

  // reference ink: a warm yellow-cream nudged toward the light ("Text tint"), barely any bloom
  const ink = variant === 'overlay' ? '#f7f4ef' : variant === 'ring' ? '#fbf7ec' : 'color-mix(in srgb, var(--ly-hl) calc(var(--ly-tint) * 100%), #fff0c8)';
  const shadow = variant === 'black'
    ? '0 0 calc(0.32em * var(--ly-glow)) color-mix(in srgb, var(--ly-hl) calc(var(--ly-glow) * 28%), transparent)'
    : '0 0.03em 0.22em rgb(0 0 0 / 0.5), 0 0 0.6em rgb(0 0 0 / 0.25)';
  const blockBg = variant === 'ring' ? 'color-mix(in srgb, var(--ly-hl) 35%, #fff6d6)' : HL;
  const empty = !main.poses.size;

  return (
    <div
      ref={box}
      className={cx('relative translate-y-[0.32em]', o.fisheye ? 'mx-auto h-[3.4em] w-[min(100%,5.8em)]' : 'h-[2.7em] w-full')}
      style={{ ...LYRIC_FONT, ...REEL_FONT, ...lens.style, fontSize: `calc(clamp(52px, min(22vh, 13vw), 250px) * ${size})` }}
    >
      {lens.defs}
      {variant === 'ring' && <ReelRing />}
      {empty && <div className="absolute inset-0 flex items-center justify-center text-[16px]"><Breath /></div>}
      {layers.map((L, li) =>
        [...L.poses].map(([gi, p]) => {
          const w = words[gi];
          if (!w || p.o <= 0.01) return null;
          const Icon = iconFor(w.text);
          const lead = Icon && LEADING_ICONS.has(Icon);
          const fit = Math.min(1, 9 / Math.max(1, [...w.text].length)); // long words shrink to fit
          const icon = Icon && <Icon aria-hidden style={{ width: '0.6em', height: '0.6em', flex: 'none', color: HL }} strokeWidth={2.4} fill="currentColor" />;
          return (
            <div
              key={`${li}:${gi}`}
              ref={li === 0 ? (el) => void (el ? els.current.set(gi, el) : els.current.delete(gi)) : undefined}
              aria-hidden={L.ghost || undefined}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) translate(${p.x}em, ${p.y}em) scale(${p.s})`,
                opacity: p.o * L.alpha,
                filter: L.blur > 0.004 && !o.fisheye ? `blur(${L.blur.toFixed(3)}em)` : undefined, // inside the lens the bend already softens it
                zIndex: L.ghost ? 0 : 1,
                // GPU layers only while moving: blur/scale run on the compositor; at rest the layer is
                // dropped so the type re-renders crisp at full size
                willChange: smear ? 'transform, opacity, filter' : undefined,
              }}
            >
              <span
                className="inline-flex items-center gap-[0.2em] whitespace-nowrap leading-[1.12]"
                style={{ fontSize: `${fit}em`, fontStyle: w.first ? 'italic' : 'normal' }}
              >
                {lead && icon}
                <span data-reel-text className="relative">
                  {p.b > 0.01 && (
                    // the "tank": cap line to baseline, leaning like the type. Dark ink outside it
                    // vanishes into the black, so ascenders touch its rim and descenders are cut off.
                    <span
                      aria-hidden
                      className="absolute -left-[0.035em] -right-[0.015em] bottom-[0.17em]"
                      style={{ top: `${(0.225 - 0.37 * p.f).toFixed(3)}em`, background: blockBg, opacity: p.b, transform: 'skewX(-7deg)' }}
                    />
                  )}
                  <span
                    className="relative"
                    style={{
                      color: p.k > 0.01 ? `color-mix(in srgb, #170c02 ${Math.round(p.k * 100)}%, ${ink})` : ink,
                      textShadow: L.ghost || p.k > 0.5 ? undefined : shadow,
                    }}
                  >
                    {w.text}
                  </span>
                </span>
                {!lead && icon}
              </span>
            </div>
          );
        }),
      )}
    </div>
  );
}

/** reference type: Apple's San Francisco (SF Pro Display Bold) — the Mac system font, used from the system where present (it can't be bundled); elsewhere Inter Tight, its closest open-licence match */
const REEL_FONT: CSSProperties = {
  fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter Tight Variable', 'Noto Sans Devanagari Variable', 'Noto Sans Gurmukhi Variable', 'Nirmala UI', sans-serif",
  fontWeight: 'min(var(--ly-w), 720)' as unknown as number,
  letterSpacing: '-0.035em',
};

/** the circular frame of the "Music like this" cover: a heavy ring, a fine tick ring inside it */
function ReelRing() {
  return (
    <svg aria-hidden viewBox="-50 -50 100 100" className="pointer-events-none absolute left-1/2 top-1/2 h-[2.5em] w-[2.5em] -translate-x-1/2 -translate-y-1/2 overflow-visible">
      <circle r="46" fill="none" stroke="rgb(20 18 14 / 0.82)" strokeWidth="4.2" />
      <circle r="40.5" fill="none" stroke="rgb(20 18 14 / 0.55)" strokeWidth="2.4" strokeDasharray="0.9 1.6" />
      <circle r="37" fill="none" stroke="color-mix(in srgb, var(--ly-hl) 50%, white)" strokeOpacity="0.35" strokeWidth="0.5" />
    </svg>
  );
}

// =============================================================================================
// 2. STACK (reference: "Can't stop looking at my screen" + the pink/red videos)
//    The line builds up as a vertical pile of words: newest at the bottom on a highlight block,
//    earlier words keep a size set by how much they carry (nouns big, "the/to/you" small),
//    staggered slightly left/right, two-tone gradient type, pictograms, a vertical smear on
//    entry, and the whole pile blurs away when the next line begins.
// =============================================================================================
// Deterministic, restrained emphasis — no guessing at meaning: function words (English, Roman
// Hindi and Devanagari) stay small, other words grow with their length.
const SMALL = new Set(
  [
    "a an the to of and or but in on at i i'm im is it it's be for if so my your you me we he she they was were with as by that this do am are oh just up from",
    'ka ki ke ko se me mein main hai hain ho tha thi the na naa toh to bhi ye yeh wo woh tu tum hum mera meri mere tera teri tere ek aur par pe jo',
    'का की के को से में मैं है हैं हो था थी थे ना न तो भी ये यह वो वह तू तुम हम मेरा मेरी मेरे तेरा तेरी तेरे एक और पर पे जो',
  ]
    .join(' ')
    .split(' '),
);
// letters + combining marks, so Devanagari words (vowel signs are marks) are measured whole
const bareWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{M}']/gu, '');
const weightOf = (w: string) => {
  const b = bareWord(w);
  // count user-perceived characters (a Devanagari consonant + its vowel sign is one)
  const len = [...b].filter((c) => !/\p{M}/u.test(c)).length;
  return SMALL.has(b) ? 0.46 : len <= 3 ? 0.62 : len <= 5 ? 0.8 : 0.92;
};

function Stack({ lines, clock, size, o }: StyleProps) {
  const { line, word, timings } = clock;
  const l = lines[line];
  if (!l || !l.text.trim()) return <Breath />;
  const words = timings[line].words;
  const upto = Math.max(0, word);
  const visible = words.slice(Math.max(0, upto - 3), upto + 1).map((w, n, arr) => ({ ...w, i: upto - (arr.length - 1 - n) }));
  const gap = words[upto + 1] ? words[upto + 1].t - words[upto].t : 1;
  const k = Math.min(1, Math.max(0.4, (gap * 0.75) / 0.32)) / o.speed;
  return (
    <AnimatePresence mode="popLayout">
      <motion.div
        key={line}
        exit={{ opacity: 0, y: '-0.5em', filter: 'blur(14px)' }}
        transition={{ duration: 0.35 * k, ease: EASE }}
        className="flex flex-col items-center"
        style={{ ...LYRIC_FONT, fontSize: `calc(clamp(52px, 8.4vw, 150px) * ${size})` }}
      >
        {visible.map((w) => {
          const newest = w.i === upto && word >= 0;
          const imp = weightOf(w.text);
          const em = newest ? imp * 1.08 : imp * 0.9;
          const dx = newest ? 0 : (hash(line * 13 + w.i) - 0.5) * 3.6;
          const Icon = iconFor(w.text);
          const lead = Icon && LEADING_ICONS.has(Icon);
          return (
            <motion.div
              key={`${line}-${w.i}`}
              layout="position"
              initial={{ opacity: 0, y: '0.7em', scaleY: 1.9, filter: 'blur(9px)' }}
              animate={{ opacity: 1, y: 0, scaleY: 1, filter: 'blur(0px)', x: `${dx}em` }}
              transition={{ duration: 0.32 * k, ease: EASE, layout: { duration: 0.28 * k, ease: EASE } }}
              className="relative flex origin-bottom items-center gap-[0.14em] whitespace-nowrap"
              style={{ fontSize: `${em}em`, lineHeight: 1.04, fontWeight: 900, letterSpacing: '-0.025em' }}
            >
              <motion.span
                aria-hidden
                className="absolute -inset-x-[0.12em] inset-y-[0.02em] rounded-[0.08em]"
                style={{ background: `linear-gradient(100deg, color-mix(in srgb, ${HL2} 75%, ${HL}), ${HL})`, boxShadow: '0 0 0.5em color-mix(in srgb, var(--ly-hl) 40%, transparent)' }}
                initial={false}
                animate={{ opacity: newest ? 1 : 0 }}
                transition={{ duration: 0.25 * k }}
              />
              {lead && <span className="relative"><WordIcon text={w.text} dark={newest} /></span>}
              <span
                className="relative"
                style={
                  newest
                    ? { color: 'color-mix(in srgb, #ffeab8 88%, var(--ly-hl))', filter: 'var(--ly-art-shadow, none)' }
                    : {
                        backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${HL} 55%, white), color-mix(in srgb, ${HL2} 80%, ${HL}))`,
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        color: 'transparent',
                        filter: 'drop-shadow(0 0 0.25em color-mix(in srgb, var(--ly-hl) calc(var(--ly-glow) * 50%), transparent)) var(--ly-art-shadow, )',
                      }
                }
              >
                {w.text}
              </span>
              {Icon && !lead && <span className="relative"><WordIcon text={w.text} dark={newest} /></span>}
            </motion.div>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}

// =============================================================================================
// 3. CINEMATIC FADE — previous fades upward, current centred, next waits softly below
// 6. VERTICAL SCROLL — a column of lines; the active one stays centred and lit
// 7. BLUR FOCUS      — like scroll, everything but the active line is out of focus
// One layout-animated list (handles wrapped lines); placeholders keep the active line centred.
// =============================================================================================
function LineList({ lines, clock, size, o, span, mode }: StyleProps & { span: number; mode: 'cinematic' | 'scroll' | 'focus' }) {
  const { line, word, timings } = clock;
  const k = 1 / o.speed;
  // line changes: quick but eased (EASE has a long soft landing, so short durations still read smooth)
  const slow = mode === 'cinematic' ? 0.48 : mode === 'focus' ? 0.4 : 0.36;
  // instrumental-gap lines never occupy a neighbour slot; only the ACTIVE gap shows (as a rest)
  const shown = useMemo(() => lines.map((_, i) => i).filter((i) => lines[i].text.trim() || i === line), [lines, line]);
  let pos = 0;
  for (let p = 0; p < shown.length; p++) if (shown[p] <= Math.max(0, line)) pos = p;
  const slots: { i: number; d: number }[] = [];
  for (let d = -span; d <= span; d++) slots.push({ i: shown[pos + d] ?? -1 - (pos + d + 100), d });
  const fs = mode === 'cinematic' ? `calc(clamp(32px, 4.8vw, 84px) * ${size})` : `calc(clamp(26px, 3.6vw, 62px) * ${size})`;
  return (
    <div
      className={cx('flex w-full flex-col justify-center px-[var(--ly-pad)] [mask-image:linear-gradient(transparent,black_14%,black_86%,transparent)]', alignText(o.align))}
      style={{ ...LYRIC_FONT, fontSize: fs, gap: `calc(0.42em * var(--ly-lh))`, maxHeight: '86%' }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {slots.map(({ i, d }) => {
          const l = lines[i];
          if (!l) return <div key={`gap${d}`} aria-hidden style={{ height: `calc(1.12em * var(--ly-lh))` }} />;
          const active = d === 0 && line >= 0;
          const ad = Math.abs(d);
          const t = timings[i];
          const showWords = active && o.wordHL && !t.estimated && t.words.length > 0;
          const opacity = active ? 1 : mode === 'cinematic' ? (ad === 1 ? 0.34 : 0) : mode === 'focus' ? Math.max(0.14, 0.55 - ad * 0.12) : Math.max(0.12, 0.5 - ad * 0.1);
          const blur = active ? 0 : mode === 'focus' ? 2.5 + ad * 2 : mode === 'cinematic' ? 2 : ad * 0.4;
          return (
            <motion.p
              key={i}
              layout="position"
              initial={{ opacity: 0, y: '0.8em', filter: 'blur(8px)' }}
              animate={{ opacity, y: 0, filter: `blur(${blur}px)`, scale: active ? 1 : mode === 'scroll' ? 0.86 : 0.8 }}
              exit={{ opacity: 0, y: '-0.8em', filter: 'blur(8px)' }}
              transition={{ duration: slow * k, ease: EASE, layout: { duration: slow * k, ease: EASE } }}
              className={cx('text-balance', o.align === 'left' ? 'origin-left' : o.align === 'right' ? 'origin-right' : 'origin-center')}
              style={{
                lineHeight: LH,
                fontWeight: active ? WEIGHT : LIGHTER,
                letterSpacing: active ? '-0.015em' : '0.005em',
                color: active ? (showWords ? undefined : HL) : 'rgb(243 239 234)',
                textShadow: active && !showWords ? GLOW : undefined,
              }}
            >
              {showWords ? <LineWords words={t.words} word={word} /> : l.text || <span className="text-[0.5em] tracking-[0.3em] opacity-60">•••</span>}
            </motion.p>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// =============================================================================================
// 2. KARAOKE — each word fills as it is sung. Requires REAL word timestamps: with line-only
//    timing the whole line lights up instead (no invented per-word timing).
// =============================================================================================
function wordProgress(words: LyricWord[], i: number, line: LyricLine, t: number) {
  if (i < 0) return 0;
  const start = words[i].t;
  const end = words[i + 1]?.t ?? Math.min(line.end, start + 1.2);
  return Math.max(0, Math.min(1, (t - start) / Math.max(0.05, end - start)));
}

function Karaoke({ lines, clock, size, o }: StyleProps) {
  const { line, word, timings, tRef } = clock;
  const activeRef = useRef<HTMLSpanElement>(null);
  const l = lines[line];
  const real = !!l && !timings[line].estimated && o.wordHL;
  useFrame(() => {
    const el = activeRef.current;
    if (!el || !l || !real) return;
    const v = `${Math.round(wordProgress(timings[line].words, word, l, tRef.current) * 100)}%`;
    if (el.style.getPropertyValue('--p') !== v) el.style.setProperty('--p', v); // 1% steps: no repaint when nothing changed
  });
  if (!l || !l.text.trim()) return <Breath />;
  const words = timings[line].words;
  const next = lines[line + 1];
  const k = 1 / o.speed;
  return (
    <div className={cx('flex w-full flex-col gap-[0.6em] px-[var(--ly-pad)]', alignText(o.align))} style={{ ...LYRIC_FONT, fontSize: `calc(clamp(32px, 4.8vw, 84px) * ${size})` }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={line}
          initial={{ opacity: 0.4, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -18, transition: { duration: 0.18 * k } }}
          transition={{ duration: 0.25 * k, ease: EASE }}
          className="text-balance"
          style={{ fontWeight: WEIGHT, letterSpacing: '-0.02em', lineHeight: LH }}
        >
          {real
            ? words.map((w, i) => (
                <span
                  key={i}
                  ref={i === word ? activeRef : undefined}
                  className="inline-block whitespace-pre"
                  style={
                    {
                      '--p': i < word ? '100%' : '0%',
                      backgroundImage: `linear-gradient(90deg, ${HL} var(--p), rgb(243 239 234 / 0.24) var(--p))`,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                      textShadow: undefined,
                    } as CSSProperties
                  }
                >
                  {w.text}
                  {i < words.length - 1 ? ' ' : ''}
                </span>
              ))
            : <span style={{ color: HL, textShadow: GLOW }}>{l.text}</span>}
        </motion.p>
      </AnimatePresence>
      {next?.text && <p className="text-[0.5em] text-ink/30" style={{ fontWeight: LIGHTER }}>{next.text}</p>}
    </div>
  );
}

// =============================================================================================
// 5. MINIMAL — only the current line, soft fade in/out
// =============================================================================================
function Minimal({ lines, clock, size, o }: StyleProps) {
  const l = lines[clock.line];
  const k = 1 / o.speed;
  return (
    <div className={cx('flex w-full flex-col px-[var(--ly-pad)]', alignText(o.align))} style={{ ...LYRIC_FONT, fontSize: `calc(clamp(28px, 3.8vw, 64px) * ${size})` }}>
      <AnimatePresence mode="wait">
        <motion.p
          key={clock.line}
          initial={{ opacity: 0, filter: 'blur(6px)' }}
          animate={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(6px)' }}
          transition={{ duration: 0.6 * k, ease: 'easeInOut' }}
          className="text-balance tracking-[0.01em]"
          style={{ color: TEXT, fontWeight: WEIGHT, lineHeight: LH, textShadow: GLOW }}
        >
          {l?.text || ' '}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/** the four-point sparkle used for constellation nodes ("The perfect late night setup") */
function StarNode({ active, sung }: { active: boolean; sung: boolean }) {
  return (
    <span className="relative flex h-[1.1em] w-[1.1em] items-center justify-center" aria-hidden>
      {active && (
        <motion.span
          className="absolute h-[1.5em] w-[1.5em] rounded-full"
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--ly-hl) 85%, white) 0%, var(--ly-hl) 38%, transparent 70%)', boxShadow: '0 0 0.9em var(--ly-hl)' }}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        />
      )}
      <svg viewBox="-10 -10 20 20" className="relative h-full w-full overflow-visible">
        <path
          d="M0 -9 C0.9 -2.2 2.2 -0.9 9 0 C2.2 0.9 0.9 2.2 0 9 C-0.9 2.2 -2.2 0.9 -9 0 C-2.2 -0.9 -0.9 -2.2 0 -9 Z"
          fill={active ? '#fff2f2' : 'color-mix(in srgb, var(--ly-hl) 45%, #f3d6da)'}
          opacity={active ? 1 : sung ? 0.95 : 0.6}
          transform={active ? 'scale(0.75)' : 'scale(0.62)'}
        />
      </svg>
    </span>
  );
}

/**
 * 4. CONSTELLATION ("The perfect late night setup") — the current line laid out as a star chart.
 * Every word of the line sits beside a four-point star; a hairline joins the stars in word order
 * (zig-zagging across the screen, so lines cross); the sung part of the path is brighter; the word
 * being sung grows large on a glowing node. Positions are a deterministic jittered grid per line
 * (no overlaps, stable across renders). The slow drift follows the PLAYBACK clock, so it stops
 * when the music pauses. The constellation changes exactly when the next line's timestamp hits.
 */
function Constellation({ lines, clock, size, o }: StyleProps) {
  const { line, word, timings, tRef } = clock;
  const l = lines[line];
  const drift = useRef<HTMLDivElement>(null);
  useFrame(() => {
    const t = tRef.current * o.speed;
    if (drift.current) drift.current.style.transform = `translate(${Math.sin(t * 0.31) * 9}px, ${Math.sin(t * 0.43 + 1) * 7}px) rotate(${Math.sin(t * 0.17) * 0.6}deg)`;
  });
  const nodes = useMemo(() => {
    if (!l || !l.text.trim()) return [];
    const ws = timings[line].words;
    const n = ws.length;
    const cols = n <= 8 ? 4 : n <= 12 ? 4 : 5;
    const rows = Math.max(2, Math.ceil(n / cols) + (n > 4 ? 1 : 0));
    // deterministic shuffle of grid cells for this line
    const cells = Array.from({ length: cols * rows }, (_, i) => i).sort((a, b) => hash(line * 97 + a) - hash(line * 97 + b));
    return ws.map((w, i) => {
      const c = cells[i % cells.length];
      const cx = (c % cols) + 0.5;
      const cy = Math.floor(c / cols) + 0.5;
      return {
        w,
        x: 6 + (88 * (cx + (hash(line * 13 + i) - 0.5) * 0.55)) / cols,
        y: 8 + (84 * (cy + (hash(line * 29 + i * 7) - 0.5) * 0.45)) / rows,
        weight: weightOf(w.text),
      };
    });
  }, [l, line, timings]);
  if (!l || !l.text.trim()) return <Breath />;
  const pts = (list: typeof nodes) => list.map((p) => `${p.x},${p.y}`).join(' ');
  const k = 1 / o.speed;
  return (
    <div ref={drift} className="relative h-[56%] w-[min(1050px,74%)]" style={{ ...LYRIC_FONT, fontSize: `calc(clamp(13px, 1.25vw, 22px) * ${size})` }}>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={line}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02, filter: 'blur(6px)' }}
          transition={{ duration: 0.55 * k, ease: EASE }}
          className="absolute inset-0"
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            {/* the whole line's path, faint — drawn in as the line starts */}
            <motion.polyline
              points={pts(nodes)}
              fill="none"
              stroke="color-mix(in srgb, var(--ly-hl) 40%, #f1d4d8)"
              strokeOpacity={0.5}
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 1 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 * k, ease: 'easeOut' }}
            />
            {/* the part already sung, brighter */}
            {word > 0 && (
              <polyline points={pts(nodes.slice(0, word + 1))} fill="none" stroke="color-mix(in srgb, var(--ly-hl) 55%, #ffe4e7)" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 1.2 }} />
            )}
          </svg>
          {nodes.map((p, i) => {
            const active = i === word;
            const sung = i < word;
            const em = active ? 2.5 : p.weight >= 0.8 ? 1.45 : 1;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.35 * k, delay: Math.min(0.5, i * 0.035) * k, ease: EASE }}
                className="absolute"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <div className="-translate-x-1/2 -translate-y-1/2">
                  <StarNode active={active} sung={sung} />
                </div>
                {/* the label sits just off the node, like the reference */}
                <span
                  className="absolute left-[0.35em] top-[-0.2em] origin-bottom-left -translate-y-full whitespace-nowrap leading-none transition-[font-size,color,opacity] duration-300"
                  style={{
                    fontSize: `${em}em`,
                    fontWeight: active ? 'max(700, var(--ly-w))' : p.weight >= 0.8 ? 700 : 600,
                    color: active ? 'color-mix(in srgb, var(--ly-hl) 22%, #fff3f4)' : sung ? 'color-mix(in srgb, var(--ly-hl) 35%, #f4dde0)' : 'color-mix(in srgb, var(--ly-hl) 30%, #c9b3b6)',
                    opacity: active ? 1 : sung ? 0.9 : 0.62,
                    textShadow: active ? '0 0 0.5em color-mix(in srgb, var(--ly-hl) 55%, transparent)' : undefined,
                  }}
                >
                  {p.w.text}
                </span>
              </motion.div>
            );
          })}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// =============================================================================================
// 4. TYPEWRITER — characters revealed by the line's actual timing (word stamps when present,
//    otherwise paced across the line's own start→end). Never ahead of the playback position.
// =============================================================================================
function Typewriter({ lines, clock, size, o }: StyleProps) {
  const { line, timings, tRef } = clock;
  const shownRef = useRef<HTMLSpanElement>(null);
  const restRef = useRef<HTMLSpanElement>(null);
  const l = lines[line];
  const prev = lines[line - 1];
  const plan = useMemo(() => {
    if (!l) return null;
    const ws = timings[line].words;
    let c = 0;
    return ws.map((w, i) => {
      const startChar = c;
      c += w.text.length + (i < ws.length - 1 ? 1 : 0);
      return { ...w, startChar, len: w.text.length };
    });
  }, [l, line, timings]);
  useFrame(() => {
    if (!plan || !l || !shownRef.current || !restRef.current) return;
    const t = tRef.current;
    let chars = 0;
    for (let i = 0; i < plan.length; i++) {
      const w = plan[i];
      if (t < w.t) break;
      const end = plan[i + 1]?.t ?? Math.min(l.end, w.t + 1);
      const p = Math.min(1, (t - w.t) / Math.max(0.05, end - w.t));
      chars = w.startChar + Math.ceil(w.len * Math.min(1, p * 1.4)) + (p >= 0.7 && i < plan.length - 1 ? 1 : 0);
    }
    const a = l.text.slice(0, chars);
    if (shownRef.current.textContent !== a) {
      shownRef.current.textContent = a;
      restRef.current.textContent = l.text.slice(chars);
    }
  });
  if (!l || !l.text.trim()) return <Breath />;
  return (
    <div className={cx('flex w-full flex-col gap-[0.5em] px-[var(--ly-pad)]', alignText(o.align))} style={{ fontFamily: "'JetBrains Mono Variable', monospace", fontSize: `calc(clamp(24px, 3.2vw, 54px) * ${size})` }}>
      {prev?.text && <p className="text-[0.55em] font-medium text-ink/30">{prev.text}</p>}
      <p key={line} className="text-balance" style={{ color: TEXT, fontWeight: 'min(700, var(--ly-w))', lineHeight: LH, textShadow: GLOW }}>
        <span ref={shownRef} />
        <motion.span
          aria-hidden
          className="mx-[0.04em] inline-block h-[0.95em] w-[0.08em] translate-y-[0.12em]"
          style={{ background: HL }}
          animate={{ opacity: [1, 0, 1] }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <span ref={restRef} className="opacity-0" />
      </p>
    </div>
  );
}

// =============================================================================================
// 8. GLOWING AMBIENT — big soft line whose glow breathes with the music's energy
// =============================================================================================
function Glow({ lines, clock, size, o }: StyleProps) {
  const l = lines[clock.line];
  const ref = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLParagraphElement>(null);
  const lvl = useRef(0);
  const last = useRef(-1);
  // The halo is a blurred copy of the text rasterised ONCE; per frame only its opacity and the
  // block's scale change, which the compositor handles without repainting the (large) text.
  useFrame((f) => {
    if (!ref.current || !halo.current) return;
    const e = f.live * (0.6 * f.features.energy + 0.4 * f.features.bass);
    lvl.current += (e - lvl.current) * 0.15;
    const g = Math.round(lvl.current * 200) / 200;
    if (g === last.current) return;
    last.current = g;
    halo.current.style.opacity = String(0.3 + 0.7 * g);
    ref.current.style.transform = `scale(${1 + 0.025 * g})`;
  });
  const k = 1 / o.speed;
  return (
    <div className={cx('flex w-full flex-col px-[var(--ly-pad)]', alignText(o.align))} style={{ ...LYRIC_FONT, fontSize: `calc(clamp(34px, 5.2vw, 92px) * ${size})` }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={clock.line}
          initial={{ opacity: 0, y: 16, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -16, filter: 'blur(10px)' }}
          transition={{ duration: 0.7 * k, ease: EASE }}
        >
          <div ref={ref} className="relative will-change-transform" style={{ fontWeight: WEIGHT, lineHeight: LH, letterSpacing: '-0.01em' }}>
            <p
              ref={halo}
              aria-hidden
              className="pointer-events-none absolute inset-0 text-balance will-change-[opacity]"
              style={{ color: HL, filter: 'blur(calc(0.12em + 0.3em * var(--ly-glow)))', opacity: 0.3 }}
            >
              {l?.text || ' '}
            </p>
            <p className="relative text-balance" style={{ color: 'color-mix(in srgb, var(--ly-hl) 30%, #fffaf2)', textShadow: GLOW }}>
              {l?.text || ' '}
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// =============================================================================================
// 9. WORD-BY-WORD REVEAL — words appear as they're sung (never before); current word lit
// =============================================================================================
function Reveal({ lines, clock, size, o }: StyleProps) {
  const { line, word, timings } = clock;
  const l = lines[line];
  if (!l || !l.text.trim()) return <Breath />;
  const words = timings[line].words;
  const prev = lines[line - 1];
  const k = 1 / o.speed;
  return (
    <div className={cx('flex w-full flex-col gap-[0.5em] px-[var(--ly-pad)]', alignText(o.align))} style={{ ...LYRIC_FONT, fontSize: `calc(clamp(32px, 4.8vw, 84px) * ${size})` }}>
      {prev?.text && <p className="text-[0.45em] text-ink/25" style={{ fontWeight: LIGHTER }}>{prev.text}</p>}
      <p key={line} className="text-balance" style={{ fontWeight: WEIGHT, lineHeight: LH, letterSpacing: '-0.015em' }}>
        {words.map((w, i) => {
          const sung = i <= word;
          const current = i === word && o.wordHL;
          return (
            <motion.span
              key={i}
              className="inline-block whitespace-pre"
              initial={false}
              animate={{ opacity: sung ? 1 : 0, y: sung ? 0 : '0.35em', filter: sung ? 'blur(0px)' : 'blur(6px)' }}
              transition={{ duration: 0.28 * k, ease: EASE }}
              style={{ color: current ? HL : TEXT, textShadow: current ? GLOW : undefined }}
            >
              {w.text}
              {i < words.length - 1 ? ' ' : ''}
            </motion.span>
          );
        })}
      </p>
    </div>
  );
}

// =============================================================================================
export function SyncedLyrics({
  lines, style, offset, size, position, className, timeSource, compact,
}: {
  lines: LyricLine[];
  style: LyricsStyle;
  offset: number;
  size: number;
  position: LyricsPosition;
  className?: string;
  /** settings preview only */
  timeSource?: () => number;
  compact?: boolean;
}) {
  const live = useLyricClock(lines, offset, timeSource);
  const s = useSettings((x) => x);
  // scrolling / dragging over the lyrics browses them; the clock takes over again after a pause
  const browse = useLyricBrowse(lines, live.line, s.lyricsResumeSec, !timeSource);
  const browsedT = useRef({ current: 0 });
  let clock = live;
  if (browse.line !== null && lines[browse.line]) {
    browsedT.current.current = lines[browse.line].t + 0.01;
    clock = { ...live, line: browse.line, word: 0, tRef: browsedT.current };
  }
  const o: Opts = { speed: s.lyricsSpeed, wordHL: s.wordHighlight, visible: s.lyricsLines, align: s.lyricsAlign, fisheye: s.lyricsFisheye };
  // the reel styles size their own lens; the star chart stays flat; everything else bends as a block
  const wrapLens = s.lyricsFisheye && !['reel', 'overlay', 'ring', 'floating'].includes(style);
  const props = { lines, clock, size, o };
  const span = Math.max(1, Math.floor((s.lyricsLines - 1) / 2));
  const vars = {
    '--ly-hl': s.lyricsHighlight || 'var(--glow-p)',
    '--ly-hl2': s.lyricsHighlight ? `color-mix(in srgb, ${s.lyricsHighlight} 55%, #6d2cff)` : 'var(--glow-s)',
    '--ly-tint': String(s.lyricsTint),
    '--ly-text': `color-mix(in srgb, var(--ly-hl) ${Math.round(s.lyricsTint * 100)}%, #fff6ea)`,
    '--ly-art-shadow': s.lyricsArtwork !== 'off' ? 'drop-shadow(0 0.05em 0.18em rgb(0 0 0 / 0.55))' : undefined,
    '--ly-w': String(s.lyricsWeight),
    '--ly-lh': String(s.lyricsLineSpacing),
    '--ly-glow': String(s.lyricsGlow),
    '--ly-pad': compact && timeSource ? '14px' : '7vw',
  } as CSSProperties;
  let body: ReactNode = null;
  switch (style) {
    case 'reel': body = <Reel {...props} />; break;
    case 'overlay': body = <Reel {...props} variant="overlay" />; break;
    case 'ring': body = <Reel {...props} variant="ring" />; break;
    case 'kinetic': body = <Stack {...props} />; break;
    case 'cinematic': body = <LineList {...props} span={1} mode="cinematic" />; break;
    case 'scroll': body = <LineList {...props} span={span} mode="scroll" />; break;
    case 'focus': body = <LineList {...props} span={span} mode="focus" />; break;
    case 'karaoke': body = <Karaoke {...props} />; break;
    case 'minimal': body = <Minimal {...props} />; break;
    case 'floating': body = <Constellation {...props} />; break;
    case 'typewriter': body = <Typewriter {...props} />; break;
    case 'glow': body = <Glow {...props} />; break;
    case 'reveal': body = <Reveal {...props} />; break;
  }
  return (
    <div
      className={cx(
        'relative flex h-full w-full flex-col items-center',
        position === 'upper' ? (compact ? 'justify-start pt-4' : 'justify-start pt-[8vh]') : position === 'lower' ? (compact ? 'justify-end pb-4' : 'justify-end pb-[6vh]') : 'justify-center',
        className,
      )}
      style={{ ...vars, touchAction: timeSource ? undefined : 'pan-x' }}
      {...browse.handlers}
      data-browsing={browse.line !== null || undefined}
      data-lyrics-style={style}
      data-line={clock.line}
      data-word={clock.word}
      aria-live="off"
    >
      {wrapLens ? <LensBlock>{body}</LensBlock> : body}
      <AnimatePresence>
        {browse.line !== null && (
          <BrowseBar
            key="browse"
            at={browse.line}
            count={lines.length}
            onPlay={() => {
              seek(Math.max(0, lines[browse.line!].t - offset + 0.01));
              browse.resume();
            }}
            onLive={browse.resume}
          />
        )}
      </AnimatePresence>
      {/* screen-reader friendly current line */}
      <span className="sr-only">{lines[clock.line]?.text}</span>
    </div>
  );
}

/** shown while the listener browses the lyrics by hand */
function BrowseBar({ at, count, onPlay, onLive }: { at: number; count: number; onPlay: () => void; onLive: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.28, ease: EASE }}
      className="glass-strong pointer-events-auto absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 pl-4 text-[13px] text-ink-2"
      onWheel={(e) => e.stopPropagation()}
    >
      <span className="tabular mr-2 whitespace-nowrap">Line {at + 1} of {count}</span>
      <button type="button" onClick={onPlay} className="press whitespace-nowrap rounded-full bg-white/90 px-3.5 py-1.5 font-medium text-black">
        Play from here
      </button>
      <button type="button" onClick={onLive} className="press whitespace-nowrap rounded-full px-3.5 py-1.5 font-medium text-ink hover:bg-white/10">
        Back to live
      </button>
    </motion.div>
  );
}

/**
 * Lyrics without timing. With the fisheye on (the default) they sit in the reel's type and roll
 * through the lens as you scroll — never on a timer, because there is no timing to follow.
 */
export function PlainLyrics({ text, size }: { text: string[]; size: number }) {
  const fisheye = useSettings((s) => s.lyricsFisheye);
  const ref = useRef<HTMLDivElement>(null);
  const lens = useLens(ref, fisheye);
  return (
    <div className="flex h-full w-full items-center justify-center">
      {lens.defs}
      <div
        ref={ref}
        data-testid="plain-lyrics"
        className={cx(
          'scroll-quiet w-full overflow-y-auto text-center [mask-image:linear-gradient(transparent,black_18%,black_82%,transparent)]',
          fisheye ? 'h-[80%] max-w-[min(94vw,1100px)] px-[3vw] pt-[6vh] pb-[30vh]' : 'h-full px-[var(--ly-pad)] py-[10vh]',
        )}
        style={{
          ...LYRIC_FONT,
          ...(fisheye ? REEL_FONT : null),
          ...lens.style,
          fontSize: fisheye ? `calc(clamp(24px, 3.1vw, 52px) * ${size})` : `calc(clamp(18px, 1.8vw, 30px) * ${size})`,
        }}
      >
        {text.map((l, i) => (
          <p key={i} className={cx('font-bold', fisheye ? 'leading-[1.18] text-ink/90' : 'leading-relaxed text-ink/80', !l && 'h-[1em]')}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

export type { Clock as LyricClock };
export type ClockRef = MutableRefObject<number>;
