import type { VisualizerStyle } from '../types/lighting';
import type { AudioFeatures } from '../utils/audioAnalysis';
import { SPECTRUM_BANDS } from '../utils/audioAnalysis';
import { clamp, css, mixRgb, type RGB } from '../utils/colorUtils';

export interface Anchor { x: number; y: number; w: number; h: number }

export interface VizContext {
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  art: Anchor | null;
  eq: Anchor | null;
  f: AudioFeatures;
  P: RGB;
  S: RGB;
  /** accumulated animation time (already scaled by animation speed) */
  T: number;
  dt: number;
  /** 0..1, how "live" the analysis is (fades in/out) */
  live: number;
  brightness: number;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; mix: number }

const tmp: RGB = [0, 0, 0];

function spectrumAt(f: AudioFeatures, x: number) {
  // x in 0..1 → interpolated band (we skip the very top bands that are usually empty)
  const pos = clamp(x) * (SPECTRUM_BANDS * 0.86 - 1);
  const i = Math.floor(pos);
  const fr = pos - i;
  return f.spectrum[i] * (1 - fr) + f.spectrum[Math.min(SPECTRUM_BANDS - 1, i + 1)] * fr;
}

export class VisualizerRenderer {
  private particles: Particle[] = [];
  private lastBeat = 0;

  draw(style: VisualizerStyle, v: VizContext) {
    const { g, W, H } = v;
    g.clearRect(0, 0, W, H);
    if (style === 'none') return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    switch (style) {
      case 'pulse': this.pulse(v); break;
      case 'circular': this.pulse(v, 0.45); this.circular(v); break;
      case 'bars': this.pulse(v, 0.4); this.bars(v); break;
      case 'waveform': this.waveform(v); break;
      case 'particles': this.pulse(v, 0.5); this.particlesDraw(v); break;
      case 'equalizer': this.pulse(v, 0.45); this.equalizer(v); break;
    }
    g.restore();
  }

  /** soft light pooled behind the artwork, breathing with the bass */
  private pulse(v: VizContext, strength = 1) {
    const { g, art, f, P, S, T, live, brightness } = v;
    if (!art) return;
    const cx = art.x + art.w / 2, cy = art.y + art.h / 2;
    const idle = (1 - live) * (0.5 + 0.5 * Math.sin(T * 0.9));
    const e = f.bass * 0.7 + f.energy * 0.3;
    const r = art.w * (0.75 + 0.55 * e + 0.25 * f.beat + 0.08 * idle);
    const a = (0.16 + 0.42 * e + 0.18 * f.beat + 0.06 * idle) * strength * brightness;
    const grad = g.createRadialGradient(cx, cy, art.w * 0.2, cx, cy, r);
    grad.addColorStop(0, css(P, a));
    grad.addColorStop(0.45, css(mixRgb(P, S, 0.6, tmp), a * 0.45));
    grad.addColorStop(1, css(S, 0));
    g.fillStyle = grad;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  private circular(v: VizContext) {
    const { g, art, f, P, S, T, brightness } = v;
    if (!art) return;
    const cx = art.x + art.w / 2, cy = art.y + art.h / 2;
    const r0 = art.w * 0.64;
    const n = 120;
    g.lineCap = 'round';
    g.lineWidth = Math.max(1.5, art.w * 0.007);
    const rot = T * 0.04;
    for (let i = 0; i < n; i++) {
      const half = i < n / 2 ? i / (n / 2) : (n - i) / (n / 2); // mirrored: bass at top, highs at bottom
      const val = spectrumAt(f, half);
      const len = 3 + val * art.w * 0.32;
      const a = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
      const cos = Math.cos(a), sin = Math.sin(a);
      g.strokeStyle = css(mixRgb(P, S, half, tmp), (0.25 + val * 0.75) * brightness);
      g.beginPath();
      g.moveTo(cx + cos * r0, cy + sin * r0);
      g.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
      g.stroke();
    }
  }

  /** a low skyline of bars hugging the bottom edge, mirrored from the centre */
  private bars(v: VizContext) {
    const { g, W, H, f, P, S, brightness } = v;
    const n = 72;
    const gap = 3;
    const bw = (W - gap * (n - 1)) / n;
    const maxH = H * 0.2;
    for (let i = 0; i < n; i++) {
      const fromCenter = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
      const val = spectrumAt(f, fromCenter);
      const h = 2 + val * maxH;
      const x = i * (bw + gap);
      const col = mixRgb(P, S, fromCenter, tmp);
      const grad = g.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, css(col, 0.7 * brightness));
      grad.addColorStop(1, css(col, 0.04));
      g.fillStyle = grad;
      g.fillRect(x, H - h, bw, h);
    }
  }

  private waveform(v: VizContext) {
    const { g, W, art, f, P, S, live, T, brightness, H } = v;
    const cy = art ? art.y + art.h / 2 : H / 2;
    const amp = (art ? art.h : H * 0.3) * 0.55;
    const n = f.waveform.length;
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, css(P, 0));
    grad.addColorStop(0.25, css(P, 0.9 * brightness));
    grad.addColorStop(0.75, css(S, 0.9 * brightness));
    grad.addColorStop(1, css(S, 0));
    const path = (scale: number, phase: number) => {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * W;
        // window so the line rests at the edges; idle shimmer when nothing plays
        const win = Math.sin((i / (n - 1)) * Math.PI);
        const idle = (1 - live) * 0.04 * Math.sin(i * 0.08 + T * 1.6 + phase);
        const y = cy + (f.waveform[i] * scale + idle) * amp * win;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
    };
    g.strokeStyle = grad;
    g.lineJoin = 'round';
    g.globalAlpha = 0.18;
    g.lineWidth = 10;
    path(1.6, 0);
    g.stroke();
    g.globalAlpha = 0.35;
    g.lineWidth = 4;
    path(1.6, 0);
    g.stroke();
    g.globalAlpha = 0.9;
    g.lineWidth = 1.6;
    path(1.6, 0);
    g.stroke();
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    path(-0.9, 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  private particlesDraw(v: VizContext) {
    const { g, art, f, P, S, dt, live, brightness } = v;
    if (!art) return;
    const cx = art.x + art.w / 2, cy = art.y + art.h / 2;
    // spawn
    let spawn = (6 + 90 * f.energy * live + 4 * (1 - live)) * dt;
    if (f.beatCount !== this.lastBeat) {
      this.lastBeat = f.beatCount;
      spawn += 18;
    }
    while (spawn > 0 && this.particles.length < 260) {
      if (spawn < 1 && Math.random() > spawn) break;
      spawn -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = art.w * (0.5 + Math.random() * 0.12);
      const speed = 18 + Math.random() * 40 + f.mid * 120;
      this.particles.push({
        x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life: 0, max: 2 + Math.random() * 2.5, size: 0.8 + Math.random() * 2.2, mix: Math.random(),
      });
    }
    const swirl = 0.25 + f.high * 1.2;
    const boost = 1 + f.bass * 1.5;
    g.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.max) {
        this.particles.splice(i, 1);
        continue;
      }
      // gentle tangential swirl + drag
      const dx = p.x - cx, dy = p.y - cy;
      p.vx += -dy * swirl * dt * 0.15;
      p.vy += dx * swirl * dt * 0.15;
      p.vx *= 1 - dt * 0.35;
      p.vy *= 1 - dt * 0.35;
      p.x += p.vx * dt * boost;
      p.y += p.vy * dt * boost;
      const k = p.life / p.max;
      const alpha = Math.sin(k * Math.PI) * (0.5 + f.high * 0.5) * brightness;
      g.fillStyle = css(mixRgb(P, S, p.mix, tmp), alpha);
      const s = p.size * (1 + f.beat * 0.8);
      g.beginPath();
      g.arc(p.x, p.y, s, 0, Math.PI * 2);
      g.fill();
    }
  }

  /** a tiny 7-column LED meter in the slot under the track title */
  private equalizer(v: VizContext) {
    const { g, eq, f, P, S, brightness } = v;
    if (!eq) return;
    const cols = 7;
    const rows = 6;
    const cw = 6, gapX = 6;
    const totalW = cols * cw + (cols - 1) * gapX;
    const x0 = eq.x + (eq.w - totalW) / 2;
    const rh = 3, gapY = 2;
    const y0 = eq.y + eq.h;
    for (let c = 0; c < cols; c++) {
      const val = spectrumAt(f, (c + 0.5) / cols * 0.85);
      const lit = Math.round(val * rows);
      for (let r = 0; r < rows; r++) {
        const on = r < Math.max(1, lit);
        g.fillStyle = css(mixRgb(P, S, r / rows, tmp), (on ? 0.95 : 0.1) * brightness);
        g.fillRect(x0 + c * (cw + gapX), y0 - (r + 1) * (rh + gapY), cw, rh);
      }
    }
  }
}
