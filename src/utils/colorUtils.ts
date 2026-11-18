export type RGB = [number, number, number]; // 0..1

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = Number.parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [1, 0.5, 0.1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const to = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function hslToRgb(h: number, s: number, l: number, out: RGB = [0, 0, 0]): RGB {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  out[0] = f(0);
  out[1] = f(8);
  out[2] = f(4);
  return out;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

export function mixRgb(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** shortest-path hue interpolation */
export function lerpHue(a: number, b: number, t: number) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return (((a + d * t) % 1) + 1) % 1;
}

export const css = (c: RGB, alpha = 1) =>
  `rgba(${Math.round(clamp(c[0]) * 255)},${Math.round(clamp(c[1]) * 255)},${Math.round(clamp(c[2]) * 255)},${alpha})`;

/**
 * Pull two vivid, distinct colours out of an image (album art).
 * Requires a CORS-readable image; returns null if the canvas is tainted.
 */
export function extractPalette(img: HTMLImageElement): [string, string] | null {
  try {
    const size = 48;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;
    // 24 hue buckets weighted by saturation and mid-lightness
    const buckets = Array.from({ length: 24 }, (_, i) => ({ i, w: 0, r: 0, g: 0, b: 0 }));
    for (let i = 0; i < data.length; i += 4) {
      const rgb: RGB = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      const [h, s, l] = rgbToHsl(rgb);
      if (l < 0.12 || l > 0.92 || s < 0.22) continue;
      const w = s * s * (1 - Math.abs(l - 0.5) * 1.4);
      const bk = buckets[Math.floor(h * 24) % 24];
      bk.w += w; bk.r += rgb[0] * w; bk.g += rgb[1] * w; bk.b += rgb[2] * w;
    }
    const ranked = buckets.filter((b) => b.w > 0.5).sort((a, b) => b.w - a.w);
    if (!ranked.length) return null;
    const vivid = (b: (typeof ranked)[number]): string => {
      const [h, s] = rgbToHsl([b.r / b.w, b.g / b.w, b.b / b.w]);
      return rgbToHex(hslToRgb(h, Math.max(0.75, s), 0.55));
    };
    const first = ranked[0];
    const second = ranked.find((b) => Math.min(Math.abs(b.i - first.i), 24 - Math.abs(b.i - first.i)) >= 3);
    const p1 = vivid(first);
    let p2: string;
    if (second) p2 = vivid(second);
    else {
      const [h, s] = rgbToHsl(hexToRgb(p1));
      p2 = rgbToHex(hslToRgb(h + 0.07, s, 0.42));
    }
    return [p1, p2];
  } catch {
    return null; // tainted canvas
  }
}
