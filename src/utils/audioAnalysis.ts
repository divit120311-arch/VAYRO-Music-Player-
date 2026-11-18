import { clamp, smoothstep } from './colorUtils';

export const SPECTRUM_BANDS = 64;
export const WAVE_POINTS = 256;

/** Everything the renderers need from the music, every frame. Values are 0..1. */
export interface AudioFeatures {
  /** true while real, analysable audio is flowing */
  live: boolean;
  bass: number; //   25–150 Hz : kick, sub
  lowMid: number; // 150–500 Hz : body
  mid: number; //    500–2.5k  : vocals, instruments, melody
  high: number; //   4k–16k    : hats, cymbals, air
  energy: number; // weighted overall loudness
  /** slow-moving energy (seconds), for calm modes */
  energySlow: number;
  /** decaying 1→0 impulse fired on detected bass onsets */
  beat: number;
  /** continuous transient envelope of the low end (kick drums), instant attack */
  kick: number;
  beatCount: number;
  /** spectral centroid mapped to 0 (dark) … 1 (bright) */
  centroid: number;
  spectrum: Float32Array; // SPECTRUM_BANDS, log-spaced, smoothed
  waveform: Float32Array; // WAVE_POINTS, -1..1
}

export function emptyFeatures(): AudioFeatures {
  return {
    live: false, bass: 0, lowMid: 0, mid: 0, high: 0, energy: 0, energySlow: 0,
    beat: 0, kick: 0, beatCount: 0, centroid: 0.35,
    spectrum: new Float32Array(SPECTRUM_BANDS), waveform: new Float32Array(WAVE_POINTS),
  };
}

export interface AnalysisTuning {
  sensitivity: number;
  bassSensitivity: number;
  smoothing: number;
}

type BandKey = 'bass' | 'lowMid' | 'mid' | 'high';
interface Band { lo: number; hi: number; floor: number; peak: number; low: number; raw: number; value: number }

/**
 * Turns raw AnalyserNode byte data into perceptual, smoothed, normalised features.
 * - Adaptive per-band normalisation (slowly decaying peak) so quiet masters still move the lights.
 * - Asymmetric attack/release smoothing, frame-rate independent, to kill flicker.
 * - Bass-onset beat detection against a running average.
 */
export class AudioAnalyzer {
  readonly features = emptyFeatures();
  private bands: Record<BandKey, Band> = {
    bass: { lo: 25, hi: 150, floor: 0.3, peak: 0.35, low: 0, raw: 0, value: 0 },
    lowMid: { lo: 150, hi: 500, floor: 0.3, peak: 0.35, low: 0, raw: 0, value: 0 },
    mid: { lo: 500, hi: 2500, floor: 0.28, peak: 0.35, low: 0, raw: 0, value: 0 },
    high: { lo: 4000, hi: 16000, floor: 0.2, peak: 0.3, low: 0, raw: 0, value: 0 },
  };
  private bandEdges = new Int32Array(SPECTRUM_BANDS + 1);
  private edgesFor = '';
  private bassAvg = 0;
  private onsetPeak = 0.1;
  private lastBeat = 0;
  private specPeak = 0.5;

  private binRange(lo: number, hi: number, binHz: number, n: number): [number, number] {
    return [clamp(Math.floor(lo / binHz), 1, n - 2), clamp(Math.ceil(hi / binHz), 2, n)];
  }

  private avg(freq: Uint8Array, a: number, b: number) {
    let sum = 0;
    for (let i = a; i < b; i++) sum += freq[i];
    return sum / Math.max(1, b - a) / 255;
  }

  /**
   * @param freq  getByteFrequencyData output, or null when nothing analysable is playing
   * @param time  getByteTimeDomainData output
   * @param dt    seconds since the previous frame
   * @param now   seconds
   */
  update(
    freq: Uint8Array | null, time: Uint8Array | null,
    sampleRate: number, fftSize: number, dt: number, now: number, t: AnalysisTuning,
  ): AudioFeatures {
    const f = this.features;
    const dtc = Math.min(dt, 0.1);
    const release = 1 - Math.exp(-dtc / (0.05 + t.smoothing * 0.45)); // 50 … 500 ms
    const attack = 1 - Math.exp(-dtc / (0.012 + t.smoothing * 0.06)); // 12 … 72 ms
    const ease = (cur: number, target: number) => cur + (target - cur) * (target > cur ? attack : release);

    if (!freq || !time) {
      // paused or not analysable: glide everything back to darkness
      f.live = false;
      const k = 1 - Math.exp(-dtc / 0.35);
      f.bass -= f.bass * k; f.lowMid -= f.lowMid * k; f.mid -= f.mid * k; f.high -= f.high * k;
      f.energy -= f.energy * k;
      f.energySlow -= f.energySlow * (1 - Math.exp(-dtc / 1.5));
      f.beat *= Math.exp(-dtc * 6);
      f.kick *= Math.exp(-dtc * 8);
      for (let i = 0; i < f.spectrum.length; i++) f.spectrum[i] *= 1 - k;
      for (let i = 0; i < f.waveform.length; i++) f.waveform[i] *= 1 - k;
      return f;
    }

    f.live = true;
    const n = freq.length;
    const binHz = sampleRate / fftSize;

    // ---- four perceptual bands, each normalised to its *recent dynamic range*
    (Object.keys(this.bands) as BandKey[]).forEach((key) => {
      const band = this.bands[key];
      const [a, b] = this.binRange(band.lo, band.hi, binHz, n);
      const raw = this.avg(freq, a, b);
      band.raw = raw;
      // ceiling: rises instantly, relaxes over ~6 s, never below a minimum
      band.peak = Math.max(raw, band.peak * Math.exp(-dtc / 6), band.floor);
      // floor: drops instantly, creeps up over ~2.5 s — tracks the "resting" level
      band.low = raw < band.low ? raw : band.low + (raw - band.low) * (1 - Math.exp(-dtc / 2.5));
      const base = band.low * 0.85;
      const rel = clamp((raw - base) / Math.max(0.08, band.peak - base));
      // absolute presence gate: silence and faint spectral leakage stay dark.
      // (A loud, perfectly steady tone does read as a steady high value — by design.)
      const presence = clamp(raw / 0.32);
      const gain = t.sensitivity * (key === 'bass' ? t.bassSensitivity : 1);
      band.value = clamp(Math.pow(rel, 1.15) * (0.3 + 0.7 * presence) * gain);
    });
    f.bass = ease(f.bass, this.bands.bass.value);
    f.lowMid = ease(f.lowMid, this.bands.lowMid.value);
    f.mid = ease(f.mid, this.bands.mid.value);
    f.high = ease(f.high, this.bands.high.value);
    f.energy = clamp(f.bass * 0.4 + f.lowMid * 0.2 + f.mid * 0.28 + f.high * 0.12);
    f.energySlow += (f.energy - f.energySlow) * (1 - Math.exp(-dtc / 1.2));

    // ---- kick envelope + beat detection from the low band's onsets
    const bassRaw = this.bands.bass.raw;
    const onset = Math.max(0, bassRaw - this.bassAvg);
    this.bassAvg += (bassRaw - this.bassAvg) * (1 - Math.exp(-dtc / 0.3));
    this.onsetPeak = Math.max(onset, this.onsetPeak * Math.exp(-dtc / 4), 0.06);
    // relative to recent onsets, but gated by absolute size so leakage/noise can't fire it
    const kickTarget = clamp((onset / this.onsetPeak) * t.bassSensitivity * 0.9) * smoothstep(0.02, 0.07, onset);
    f.kick = Math.max(kickTarget, f.kick * Math.exp(-dtc * (6 + (1 - t.smoothing) * 6)));
    if (onset > this.onsetPeak * 0.45 && onset > 0.04 && now - this.lastBeat > 0.2) {
      this.lastBeat = now;
      f.beat = 1;
      f.beatCount++;
    } else {
      f.beat *= Math.exp(-dtc * (5 + (1 - t.smoothing) * 5));
    }

    // ---- spectral centroid (30 Hz – 10 kHz), log-mapped
    {
      const [a, b] = this.binRange(30, 10000, binHz, n);
      let num = 0, den = 0;
      for (let i = a; i < b; i++) { const v = freq[i]; num += i * v; den += v; }
      if (den > 0) {
        const hz = (num / den) * binHz;
        const c = clamp((Math.log2(hz) - Math.log2(150)) / (Math.log2(5000) - Math.log2(150)));
        f.centroid += (c - f.centroid) * (1 - Math.exp(-dtc / (0.25 + t.smoothing)));
      }
    }

    // ---- log-spaced spectrum (30 Hz – 16 kHz)
    const key = `${sampleRate}/${fftSize}`;
    if (key !== this.edgesFor) {
      this.edgesFor = key;
      const lo = Math.log2(30), hi = Math.log2(16000);
      for (let i = 0; i <= SPECTRUM_BANDS; i++) {
        const hz = Math.pow(2, lo + ((hi - lo) * i) / SPECTRUM_BANDS);
        this.bandEdges[i] = clamp(Math.round(hz / binHz), 1, n - 1);
      }
    }
    let frameMax = 0;
    const ceiling = Math.max(this.specPeak, 0.45);
    for (let i = 0; i < SPECTRUM_BANDS; i++) {
      const a = this.bandEdges[i];
      const b = Math.max(a + 1, this.bandEdges[i + 1]);
      let m = 0;
      for (let j = a; j < b; j++) if (freq[j] > m) m = freq[j];
      // gentle high-frequency tilt so the top end isn't always empty
      const v = (m / 255) * (1 + (i / SPECTRUM_BANDS) * 0.35);
      if (v > frameMax) frameMax = v;
      const gain = t.sensitivity * (i < 10 ? 0.5 + t.bassSensitivity * 0.5 : 1);
      f.spectrum[i] = ease(f.spectrum[i], Math.pow(clamp((v / ceiling) * gain), 1.5));
    }
    this.specPeak = Math.max(frameMax, this.specPeak * Math.exp(-dtc / 6));

    // ---- waveform (downsampled, lightly smoothed)
    const step = time.length / f.waveform.length;
    const wk = 1 - Math.exp(-dtc / 0.03);
    for (let i = 0; i < f.waveform.length; i++) {
      const v = (time[Math.floor(i * step)] - 128) / 128;
      f.waveform[i] += (v - f.waveform[i]) * wk;
    }
    return f;
  }
}
