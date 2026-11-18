import { useEffect } from 'react';
import { QUALITY } from '../engine/quality';
import { qualityStore } from '../state/quality';

/**
 * Liquid glass: the background seen through a pane is bent, like light through thick curved
 * glass, with a slight split of red/green/blue at the bends (chromatic aberration) — not just
 * frosted.
 *
 * Two SVG displacement filters, used by `backdrop-filter: url(#…)` in index.css:
 *   #liquid-glass  big panes (header pills, player bar, panels): broad, deep swells
 *   #liquid-lens   small pills (hovered / selected options): tighter, lens-like bending
 * Only Chromium browsers (Chrome, Edge, Arc, Opera…) apply SVG filters to the backdrop, so the
 * bending is switched on with `data-liquid` on <html> only there; other browsers keep the rim
 * light, highlights and frosting. Off with "reduce motion" and on phones (see index.css).
 */
export function LiquidGlassFilter() {
  useEffect(() => {
    const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
    const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    // the refraction is the most expensive effect on the page: only at Balanced and Ultra quality
    const apply = () => {
      if (chromium && !reduce.matches && QUALITY[qualityStore.getState().level].liquid) document.documentElement.dataset.liquid = '';
      else delete document.documentElement.dataset.liquid;
    };
    apply();
    reduce.addEventListener('change', apply);
    const unsub = qualityStore.subscribe(apply);
    return () => {
      reduce.removeEventListener('change', apply);
      unsub();
    };
  }, []);

  return (
    <svg aria-hidden width="0" height="0" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <defs>
        <LiquidFilter id="liquid-glass" frequency="0.005 0.008" blur={4} scale={96} split={14} />
        <LiquidFilter id="liquid-lens" frequency="0.03 0.045" blur={1.5} scale={34} split={8} />
        <MagnifyFilter />
      </defs>
    </svg>
  );
}

/**
 * The moving lens: magnifies what's under it (about 1.2×), bending a little more toward its rim
 * like a thick glass drop, with a thin colour fringe at the edge.
 *
 * The displacement map is a gradient image stretched over the lens (objectBoundingBox units, so the
 * zoom is the same for small and large lenses): red runs 1 → 0 left to right and green 1 → 0 top to
 * bottom, so every pixel samples from closer to the centre. The stops are only gently steeper at the
 * edges: a steep rim folds the image back on itself (mirrored copies of the label, tested), so the
 * rim bend stays mild.
 */
const LENS_MAP = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" preserveAspectRatio="none">' +
    '<defs>' +
    '<linearGradient id="r" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="0.12" stop-color="#d00000"/><stop offset="0.88" stop-color="#2f0000"/><stop offset="1" stop-color="#000000"/></linearGradient>' +
    '<linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00ff00"/><stop offset="0.14" stop-color="#00d000"/><stop offset="0.86" stop-color="#002f00"/><stop offset="1" stop-color="#000000"/></linearGradient>' +
    '</defs>' +
    '<rect width="200" height="200" fill="url(#r)"/>' +
    '<rect width="200" height="200" fill="url(#g)" style="mix-blend-mode:screen"/>' +
    '</svg>',
)}`;

function MagnifyFilter() {
  // one displacement per colour channel, each a hair stronger: a thin colour fringe at the rim
  const channel = (n: number, scale: number, keep: string) => (
    <>
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" result={`d${n}`} />
      <feColorMatrix in={`d${n}`} type="matrix" values={keep} result={`c${n}`} />
    </>
  );
  return (
    <filter id="liquid-magnify" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
      <feImage href={LENS_MAP} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
      {channel(0, 0.17, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      {channel(1, 0.18, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      {channel(2, 0.19, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
      <feBlend in="c0" in2="c1" mode="screen" result="rg" />
      <feBlend in="rg" in2="c2" mode="screen" />
    </filter>
  );
}

/**
 * Noise field → softened → used to displace the backdrop three times (one per colour channel,
 * each a little further), then the channels are recombined: bending plus colour fringing.
 */
function LiquidFilter({ id, frequency, blur, scale, split }: { id: string; frequency: string; blur: number; scale: number; split: number }) {
  const channel = (n: number, keep: string) => (
    <>
      <feDisplacementMap in="SourceGraphic" in2="swell" scale={scale + n * split} xChannelSelector="R" yChannelSelector="G" result={`d${n}`} />
      <feColorMatrix in={`d${n}`} type="matrix" values={keep} result={`c${n}`} />
    </>
  );
  return (
    <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves="2" seed="11" result="noise" />
      <feGaussianBlur in="noise" stdDeviation={blur} result="swell" />
      {channel(0, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      {channel(1, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0')}
      {channel(2, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0')}
      <feBlend in="c0" in2="c1" mode="screen" result="rg" />
      <feBlend in="rg" in2="c2" mode="screen" result="rgb" />
      {/* light gathering in the glass */}
      <feComponentTransfer in="rgb">
        <feFuncR type="linear" slope="1.1" />
        <feFuncG type="linear" slope="1.1" />
        <feFuncB type="linear" slope="1.1" />
      </feComponentTransfer>
    </filter>
  );
}
