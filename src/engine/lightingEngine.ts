import { audioEngine } from './audioEngine';
import { VisualizerRenderer, type Anchor } from './visualizers';
import { settingsStore } from '../state/settings';
import { playerStore } from '../state/player';
import { AudioAnalyzer, SPECTRUM_BANDS, type AudioFeatures } from '../utils/audioAnalysis';
import { clamp, hexToRgb, hslToRgb, lerpHue, mixRgb, smoothstep, type RGB } from '../utils/colorUtils';
import type { Edges, LightingMode, LightingSettings } from '../types/lighting';

/**
 * AMBIENT LIGHTING ENGINE
 * ------------------------------------------------------------------------------
 * The viewport perimeter is sampled into a few hundred points. Every frame each
 * point gets a colour + intensity from the active mode "shader" (pure functions of
 * position, time and audio features). The result is drawn twice:
 *
 *   core   – full-resolution, thin, near-white-hot line hugging the edge
 *   bloom  – a quarter-resolution buffer of wide strokes, blurred at two radii
 *            (tight + wide) and composited with `screen` — the soft light that
 *            spills inward, like the strips in the reference footage.
 *
 * Everything runs outside React. Components only hand over canvases/anchors and
 * subscribe to per-frame data when they need it (progress bar, artwork pulse).
 */

type EdgeId = keyof Edges;

interface PPoint {
  x: number;
  y: number;
  /** clockwise arc-length position 0..1 starting at the top-left corner */
  u: number;
  edge: EdgeId;
  /** 0 at bottom-centre … 1 at top-centre (symmetric), used for frequency mapping */
  d: number;
  /** 0 top … 1 bottom */
  vy: number;
  /** distance to the nearest corner along the edge, 0..0.5 of that edge */
  corner: number;
}

/** A run of perimeter samples drawn as ONE stroke (no joints → no seams). */
type Segment =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; i0: number; i1: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; sweep: number; i0: number; i1: number };

/** Notch shape shared by the renderer and the black notch body drawn in the DOM. */
export function notchGeometry(W: number) {
  const w = Math.max(150, Math.min(220, W * 0.11));
  return { x0: W / 2 - w / 2, x1: W / 2 + w / 2, w, d: 28, r: 8 };
}

export interface FrameInfo {
  t: number;
  dt: number;
  features: AudioFeatures;
  /** current (smoothed) lighting colours */
  P: RGB;
  S: RGB;
  /** 0..1 average lit intensity this frame */
  level: number;
  /** 0..1 how live the analysis is */
  live: number;
}

type FrameListener = (f: FrameInfo) => void;

const MODE_FADE = 0.9; // seconds

const frac = (x: number) => x - Math.floor(x);
const circDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
};
const pool = (u: number, c: number, w: number) => {
  const d = circDist(u, c) / w;
  return Math.exp(-d * d);
};

/** per-frame values shared by all points */
interface Globals {
  T: number; // animation clock
  C: number; // colour clock
  dt: number;
  f: AudioFeatures;
  live: number;
  idle: number; // 0..1 breathing when nothing is playing
  P: RGB;
  S: RGB;
  comet1: number;
  comet2: number;
  heart: number;
  hue: number;
  H: number;
}

const WHITE: RGB = [1, 1, 1];
const LATE_P: RGB = [1, 0.52, 0.2];
const LATE_S: RGB = [0.85, 0.22, 0.08];
const LAVENDER: RGB = [0.82, 0.72, 1];

/** Mode "shaders": write colour into `out`, return intensity (≈0..1.4). */
const SHADERS: Record<LightingMode, (p: PPoint, g: Globals, out: RGB) => number> = {
  amber(p, g, out) {
    const pools =
      0.55 * pool(p.u, frac(g.T * 0.021), 0.12) +
      0.45 * pool(p.u, frac(0.5 - g.T * 0.015), 0.16) +
      0.35 * pool(p.u, frac(0.27 + g.T * 0.009), 0.09);
    mixRgb(g.P, g.S, 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u * 1.5 + g.C * 0.03)), out);
    const audio = g.live * (0.2 * g.f.energy + 0.25 * g.f.bass + 0.45 * g.f.kick);
    const base = (0.3 + 0.5 * pools) * (0.8 + 0.2 * g.idle);
    return (base + audio * (0.55 + pools)) * (p.edge === 'bottom' ? 1.15 : 1);
  },

  neonPink(p, g, out) {
    const head = frac(g.T * 0.085);
    const band = pool(p.u, head, 0.075) + pool(p.u, frac(head + 0.5), 0.075);
    mixRgb(g.P, g.S, 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u * 2 - g.C * 0.06)), out);
    mixRgb(out, WHITE, band * 0.22, out);
    return 0.38 + 0.4 * band * (1 + g.f.mid) + g.live * (0.35 * g.f.mid + 0.22 * g.f.high + 0.25 * g.f.kick);
  },

  purpleDream(p, g, out) {
    const t1 = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u * 2 + g.T * 0.05));
    const t2 = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u * 3 - g.T * 0.035) + 1.3);
    const breath = 0.5 + 0.5 * Math.sin(g.T * 0.7);
    mixRgb(g.P, g.S, t2, out);
    mixRgb(out, LAVENDER, clamp(g.f.high * 0.5 * t1 * g.live), out);
    return 0.22 + 0.32 * t1 * t2 + 0.16 * breath + g.live * (0.45 * g.f.mid + 0.2 * g.f.lowMid + 0.2 * g.f.energySlow);
  },

  cyberBlue(p, g, out) {
    const tail = (head: number, dir: 1 | -1, len: number) => {
      const d = dir > 0 ? frac(head - p.u) : frac(p.u - head);
      return d < len ? Math.pow(1 - d / len, 2.2) : 0;
    };
    const c = tail(g.comet1, 1, 0.14) + 0.8 * tail(g.comet2, -1, 0.1);
    mixRgb(g.S, g.P, clamp(c * 1.2), out);
    mixRgb(out, WHITE, clamp(c - 0.75) * 0.8, out);
    return 0.13 + 0.95 * c + g.live * (0.22 * g.f.high + 0.18 * g.f.bass) + 0.12 * g.f.beat;
  },

  bloodRed(p, g, out) {
    const wy = 0.55 + 0.45 * p.vy;
    mixRgb(g.S, g.P, clamp(0.25 + g.heart * 0.9 + g.f.bass * 0.4), out);
    return (0.16 + 0.75 * g.heart * wy + g.live * (0.35 * g.f.bass + 0.12 * g.f.energy)) * (0.7 + 0.3 * wy);
  },

  rainbow(p, g, out) {
    hslToRgb(frac(p.u + g.C * 0.04), 0.95, 0.55, out);
    return 0.48 + 0.14 * Math.sin(Math.PI * 2 * (p.u * 4 - g.T * 0.1)) + g.live * (0.45 * g.f.energy + 0.15 * g.f.beat);
  },

  reactive(p, g, out) {
    const hue = frac(g.hue + (p.d - 0.5) * 0.16 + 0.025 * Math.sin(g.C * 0.4 + p.u * 6));
    hslToRgb(hue, 0.92, 0.55, out);
    // floor → bass, walls → mids, ceiling → highs (smoothly)
    const f = g.f;
    const d = p.d * 3;
    const band = d < 1 ? f.bass + (f.lowMid - f.bass) * d : d < 2 ? f.lowMid + (f.mid - f.lowMid) * (d - 1) : f.mid + (f.high - f.mid) * (d - 2);
    const idle = (1 - g.live) * (0.3 + 0.15 * Math.sin(g.T * 0.8 + p.u * 8));
    return idle + g.live * (0.16 + 0.95 * band + 0.22 * f.beat);
  },

  cinematic(p, g, out) {
    const pools = 0.6 * pool(p.u, frac(g.T * 0.006), 0.2) + 0.5 * pool(p.u, frac(0.55 - g.T * 0.0045), 0.22);
    mixRgb(g.P, g.S, 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u + g.C * 0.01)), out);
    return Math.min(0.62, 0.22 + 0.24 * pools + 0.2 * g.live * g.f.energySlow + 0.05 * g.idle);
  },

  bassPulse(p, g, out) {
    const wy = 0.3 + 0.7 * p.vy;
    const hit = clamp(g.f.kick * 1.15 + Math.pow(g.f.bass, 2) * 0.3) * g.live;
    const idle = (1 - g.live) * (0.18 + 0.14 * Math.pow(0.5 + 0.5 * Math.sin(g.T * 2.2), 3));
    mixRgb(g.P, g.S, (1 - wy) * 0.8, out);
    return 0.07 + (hit * 1.15 + idle) * wy;
  },

  spectrum(p, g, out) {
    const pos = Math.pow(p.d, 0.9) * (SPECTRUM_BANDS * 0.84 - 1);
    const i = Math.floor(pos);
    const fr = pos - i;
    const v = g.f.spectrum[i] * (1 - fr) + g.f.spectrum[Math.min(SPECTRUM_BANDS - 1, i + 1)] * fr;
    mixRgb(g.P, g.S, p.d, out);
    const idle = (1 - g.live) * (0.16 + 0.1 * Math.sin(Math.PI * 2 * (p.d * 3 - g.T * 0.2)));
    return 0.06 + v * 1.15 + idle;
  },
};

class LightingEngine {
  readonly analyzer = new AudioAnalyzer();

  private core: HTMLCanvasElement | null = null;
  private coreCtx: CanvasRenderingContext2D | null = null;
  private bloom: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;
  private scratch = document.createElement('canvas');
  private scratchCtx = this.scratch.getContext('2d')!;
  private viz: HTMLCanvasElement | null = null;
  private vizCtx: CanvasRenderingContext2D | null = null;
  private vizRenderer = new VisualizerRenderer();
  private anchors = new Map<'art' | 'eq', HTMLElement>();
  private listeners = new Set<FrameListener>();

  private W = 0;
  private H = 0;
  private dpr = 1;
  private readonly bloomScale = 0.25;
  private canFilter = 'filter' in CanvasRenderingContext2D.prototype;
  private points: PPoint[] = [];
  private segments: Segment[] = [];
  private notch: ReturnType<typeof notchGeometry> | null = null;
  private colA = new Float32Array(0);
  private intensity = new Float32Array(0);
  /** time-smoothed intensity / colour per perimeter point (before the along-the-strip blur) */
  private inS = new Float32Array(0);
  private colS = new Float32Array(0);
  /** smoothed kick, for the width / glow-size pulse */
  private kickS = 0;

  private raf = 0;
  private last = 0;
  private T = 0;
  private C = 0;
  private live = 0;
  private P: RGB = [1, 0.5, 0.1];
  private S: RGB = [1, 0.3, 0.1];
  private hue = 0.05;
  private comet1 = 0;
  private comet2 = 0.5;
  private heartPhase = 0;
  private lastBeatCount = 0;
  private beatHeart = 0;
  private edgeFade: Record<EdgeId, number> = { top: 1, right: 1, bottom: 1, left: 1 };
  private mode: LightingMode = settingsStore.getState().mode;
  private prevMode: LightingMode | null = null;
  private fade = 1;
  private reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private frame: FrameInfo;

  constructor() {
    this.frame = { t: 0, dt: 0, features: this.analyzer.features, P: this.P, S: this.S, level: 0, live: 0 };
    const s = settingsStore.getState();
    this.P = hexToRgb(s.primary);
    this.S = hexToRgb(s.secondary);
    let lastNotch = s.notch;
    settingsStore.subscribe(() => {
      const st = settingsStore.getState();
      if (st.notch !== lastNotch) {
        lastNotch = st.notch;
        this.buildPerimeter();
      }
      const m = st.mode;
      if (m !== this.mode) {
        this.prevMode = this.mode;
        this.mode = m;
        this.fade = 0;
      }
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', this.onVisibility);
    window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => (this.reducedMotion = e.matches));
  }

  // ---- wiring ---------------------------------------------------------------
  attachLighting(core: HTMLCanvasElement, bloom: HTMLCanvasElement) {
    this.core = core;
    this.bloom = bloom;
    this.coreCtx = core.getContext('2d');
    this.bloomCtx = bloom.getContext('2d');
    this.resize();
    this.start();
    return () => {
      if (this.core === core) {
        this.core = this.bloom = null;
        this.coreCtx = this.bloomCtx = null;
      }
    };
  }

  attachVisualizer(canvas: HTMLCanvasElement) {
    this.viz = canvas;
    this.vizCtx = canvas.getContext('2d');
    this.resize();
    return () => {
      if (this.viz === canvas) {
        this.viz = null;
        this.vizCtx = null;
      }
    };
  }

  setAnchor(name: 'art' | 'eq', el: HTMLElement) {
    this.anchors.set(name, el);
  }

  clearAnchor(name: 'art' | 'eq', el: HTMLElement) {
    if (this.anchors.get(name) === el) this.anchors.delete(name);
  }

  onFrame(fn: FrameListener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get current() {
    return this.frame;
  }

  /**
   * Frame-rate cap (0 = display rate). Set to 30 while a lyric transcription runs: on a 2-core
   * CPU the 60 fps renderer and the speech model compete for the same cores (measured: a 30 s clip
   * took 4.7 s with nothing else running, 11.8–17.5 s with the app rendering alongside).
   */
  maxFps = 0;
  private lastDrawn = 0;

  // ---- visual quality (src/engine/quality.ts) ---------------------------------
  /** frame caps from the quality level: while music plays / while idle (0 = display rate) */
  private qFpsPlaying = 0;
  private qFpsIdle = 0;
  private qMaxDpr = 2;
  setQuality(q: { fpsPlaying: number; fpsIdle: number; maxDpr: number }) {
    this.qFpsPlaying = q.fpsPlaying;
    this.qFpsIdle = q.fpsIdle;
    if (q.maxDpr !== this.qMaxDpr) {
      this.qMaxDpr = q.maxDpr;
      this.resize();
    }
  }
  /** the frame cap in force right now (0 = none): the strictest of the quality and transcription caps */
  get frameCap() {
    const q = audioEngine.paused ? this.qFpsIdle : this.qFpsPlaying;
    const caps = [this.maxFps, q].filter((c) => c > 0);
    return caps.length ? Math.min(...caps) : 0;
  }

  /** wanted = attached to the page; the loop itself also stops while the page is hidden */
  private wanted = false;

  private start() {
    this.wanted = true;
    if (this.raf || (typeof document !== 'undefined' && document.hidden)) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      // skip frames under a cap (tick() uses real elapsed time, so motion speed is unchanged)
      const cap = this.frameCap;
      if (cap && now - this.lastDrawn < 1000 / cap - 2) return;
      this.lastDrawn = now;
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** hidden window / tab: draw nothing (music keeps playing); visible again: carry on */
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (this.wanted) this.start();
  };

  stop() {
    this.wanted = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ---- geometry ---------------------------------------------------------------
  private resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.W = W;
    this.H = H;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.qMaxDpr);
    if (this.core) {
      this.core.width = Math.round(W * this.dpr);
      this.core.height = Math.round(H * this.dpr);
    }
    if (this.bloom) {
      this.bloom.width = Math.max(1, Math.round(W * this.bloomScale));
      this.bloom.height = Math.max(1, Math.round(H * this.bloomScale));
      this.scratch.width = this.bloom.width;
      this.scratch.height = this.bloom.height;
    }
    if (this.viz) {
      const vd = Math.min(this.dpr, 1.5);
      this.viz.width = Math.round(W * vd);
      this.viz.height = Math.round(H * vd);
    }
    this.buildPerimeter();
  }

  private buildPerimeter() {
    const { W, H } = this;
    if (!W || !H) return;
    const R = Math.min(14, W * 0.02);
    const pts: { x: number; y: number; edge: EdgeId }[] = [];
    const segs: Segment[] = [];
    const step = 8; // css px between samples
    const line = (x0: number, y0: number, x1: number, y1: number, edge: EdgeId) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(2, Math.round(len / step));
      const i0 = pts.length;
      for (let i = 0; i < n; i++) pts.push({ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n, edge });
      segs.push({ kind: 'line', x0, y0, x1, y1, i0, i1: pts.length - 1 });
    };
    const arc = (cx: number, cy: number, a0: number, from: EdgeId, to: EdgeId, r = R, sweep = Math.PI / 2) => {
      const n = 6;
      const i0 = pts.length;
      for (let i = 0; i < n; i++) {
        const a = a0 + (sweep * i) / n;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, edge: i < n / 2 ? from : to });
      }
      segs.push({ kind: 'arc', cx, cy, r, a0, sweep, i0, i1: pts.length - 1 });
    };
    // The core stroke is centred on the viewport edge (half is off-screen, see drawLighting).
    const notch = settingsStore.getState().notch ? notchGeometry(W) : null;
    this.notch = notch;
    if (notch) {
      // trace the MacBook notch: down, along, and back up — with rounded bends
      const { x0, x1, d, r } = notch;
      const P = Math.PI;
      line(R, 0, x0 - r, 0, 'top');
      arc(x0 - r, r, -P / 2, 'top', 'top', r, P / 2); //            bend down
      line(x0, r, x0, d - r, 'top');
      arc(x0 + r, d - r, P, 'top', 'top', r, -P / 2); //            bend right
      line(x0 + r, d, x1 - r, d, 'top');
      arc(x1 - r, d - r, P / 2, 'top', 'top', r, -P / 2); //        bend up
      line(x1, d - r, x1, r, 'top');
      arc(x1 + r, r, P, 'top', 'top', r, P / 2); //                 bend right
      line(x1 + r, 0, W - R, 0, 'top');
    } else line(R, 0, W - R, 0, 'top');
    arc(W - R, R, -Math.PI / 2, 'top', 'right');
    line(W, R, W, H - R, 'right');
    arc(W - R, H - R, 0, 'right', 'bottom');
    line(W - R, H, R, H, 'bottom');
    arc(R, H - R, Math.PI / 2, 'bottom', 'left');
    line(0, H - R, 0, R, 'left');
    arc(R, R, Math.PI, 'left', 'top');

    // arc length parameter
    let total = 0;
    const acc = pts.map((p, i) => {
      if (i > 0) total += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      return total;
    });
    total += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    // bottom-centre in u (found geometrically, so it stays right with the notch)
    let bi = 0, bd = Infinity;
    pts.forEach((p, i) => {
      const dd = Math.abs(p.x - W / 2) + Math.abs(p.y - H);
      if (dd < bd) { bd = dd; bi = i; }
    });
    const uBottomCenter = acc[bi] / total;
    this.points = pts.map((p, i) => {
      const u = acc[i] / total;
      const along = p.edge === 'top' || p.edge === 'bottom' ? p.x / W : p.y / H;
      return {
        x: p.x, y: p.y, u, edge: p.edge,
        d: circDist(u, uBottomCenter) * 2,
        vy: p.y / H,
        corner: Math.min(along, 1 - along),
      };
    });
    this.segments = segs;
    const n = this.points.length;
    this.colA = new Float32Array(n * 3);
    this.intensity = new Float32Array(n);
    this.inS = new Float32Array(n);
    this.colS = new Float32Array(n * 3);
  }

  // ---- per frame -------------------------------------------------------------------
  private tick(now: number) {
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    const s = settingsStore.getState();
    const player = playerStore.getState();

    // audio
    const hasAudio = audioEngine.sample();
    const ctx = audioEngine.ctx;
    const f = this.analyzer.update(
      hasAudio ? audioEngine.freq : null,
      hasAudio ? audioEngine.time : null,
      ctx?.sampleRate ?? 48000,
      audioEngine.analyser?.fftSize ?? 2048,
      dt, now / 1000,
      { sensitivity: s.sensitivity, bassSensitivity: s.bassSensitivity, smoothing: s.smoothing },
    );
    // Reactivity (reference: "Animation: Music Sync … No Animation"):
    //   music → follow the audio · ambient → animate but ignore audio · static → hold still
    const liveTarget = s.reactivity === 'music' && f.live ? 1 : 0;
    this.live += (liveTarget - this.live) * (1 - Math.exp(-dt / 0.4));

    // clocks
    const still = s.reactivity === 'static';
    const motion = still ? 0 : s.animationSpeed * (this.reducedMotion ? 0.35 : 1);
    this.T += dt * motion * (1 + this.live * f.energy * 0.35);
    if (!still) this.C += dt * s.colorSpeed;

    // colours glide toward their targets (artwork palette when requested — the reference default)
    const useArt = (s.matchArtwork || s.mode === 'cinematic') && player.palette;
    const tP = hexToRgb(useArt ? player.palette![0] : s.primary);
    const tS = hexToRgb(useArt ? player.palette![1] : s.secondary);
    if (s.lateNight) {
      // late-night: pull everything toward a warm, low ember
      mixRgb(tP, LATE_P, 0.55, tP);
      mixRgb(tS, LATE_S, 0.55, tS);
    }
    const ck = 1 - Math.exp(-dt * (0.8 + s.colorSpeed * 2.2));
    mixRgb(this.P, tP, ck, this.P);
    mixRgb(this.S, tS, ck, this.S);

    // reactive-mode hue follows the spectral centroid: dark = ember, bright = ice
    const targetHue = lerpHue(0.99, 0.58, smoothstep(0.1, 0.9, f.centroid));
    this.hue = lerpHue(this.hue, this.live > 0.1 ? targetHue : frac(this.C * 0.02), 1 - Math.exp(-dt * (0.6 + s.colorSpeed)));

    // comets (cyber blue)
    const cometSpeed = (0.06 + 0.28 * f.high * this.live + 0.08 * f.energy) * motion;
    this.comet1 = frac(this.comet1 + dt * cometSpeed);
    this.comet2 = frac(this.comet2 - dt * cometSpeed * 0.78);

    // heartbeat (blood red): real beats when live, a calm 56 bpm lub-dub otherwise
    if (f.beatCount !== this.lastBeatCount) {
      this.lastBeatCount = f.beatCount;
      this.beatHeart = 1;
    }
    this.beatHeart = Math.max(this.beatHeart * Math.exp(-dt * 7), f.kick);
    this.heartPhase = frac(this.heartPhase + dt * (56 / 60) * motion);
    const ph = this.heartPhase;
    const synthetic = Math.exp(-ph * 16) + 0.65 * (ph > 0.2 ? Math.exp(-(ph - 0.2) * 16) : 0);
    const heart = this.live * this.beatHeart + (1 - this.live) * synthetic * 0.7;

    // edge toggles fade rather than snap
    (Object.keys(this.edgeFade) as EdgeId[]).forEach((e) => {
      this.edgeFade[e] += ((s.edges[e] ? 1 : 0) - this.edgeFade[e]) * (1 - Math.exp(-dt * 6));
    });

    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / MODE_FADE);

    const g: Globals = {
      T: this.T, C: this.C, dt, f, live: this.live,
      idle: (1 - this.live) * (0.5 + 0.5 * Math.sin(this.T * 0.9)),
      P: this.P, S: this.S, comet1: this.comet1, comet2: this.comet2, heart, hue: this.hue, H: this.H,
    };

    this.kickS += (f.kick - this.kickS) * (1 - Math.exp(-dt / (f.kick > this.kickS ? 0.05 : 0.22)));
    const level = this.shade(s, g);
    this.drawLighting(s);
    this.drawVisualizer(s, f, dt);

    const fr = this.frame;
    fr.t = now / 1000;
    fr.dt = dt;
    fr.P = this.P;
    fr.S = this.S;
    fr.level = level;
    fr.live = this.live;
    this.listeners.forEach((l) => l(fr));
  }

  /** run the mode shader(s) for every perimeter point; returns mean intensity */
  private shade(s: LightingSettings, g: Globals) {
    const pts = this.points;
    const cur = SHADERS[this.mode];
    const prev = this.prevMode && this.fade < 1 ? SHADERS[this.prevMode] : null;
    const k = smoothstep(0, 1, this.fade);
    const out: RGB = [0, 0, 0];
    const outB: RGB = [0, 0, 0];
    const bright = s.brightness * (s.lateNight ? 0.55 : 1);
    let sum = 0;
    // frame-rate independent smoothing factors (time constants in seconds)
    const up = 1 - Math.exp(-g.dt / 0.06);
    const down = 1 - Math.exp(-g.dt / 0.28);
    const col = 1 - Math.exp(-g.dt / 0.18);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let inten = cur(p, g, out);
      if (prev) {
        const ib = prev(p, g, outB);
        mixRgb(outB, out, k, out);
        inten = ib + (inten - ib) * k;
      }
      // layout: corners-only fades strips toward the middle of each edge
      let lay = 1;
      if (s.layout === 'corners') lay = 1 - smoothstep(0.06, 0.24, p.corner);
      // physical-strip unevenness: slow drifting hotspots + brighter bends (corners/notch),
      // as observed in the references — the light is never perfectly uniform
      const drift = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (p.u * 3 + g.T * 0.013)) * Math.sin(Math.PI * 2 * (p.u * 7 - g.T * 0.021) + 1.7);
      const bend = p.corner < 0.02 ? 1.12 : 1;
      const notchHot = this.notch && p.edge === 'top' && p.y > 1 ? 1.3 : 1;
      inten = Math.max(0, inten) * (0.86 + 0.14 * drift) * bend * notchHot * bright * this.edgeFade[p.edge] * lay;
      // time smoothing: rise quickly (still hits on the beat), fall slowly (no flicker)
      this.inS[i] += (inten - this.inS[i]) * (inten > this.inS[i] ? up : down);
      this.colS[i * 3] += (out[0] - this.colS[i * 3]) * col;
      this.colS[i * 3 + 1] += (out[1] - this.colS[i * 3 + 1]) * col;
      this.colS[i * 3 + 2] += (out[2] - this.colS[i * 3 + 2]) * col;
    }
    // along-the-strip smoothing (1-2-3-2-1 around the closed loop): no hard hotspots or seams
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = (i - 2 + n) % n, b = (i - 1 + n) % n, c = (i + 1) % n, d = (i + 2) % n;
      const v = (this.inS[a] + 2 * this.inS[b] + 3 * this.inS[i] + 2 * this.inS[c] + this.inS[d]) / 9;
      this.intensity[i] = v;
      for (let ch = 0; ch < 3; ch++) {
        this.colA[i * 3 + ch] = (this.colS[b * 3 + ch] + 2 * this.colS[i * 3 + ch] + this.colS[c * 3 + ch]) / 4;
      }
      sum += v;
    }
    return n ? clamp(sum / n) : 0;
  }

  private rgba(i: number, alpha: number, white: number) {
    const r = this.colA[i * 3], g = this.colA[i * 3 + 1], b = this.colA[i * 3 + 2];
    return `rgba(${((r + (1 - r) * white) * 255) | 0},${((g + (1 - g) * white) * 255) | 0},${((b + (1 - b) * white) * 255) | 0},${alpha.toFixed(3)})`;
  }

  /**
   * Stroke every straight edge as a single path with a multi-stop gradient sampled from
   * the perimeter, and each rounded corner as a short arc in its midpoint colour.
   */
  private strokeRuns(g: CanvasRenderingContext2D, scale: number, stride: number, color: (i: number) => string) {
    for (const seg of this.segments) {
      if (seg.kind === 'line') {
        const grad = g.createLinearGradient(seg.x0 * scale, seg.y0 * scale, seg.x1 * scale, seg.y1 * scale);
        const span = seg.i1 - seg.i0 || 1;
        for (let i = seg.i0; i <= seg.i1; i += stride) grad.addColorStop((i - seg.i0) / span, color(i));
        // close the run with the first sample of the next segment for continuity
        const nextI = (seg.i1 + 1) % this.points.length;
        grad.addColorStop(1, color(nextI));
        g.strokeStyle = grad;
        g.beginPath();
        g.moveTo(seg.x0 * scale, seg.y0 * scale);
        g.lineTo(seg.x1 * scale, seg.y1 * scale);
        g.stroke();
      } else {
        g.strokeStyle = color((seg.i0 + seg.i1) >> 1);
        g.beginPath();
        g.arc(seg.cx * scale, seg.cy * scale, seg.r * scale, seg.a0, seg.a0 + seg.sweep, seg.sweep < 0);
        g.stroke();
      }
    }
  }

  /**
   * Overall output gain for the edge light. 1 = the original level; raised so the strips read as
   * bright, over-driven LEDs (the shaders' intensity stays 0..~1.4, only what's drawn is lifted).
   */
  private static readonly BOOST = 1.7;

  private drawLighting(s: LightingSettings) {
    const B = LightingEngine.BOOST;
    const pts = this.points;
    const n = pts.length;
    if (!n) return;

    // ---------- core line (full resolution)
    const c = this.coreCtx;
    if (c && this.core) {
      const dpr = this.dpr;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.core.width, this.core.height);
      // The stroke is centred on the viewport edge, so half of it is off-screen:
      // drawing at 2× width leaves exactly `width` CSS px visible.
      const w = s.width * (1 + 0.4 * this.kickS * this.live);
      c.lineWidth = w * 2 * dpr;
      c.lineCap = 'butt';
      c.save();
      if (this.notch) {
        // clip away the notch body so the strip shows the same width around the notch as on the edges
        const n = this.notch;
        const clip = new Path2D();
        clip.rect(0, 0, this.core.width, this.core.height);
        clip.roundRect((n.x0) * dpr, -n.r * dpr, (n.x1 - n.x0) * dpr, (n.d + n.r) * dpr, n.r * dpr);
        c.clip(clip, 'evenodd');
      }
      // white-hot core from ~0.4 intensity, like an over-driven LED
      this.strokeRuns(c, dpr, 1, (i) => {
        const inten = this.intensity[i] * B;
        const hot = clamp((inten - 0.4) * 0.9) * 0.85;
        return this.rgba(i, clamp(inten * 1.1), hot);
      });
      // specular highlight: a thin, almost-white line on the very edge — the "shine" of a lit tube
      c.lineWidth = Math.max(1, w * 0.7) * dpr;
      this.strokeRuns(c, dpr, 1, (i) => this.rgba(i, clamp(this.intensity[i] * B * 0.75), 0.9));
      c.restore();
    }

    // ---------- bloom (quarter resolution, blurred)
    const bc = this.bloomCtx;
    const sc = this.scratchCtx;
    if (!bc || !this.bloom) return;
    const k = this.bloomScale;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, this.scratch.width, this.scratch.height);
    sc.lineCap = 'butt';
    const glow = s.glow;
    sc.lineWidth = (s.width * 3 + s.blur * 0.5) * k;
    this.strokeRuns(sc, k, 1, (i) => this.rgba(i, clamp(this.intensity[i] * glow * 1.15 * B), 0.08));
    // four-corner illumination
    if (s.layout !== 'strips') {
      const R = Math.min(this.W, this.H) * 0.42 * k;
      const corners: [number, number, number][] = [
        [0, 0, 0], [this.W, 0, 0], [this.W, this.H, 0], [0, this.H, 0],
      ];
      // pick the perimeter sample nearest each corner
      corners.forEach((cn) => {
        let best = 0, bd = Infinity;
        for (let i = 0; i < n; i += 4) {
          const d = Math.abs(pts[i].x - cn[0]) + Math.abs(pts[i].y - cn[1]);
          if (d < bd) { bd = d; best = i; }
        }
        cn[2] = best;
      });
      for (const [x, y, i] of corners) {
        const inten = this.intensity[i];
        if (inten < 0.02) continue;
        const rr = R * (0.65 + 0.45 * clamp(inten));
        const col = `${(this.colA[i * 3] * 255) | 0},${(this.colA[i * 3 + 1] * 255) | 0},${(this.colA[i * 3 + 2] * 255) | 0}`;
        const grad = sc.createRadialGradient(x * k, y * k, 0, x * k, y * k, rr);
        grad.addColorStop(0, `rgba(${col},${clamp(inten * glow * 0.75 * B)})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        sc.fillStyle = grad;
        sc.fillRect(x * k - rr, y * k - rr, rr * 2, rr * 2);
      }
    }

    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.clearRect(0, 0, this.bloom.width, this.bloom.height);
    const radius = s.blur * k * (1 + 0.3 * this.kickS * this.live);
    if (this.canFilter) {
      // three halos added on top of each other (not layered over): a tight shine hugging the strip,
      // the main glow, and a wide spill into the room
      bc.globalCompositeOperation = 'lighter';
      bc.filter = `blur(${(radius * 0.15).toFixed(1)}px)`;
      bc.globalAlpha = 0.9;
      bc.drawImage(this.scratch, 0, 0);
      bc.filter = `blur(${(radius * 0.35).toFixed(1)}px)`;
      bc.globalAlpha = 1;
      bc.drawImage(this.scratch, 0, 0);
      bc.filter = `blur(${(radius * 1.1).toFixed(1)}px)`;
      bc.globalAlpha = 1;
      bc.drawImage(this.scratch, 0, 0);
      bc.filter = 'none';
      bc.globalAlpha = 1;
      bc.globalCompositeOperation = 'source-over';
    } else {
      bc.drawImage(this.scratch, 0, 0);
      this.bloom.style.filter = `blur(${(s.blur * 0.6).toFixed(0)}px)`;
    }
  }

  private drawVisualizer(s: LightingSettings, f: AudioFeatures, dt: number) {
    const g = this.vizCtx;
    if (!g || !this.viz) return;
    const scale = this.viz.width / this.W;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const rect = (el?: HTMLElement): Anchor | null => {
      if (!el || !el.isConnected) return null;
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    };
    // lyrics / clock / ambient views stay clean (as in the references) — only the
    // artwork and visualizer views draw a centre visualizer
    const style =
      s.view === 'visualizer' ? (s.visualizer === 'none' ? 'circular' : s.visualizer) : s.view === 'artwork' ? s.visualizer : 'none';
    this.vizRenderer.draw(style, {
      g, W: this.W, H: this.H,
      art: rect(this.anchors.get('art')),
      eq: rect(this.anchors.get('eq')),
      f, P: this.P, S: this.S, T: this.T, dt, live: this.live,
      brightness: Math.min(1.2, s.brightness) * (s.lateNight ? 0.6 : 1),
    });
  }
}

export const lightingEngine = new LightingEngine();
