/**
 * Adaptive visual quality: one place decides how much rendering the computer gets asked to do.
 *
 *   ultra        everything: liquid-glass refraction, 3D hero at high resolution, 60 fps lighting
 *   balanced     the same look, lighter: 3D hero at lower resolution, idle lighting at 30 fps
 *   performance  for low-end PCs: no WebGL hero (the drawn SVG one), no SVG refraction filters,
 *                lighter blur, lighting at 30 fps and 1× resolution, decorative loops paused
 *
 * "Auto" starts from a hardware estimate (CPU cores, memory, the GPU's name — software renderers and
 * old integrated chips count as weak) and then follows the measured frame rate, with hysteresis:
 * it steps down after ~5 s of real stutter and steps back up only after ~40 s of comfortable frames,
 * never above the hardware estimate, and never more often than every 20 s. Lyrics timing never
 * depends on the level: lyrics are recomputed from the playback clock on every frame.
 */
export type Quality = 'ultra' | 'balanced' | 'performance';
export type QualityPref = 'auto' | Quality;

const ORDER: Quality[] = ['performance', 'balanced', 'ultra'];
export const qualityRank = (q: Quality) => ORDER.indexOf(q);

export interface QualitySettings {
  /** lighting frame-rate cap (0 = display rate) while music plays / while idle */
  fpsPlaying: number;
  fpsIdle: number;
  /** highest canvas pixel ratio for the lighting */
  maxDpr: number;
  /** 3D hero: off (drawn SVG instead) or its pixel-ratio range */
  hero3d: false | [number, number];
  /** SVG displacement (refraction) on glass — Chromium only, and the most expensive effect */
  liquid: boolean;
}

export const QUALITY: Record<Quality, QualitySettings> = {
  ultra: { fpsPlaying: 0, fpsIdle: 0, maxDpr: 2, hero3d: [1, 1.75], liquid: true },
  balanced: { fpsPlaying: 0, fpsIdle: 30, maxDpr: 1.5, hero3d: [1, 1.25], liquid: true },
  performance: { fpsPlaying: 30, fpsIdle: 30, maxDpr: 1, hero3d: false, liquid: false },
};

export interface HardwareInfo {
  cores?: number;
  memoryGB?: number;
  gpu?: string;
  saveData?: boolean;
  /** WebGL works here (probed once at start, shared — creating a context is slow on weak GPUs) */
  webgl?: boolean;
}

/** the best level the hardware should start at (Auto never goes above it) */
export function estimateQuality(hw: HardwareInfo): Quality {
  const gpu = (hw.gpu ?? '').toLowerCase();
  const software = /swiftshader|llvmpipe|softpipe|microsoft basic render|software/.test(gpu);
  // older Intel integrated graphics (HD 2000–630, GMA); Iris Xe / Arc and Apple GPUs are fine
  const weakGpu = software || /intel\(r\) (hd|uhd) graphics( \d{3,4})?\b(?!.*xe)|gma|mali-[gt]\d{2}\b|adreno \(tm\) [3-5]\d\d/.test(gpu);
  const cores = hw.cores ?? 4;
  const mem = hw.memoryGB ?? 8;
  if (software || hw.saveData || cores <= 2 || mem <= 2) return 'performance';
  if (weakGpu || cores <= 4 || mem <= 4) return 'balanced';
  return 'ultra';
}

/** `probeGpu = false`: CPU / memory only (instant) */
export function readHardware(probeGpu = true): HardwareInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  let gpu: string | undefined;
  let webgl = false;
  if (probeGpu) try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (gl) {
      webgl = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      gl.getExtension('WEBGL_lose_context')?.loseContext(); // don't keep a context alive for a probe
    } else gpu = 'software (no WebGL)';
  } catch {
    gpu = undefined;
  }
  return { cores: nav.hardwareConcurrency, memoryGB: nav.deviceMemory, gpu, saveData: nav.connection?.saveData, webgl };
}

/**
 * Frame-rate governor for Auto (pure logic, fed one sample per second so it can be unit-tested).
 * `fps` = frames actually drawn in that second relative to what was asked for (a 30 fps cap that
 * draws 30 counts as healthy).
 */
export class QualityGovernor {
  level: Quality;
  private slow = 0;
  private smooth = 0;
  private lastChange = -Infinity;

  constructor(
    readonly ceiling: Quality,
    private readonly opts = { slowRatio: 0.7, slowSeconds: 5, smoothRatio: 0.95, smoothSeconds: 40, cooldown: 20 },
  ) {
    this.level = ceiling;
  }

  /** one second of frames; returns the new level when it changes */
  sample(nowSec: number, drawn: number, wanted: number): Quality | null {
    if (wanted <= 0) return null;
    const ratio = drawn / wanted;
    if (ratio < this.opts.slowRatio) {
      this.slow++;
      this.smooth = 0;
    } else if (ratio >= this.opts.smoothRatio) {
      this.smooth++;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.smooth = 0;
    }
    if (nowSec - this.lastChange < this.opts.cooldown) return null;
    const r = qualityRank(this.level);
    if (this.slow >= this.opts.slowSeconds && r > 0) return this.set(ORDER[r - 1], nowSec);
    if (this.smooth >= this.opts.smoothSeconds && r < qualityRank(this.ceiling)) return this.set(ORDER[r + 1], nowSec);
    return null;
  }

  private set(q: Quality, nowSec: number) {
    this.level = q;
    this.slow = 0;
    this.smooth = 0;
    this.lastChange = nowSec;
    return q;
  }
}
