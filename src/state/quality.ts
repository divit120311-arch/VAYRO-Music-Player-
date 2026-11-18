import { createStore } from '../store';
import { lightingEngine } from '../engine/lightingEngine';
import { QUALITY, QualityGovernor, estimateQuality, readHardware, type Quality, type QualityPref } from '../engine/quality';
import { settingsStore } from './settings';

/**
 * Applies the visual-quality level (see engine/quality.ts) and, in Auto, keeps it matched to how
 * smoothly this computer is actually drawing. Everything that scales with quality reads
 * `qualityStore` (3D hero, glass refraction) or `<html data-quality>` (CSS blur and decorations).
 */
export const qualityStore = createStore<{ level: Quality; ceiling: Quality; pref: QualityPref; gpu: string; webgl: boolean; probed: boolean }>({
  level: 'balanced',
  ceiling: 'balanced',
  pref: 'auto',
  gpu: '',
  webgl: false,
  /** the GPU probe has run (until then the hero shows its drawn, GPU-free version) */
  probed: false,
});

let governor: QualityGovernor | null = null;

function apply(level: Quality) {
  const st = qualityStore.getState();
  if (st.level === level && document.documentElement.dataset.quality === level) return;
  qualityStore.setState({ level });
  document.documentElement.dataset.quality = level;
  lightingEngine.setQuality(QUALITY[level]);
}

function follow(pref: QualityPref) {
  qualityStore.setState({ pref });
  if (pref === 'auto') {
    governor = new QualityGovernor(qualityStore.getState().ceiling);
    apply(governor.level);
  } else {
    governor = null;
    apply(pref);
  }
}

/** frames drawn per second vs. frames wanted, one sample a second, only while the page is visible */
function watchFrames() {
  let drawn = 0;
  let windowStart = performance.now();
  let display = 60; // best uncapped rate seen: the display's refresh rate
  lightingEngine.onFrame(() => {
    drawn++;
    const now = performance.now();
    const span = now - windowStart;
    if (span < 1000) return;
    const perSec = (drawn * 1000) / span;
    drawn = 0;
    windowStart = now;
    // a gap (hidden page, a breakpoint, a long task we don't control) isn't a sample
    if (span > 2500 || document.hidden) return;
    const cap = lightingEngine.frameCap;
    if (!cap) display = Math.min(240, Math.max(display, Math.round(perSec)));
    const next = governor?.sample(now / 1000, perSec, cap || display);
    if (next) apply(next);
  });
}

export function initQuality() {
  // first a quick guess from CPU and memory (no GPU probe: creating a WebGL context can take
  // hundreds of ms on weak GPUs, so it waits until the page has painted)
  const base = estimateQuality({ ...readHardware(false) });
  qualityStore.setState({ ceiling: base });
  follow(settingsStore.getState().quality);
  const probe = () => {
    const hw = readHardware(true);
    qualityStore.setState({ ceiling: estimateQuality(hw), gpu: hw.gpu ?? '', webgl: !!hw.webgl, probed: true });
    follow(qualityStore.getState().pref);
  };
  // after the first paint (two frames), not before it
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(probe, 0)));
  let last = settingsStore.getState().quality;
  settingsStore.subscribe(() => {
    const q = settingsStore.getState().quality;
    if (q !== last) {
      last = q;
      follow(q);
    }
  });
  watchFrames();
}
