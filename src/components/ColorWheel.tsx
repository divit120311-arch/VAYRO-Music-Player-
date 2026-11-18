import { useEffect, useRef } from 'react';
import { clamp } from '../utils/colorUtils';

/** HSV <-> hex helpers (wheel works in HSV like the reference panel) */
function hexToHsv(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60 + 360) % 360) / 360, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

function hsvToHex(h: number, s: number, v: number) {
  return `#${hsvToRgb(h, s, v).map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Hue/saturation wheel + brightness slider, as in the reference app's colour panel.
 * Drag on the wheel; keyboard arrows nudge hue (←/→) and saturation (↑/↓).
 */
export function ColorWheel({ value, onChange, label, size = 112 }: { value: string; onChange: (hex: string) => void; label: string; size?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [h, s, v] = hexToHsv(value);
  const hsv = useRef([h, s, v]);
  hsv.current = [h, s, v];

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const N = Math.round(size * dpr);
    c.width = c.height = N;
    const g = c.getContext('2d');
    if (!g) return;
    const img = g.createImageData(N, N);
    const R = N / 2;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = x - R + 0.5, dy = y - R + 0.5;
        const r = Math.hypot(dx, dy);
        const i = (y * N + x) * 4;
        if (r > R) continue;
        const [rr, gg, bb] = hsvToRgb((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1, r / R, Math.max(0.15, v));
        img.data[i] = rr * 255;
        img.data[i + 1] = gg * 255;
        img.data[i + 2] = bb * 255;
        img.data[i + 3] = r > R - 1 ? (R - r) * 255 : 255; // soft edge
      }
    }
    g.putImageData(img, 0, 0);
  }, [size, v]);

  const pick = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const hh = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    const ss = clamp(Math.hypot(dx, dy) / (r.width / 2));
    onChange(hsvToHex(hh, ss, hsv.current[2] || 1));
  };

  const angle = h * Math.PI * 2;
  const knob = { left: `${50 + Math.cos(angle) * s * 50}%`, top: `${50 + Math.sin(angle) * s * 50}%` };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="slider"
        tabIndex={0}
        aria-label={`${label} hue and saturation`}
        aria-valuetext={value}
        className="relative cursor-crosshair touch-none rounded-full"
        style={{ width: size, height: size, boxShadow: `0 0 26px -6px ${value}` }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e)}
        onKeyDown={(e) => {
          let [hh, ss] = hsv.current;
          if (e.key === 'ArrowLeft') hh -= 0.01;
          else if (e.key === 'ArrowRight') hh += 0.01;
          else if (e.key === 'ArrowUp') ss += 0.03;
          else if (e.key === 'ArrowDown') ss -= 0.03;
          else return;
          e.preventDefault();
          e.stopPropagation();
          onChange(hsvToHex((hh + 1) % 1, clamp(ss), hsv.current[2] || 1));
        }}
      >
        <canvas ref={canvas} className="h-full w-full rounded-full" />
        <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ ...knob, background: value }} />
      </div>
      <input
        type="range"
        min={0.15}
        max={1}
        step={0.01}
        value={v}
        aria-label={`${label} brightness`}
        onChange={(e) => onChange(hsvToHex(h, s, Number(e.target.value)))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full"
        style={{ background: `linear-gradient(90deg, #000, ${hsvToHex(h, s, 1)})`, accentColor: value }}
      />
    </div>
  );
}
