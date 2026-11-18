import { Suspense, lazy, useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { useCurrentTrack } from '../../hooks/useAudioPlayer';
import { lightingEngine } from '../../engine/lightingEngine';
import { QUALITY } from '../../engine/quality';
import { qualityStore } from '../../state/quality';
import { useStore } from '../../store';

/**
 * The hero's world, shown while nothing is playing (the mockup): a great glass dome rising from a
 * reflective floor, light glinting on its shoulders and travelling along its rim, and two twisting
 * ribbons of glass in the corners. Drawn in SVG (no images), in a fixed violet palette.
 * Layers shift with the pointer for depth; the floor glow breathes with the bass when music plays.
 * Fades away once a song is loaded. "Reduce motion": a still composition.
 */
export function HeroBackdrop() {
  const track = useCurrentTrack();
  return <AnimatePresence>{!track && <World key="hero-world" />}</AnimatePresence>;
}

// the palette from the mockup
const VIOLET = '#9d8cff';
const LILAC = '#d9d1ff';
const PEACH = '#ffbf94';
const ICE = '#9fe2ff';

type P = [number, number];
const bez = (a: P, b: P, c: P, d: P, t: number): P => {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
};

/**
 * A twisting ribbon along a cubic curve: its width follows |cos| of a phase that advances along the
 * curve, so it pinches to nothing where it turns over; faces alternate front (bright) / back (dim).
 * Returns the face polygons and the two edge lines.
 */
function ribbonGeometry(a: P, b: P, c: P, d: P, width: number, turns: number, phase: number) {
  const N = 90;
  const pts: P[] = [];
  for (let i = 0; i <= N; i++) pts.push(bez(a, b, c, d, i / N));
  const left: P[] = [];
  const right: P[] = [];
  const front: boolean[] = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i];
    const q = pts[Math.min(N, i + 1)];
    const o = pts[Math.max(0, i - 1)];
    const tx = q[0] - o[0];
    const ty = q[1] - o[1];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    const ang = phase + (i / N) * turns * Math.PI;
    // taper at both ends, full width in the middle
    const taper = Math.sin((i / N) * Math.PI) ** 0.6;
    const w = (width / 2) * Math.cos(ang) * taper;
    left.push([p[0] + nx * w, p[1] + ny * w]);
    right.push([p[0] - nx * w, p[1] - ny * w]);
    front.push(Math.cos(ang) >= 0);
  }
  // split into faces where the ribbon turns over
  const faces: { d: string; front: boolean }[] = [];
  let start = 0;
  for (let i = 1; i <= N; i++) {
    if (front[i] !== front[start] || i === N) {
      const L = left.slice(start, i + 1);
      const R = right.slice(start, i + 1).reverse();
      faces.push({ d: 'M ' + [...L, ...R].map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L ') + ' Z', front: front[start] });
      start = i;
    }
  }
  const line = (ps: P[]) => 'M ' + ps.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L ');
  return { faces, edgeA: line(left), edgeB: line(right), spine: line(pts) };
}

function Ribbon({ id, geo }: { id: string; geo: ReturnType<typeof ribbonGeometry> }) {
  return (
    <g>
      {/* glow the ribbon throws into the room */}
      <path d={geo.spine} stroke={VIOLET} strokeWidth={70} fill="none" opacity={0.18} filter="url(#hero-soft)" strokeLinecap="round" />
      {geo.faces.map((f, i) => (
        <path key={i} d={f.d} fill={`url(#${id}-${f.front ? 'front' : 'back'})`} opacity={f.front ? 0.9 : 0.55} />
      ))}
      {/* a soft white sheen down the middle: the gloss of the glass */}
      <path d={geo.spine} stroke="#ffffff" strokeWidth={22} fill="none" opacity={0.22} filter="url(#hero-soft)" strokeLinecap="round" />
      {/* the edges catch the light */}
      <g filter="url(#hero-glow)">
        <path d={geo.edgeA} stroke={`url(#${id}-edge)`} strokeWidth={3} fill="none" strokeLinecap="round" />
        <path d={geo.edgeB} stroke={`url(#${id}-edge)`} strokeWidth={2} fill="none" strokeLinecap="round" opacity={0.75} />
      </g>
    </g>
  );
}


const HeroScene3D = lazy(() => import('./HeroScene3D'));

function World() {
  const reduce = useReduceMotion();
  // WebGL availability comes from the one probe made at start-up (state/quality.ts)
  const canGl = useStore(qualityStore, (s) => s.probed && s.webgl);
  // Performance quality draws the SVG dome instead of the WebGL one (a GPU-free composition)
  const hero3d = QUALITY[useStore(qualityStore, (s) => s.level)].hero3d;
  const webgl = canGl && !!hero3d;
  const root = useRef<HTMLDivElement>(null);
  const floor = useRef<SVGEllipseElement>(null);
  const r1 = useMemo(() => ribbonGeometry([-140, 470], [120, 430], [170, 120], [520, -110], 175, 2.2, 0.35), []);
  const r2 = useMemo(() => ribbonGeometry([1740, 430], [1520, 470], [1600, 820], [1170, 990], 190, 2.4, 2.1), []);

  // depth: layers drift with the pointer (CSS variables, no re-render)
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.current?.style.setProperty('--mx', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(3));
        root.current?.style.setProperty('--my', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(3));
      });
    };
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
    };
  }, [reduce]);

  // the floor glow breathes with the bass of whatever is playing
  useEffect(
    () =>
      lightingEngine.onFrame((f) => {
        if (!floor.current) return;
        floor.current.style.opacity = String(0.7 + 0.3 * f.features.bass * f.live);
      }),
    [],
  );

  const dome = 'M 80 905 A 720 670 0 0 1 1520 905';
  const domeInner = 'M 118 905 A 682 632 0 0 1 1482 905';

  return (
    <motion.div
      ref={root}
      aria-hidden
      className="hero-world pointer-events-none fixed inset-0 z-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.8 } }}
      transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="hero-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id="hero-glint" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <filter id="hero-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* dome glass: nearly clear in the middle, brightening toward the rim */}
          <radialGradient id="dome-fill" cx="50%" cy="100%" r="100%">
            <stop offset="0.5" stopColor={VIOLET} stopOpacity="0.02" />
            <stop offset="0.84" stopColor={VIOLET} stopOpacity="0.09" />
            <stop offset="0.97" stopColor={LILAC} stopOpacity="0.2" />
            <stop offset="1" stopColor={LILAC} stopOpacity="0.28" />
          </radialGradient>
          {/* the rim: violet with white and peach where the light catches the shoulders, a cool glint */}
          <linearGradient id="dome-rim" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={VIOLET} stopOpacity="0.5" />
            <stop offset="0.1" stopColor={PEACH} stopOpacity="0.95" />
            <stop offset="0.17" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="0.32" stopColor={VIOLET} stopOpacity="0.55" />
            <stop offset="0.5" stopColor={LILAC} stopOpacity="0.4" />
            <stop offset="0.7" stopColor={VIOLET} stopOpacity="0.6" />
            <stop offset="0.84" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.9" stopColor={PEACH} stopOpacity="0.95" />
            <stop offset="0.96" stopColor={ICE} stopOpacity="0.6" />
            <stop offset="1" stopColor={VIOLET} stopOpacity="0.5" />
          </linearGradient>
          {['r1', 'r2'].map((id) => (
            <g key={id}>
              <linearGradient id={`${id}-front`} x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.85" />
                <stop offset="0.3" stopColor={LILAC} stopOpacity="0.62" />
                <stop offset="0.55" stopColor={VIOLET} stopOpacity="0.5" />
                <stop offset="0.78" stopColor={PEACH} stopOpacity="0.5" />
                <stop offset="1" stopColor={ICE} stopOpacity="0.55" />
              </linearGradient>
              <linearGradient id={`${id}-back`} x1="0" x2="1" y1="1" y2="0">
                <stop offset="0" stopColor="#5b4bb8" stopOpacity="0.35" />
                <stop offset="1" stopColor={VIOLET} stopOpacity="0.2" />
              </linearGradient>
              <linearGradient id={`${id}-edge`} x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="0.25" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="0.5" stopColor={PEACH} stopOpacity="0.85" />
                <stop offset="0.75" stopColor={ICE} stopOpacity="0.8" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>
            </g>
          ))}
          <radialGradient id="floor-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={LILAC} stopOpacity="0.55" />
            <stop offset="0.4" stopColor={VIOLET} stopOpacity="0.22" />
            <stop offset="1" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="glint" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="0.3" stopColor={PEACH} stopOpacity="0.55" />
            <stop offset="1" stopColor={VIOLET} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* far layer: the dome (drawn here only without WebGL; otherwise it's real 3D glass) */}
        {!webgl && (
        <g className="hero-layer" style={{ ['--depth' as string]: 10 }}>
          <path d={`${dome} Z`} fill="url(#dome-fill)" />
          <path d={dome} fill="none" stroke="url(#dome-rim)" strokeWidth="16" filter="url(#hero-soft)" opacity="0.8" />
          <path d={dome} fill="none" stroke="url(#dome-rim)" strokeWidth="2.6" />
          {/* the glass is thick: a second, inner edge */}
          <path d={domeInner} fill="none" stroke="url(#dome-rim)" strokeWidth="1.2" opacity="0.4" />
          {/* light glinting on the shoulders */}
          <ellipse cx="1385" cy="470" rx="70" ry="120" fill="url(#glint)" filter="url(#hero-glint)" opacity="0.9" transform="rotate(-32 1385 470)" />
          <ellipse cx="215" cy="610" rx="55" ry="110" fill="url(#glint)" filter="url(#hero-glint)" opacity="0.75" transform="rotate(30 215 610)" />
          <ellipse cx="800" cy="238" rx="190" ry="26" fill={LILAC} filter="url(#hero-glint)" opacity="0.18" />
          {/* a comet of light travelling along the rim */}
          <path className="hero-comet" d={dome} fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" filter="url(#hero-glow)" pathLength={100} />
        </g>
        )}

        {/* floor: a reflective plane, and the dome's rim mirrored faintly in it */}
        <ellipse ref={floor} cx="800" cy="905" rx="820" ry="90" fill="url(#floor-glow)" opacity="0.7" />
        <rect x="0" y="899" width="1600" height="1.4" fill={LILAC} opacity="0.3" />
        <path d="M 80 905 A 720 120 0 0 0 1520 905" fill="none" stroke="url(#dome-rim)" strokeWidth="1.4" opacity="0.18" filter="url(#hero-glow)" />

        {/* near layers: twisting ribbons of glass (SVG only without WebGL) */}
        {!webgl && (
          <>
            <g className="hero-layer hero-float-a" style={{ ['--depth' as string]: 26 }}>
              <Ribbon id="r1" geo={r1} />
            </g>
            <g className="hero-layer hero-float-b" style={{ ['--depth' as string]: 34 }}>
              <Ribbon id="r2" geo={r2} />
            </g>
          </>
        )}
      </svg>
      {/* the dome and ribbons as real 3D glass */}
      {webgl && (
        <Suspense fallback={null}>
          <HeroScene3D ambient={!reduce} dpr={hero3d || [1, 1]} />
        </Suspense>
      )}
      {/* vignette: the text and the edge light stay the brightest things */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(75% 65% at 50% 40%, transparent 45%, rgb(0 0 0 / 0.45) 100%)' }} />
    </motion.div>
  );
}
