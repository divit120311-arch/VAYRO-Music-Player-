import type { Track } from '../types/music';

/**
 * "Neon Nocturne" — an original 16-bar piece synthesised in the browser with an
 * OfflineAudioContext, then encoded to WAV and played through the normal pipeline.
 * It exists so you can see the lighting react without uploading anything, and it has
 * deliberately distinct bass / mid / high material so every lighting mode has something to chew on.
 */

const SR = 44100;
const BPM = 112;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
const BARS = 16;
const TAIL = 2.5;

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Am – F – C – G   (root, chord tones)
const PROG: { root: number; tones: number[] }[] = [
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [57, 60, 65] },
  { root: 48, tones: [55, 60, 64] },
  { root: 43, tones: [55, 59, 62] },
];
const ARP = [0, 1, 2, 1, 2, 0, 1, 2, 0, 1, 2, 1, 2, 1, 0, 2];

function render(): Promise<AudioBuffer> {
  const total = BARS * BAR + TAIL;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.gain.setValueAtTime(0.9, BARS * BAR - 0.5);
  master.gain.linearRampToValueAtTime(0, total);
  master.connect(comp).connect(ctx.destination);

  const drums = ctx.createGain();
  drums.gain.value = 0.85;
  drums.connect(master);
  const music = ctx.createGain(); // ducked by the kick ("sidechain")
  music.connect(master);

  // stereo delay for the arp
  const delay = ctx.createDelay(1);
  delay.delayTime.value = BEAT * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const wet = ctx.createStereoPanner();
  wet.pan.value = 0.35;
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.35;
  delay.connect(fb).connect(delay);
  delay.connect(wetGain).connect(wet).connect(music);

  const noise = ctx.createBuffer(1, SR, SR);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noiseHit = (t: number, dur: number, type: BiquadFilterType, freq: number, q: number, level: number, dest: AudioNode, pan = 0) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  };

  const hasKick = (bar: number) => bar >= 2 && !(bar >= 12 && bar < 14);
  const hasHats = (bar: number) => bar >= 2;
  const hasSnare = (bar: number) => bar >= 4 && !(bar >= 12 && bar < 14);
  const hasBass = (bar: number) => bar >= 2 && bar !== 13;

  music.gain.value = 1;
  const scheduleBar = (bar: number) => {
    const t0 = bar * BAR;
    const chord = PROG[bar % 4];

    // ---- pad: two detuned saws per tone through a slowly opening low-pass
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.Q.value = 0.7;
    const open = 500 + (bar / BARS) * 1600;
    padFilter.frequency.setValueAtTime(open * 0.7, t0);
    padFilter.frequency.linearRampToValueAtTime(open * 1.3, t0 + BAR);
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, t0);
    padGain.gain.linearRampToValueAtTime(0.055, t0 + 0.35);
    padGain.gain.setValueAtTime(0.055, t0 + BAR - 0.1);
    padGain.gain.linearRampToValueAtTime(0, t0 + BAR + 0.5);
    padFilter.connect(padGain).connect(music);
    for (const m of chord.tones) {
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(padFilter);
        o.start(t0);
        o.stop(t0 + BAR + 0.6);
      }
    }

    // ---- arp: 16th-note plucks an octave up
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * (BEAT / 4);
      const m = chord.tones[ARP[s]] + 12 + (bar >= 8 && s % 8 === 7 ? 12 : 0);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(m);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = 4;
      f.frequency.setValueAtTime(bar >= 8 ? 4200 : 2600, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.14);
      const g = ctx.createGain();
      const lvl = s % 4 === 0 ? 0.075 : 0.05;
      g.gain.setValueAtTime(lvl, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.2);
      o.connect(f).connect(g);
      g.connect(music);
      g.connect(delay);
      o.start(t);
      o.stop(t + 0.22);
    }

    for (let beat = 0; beat < 4; beat++) {
      const tb = t0 + beat * BEAT;

      // ---- kick + sidechain duck
      if (hasKick(bar)) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(160, tb);
        o.frequency.exponentialRampToValueAtTime(42, tb + 0.13);
        const g = ctx.createGain();
        g.gain.setValueAtTime(1, tb);
        g.gain.exponentialRampToValueAtTime(0.001, tb + 0.45);
        o.connect(g).connect(drums);
        o.start(tb);
        o.stop(tb + 0.5);
        noiseHit(tb, 0.012, 'highpass', 3000, 0.7, 0.25, drums); // click
        music.gain.setValueAtTime(0.45, tb);
        music.gain.linearRampToValueAtTime(1, tb + BEAT * 0.8);
      }

      // ---- snare / clap on 2 and 4
      if (hasSnare(bar) && beat % 2 === 1) {
        noiseHit(tb, 0.22, 'bandpass', 1900, 0.9, 0.55, drums);
        noiseHit(tb + 0.012, 0.16, 'bandpass', 1200, 1.2, 0.3, drums);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.setValueAtTime(220, tb);
        o.frequency.exponentialRampToValueAtTime(140, tb + 0.08);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.35, tb);
        g.gain.exponentialRampToValueAtTime(0.001, tb + 0.12);
        o.connect(g).connect(drums);
        o.start(tb);
        o.stop(tb + 0.15);
      }

      // ---- hats: 8ths, 16ths in the second half, open hat on the off-beat
      if (hasHats(bar)) {
        const steps = bar >= 8 ? 4 : 2;
        for (let s = 0; s < steps; s++) {
          const th = tb + (s * BEAT) / steps;
          const offbeat = steps === 2 ? s === 1 : s === 2;
          noiseHit(th, offbeat && bar >= 6 ? 0.22 : 0.045, 'highpass', 7500, 0.8, offbeat ? 0.2 : 0.11, drums, s % 2 ? 0.25 : -0.2);
        }
      }

      // ---- sub bass: off-beat 8ths on the root
      if (hasBass(bar)) {
        for (const off of [0.5]) {
          const tbb = tb + off * BEAT;
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(chord.root + (beat === 3 && bar % 2 ? 7 : 0));
          const sub = ctx.createOscillator();
          sub.type = 'sine';
          sub.frequency.value = mtof(chord.root - 12);
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.setValueAtTime(900, tbb);
          f.frequency.exponentialRampToValueAtTime(180, tbb + BEAT * 0.45);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, tbb);
          g.gain.linearRampToValueAtTime(0.22, tbb + 0.01);
          g.gain.exponentialRampToValueAtTime(0.002, tbb + BEAT * 0.48);
          o.connect(f);
          sub.connect(f);
          f.connect(g).connect(music);
          o.start(tbb); sub.start(tbb);
          o.stop(tbb + BEAT * 0.5); sub.stop(tbb + BEAT * 0.5);
        }
      }
    }
    // riser into the drop at bar 14
    if (bar === 13) noiseHit(t0, BAR, 'bandpass', 3000, 0.6, 0.12, drums);
  };

  // Schedule each bar just before it plays (suspend/resume) instead of building the
  // whole song up-front: the engine then only processes ~one bar of nodes at a time,
  // which makes rendering roughly an order of magnitude faster.
  scheduleBar(0);
  for (let bar = 1; bar < BARS; bar++) {
    const at = (Math.floor(((bar * BAR - 0.15) * SR) / 128) * 128) / SR; // render-quantum aligned
    ctx.suspend(at).then(() => {
      scheduleBar(bar);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

function makeArtwork(): Promise<string | undefined> {
  const c = document.createElement('canvas');
  c.width = c.height = 600;
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(undefined);
  g.fillStyle = '#060508';
  g.fillRect(0, 0, 600, 600);
  const blob = (x: number, y: number, r: number, col: string) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 600, 600);
  };
  g.globalCompositeOperation = 'lighter';
  blob(170, 430, 360, 'rgba(255,110,30,0.75)');
  blob(470, 160, 320, 'rgba(255,40,140,0.55)');
  blob(420, 520, 260, 'rgba(120,60,255,0.45)');
  g.globalCompositeOperation = 'source-over';
  // a glowing frame, echoing the product
  g.shadowColor = 'rgba(255,150,80,0.9)';
  g.shadowBlur = 28;
  g.strokeStyle = 'rgba(255,200,150,0.95)';
  g.lineWidth = 3;
  g.strokeRect(150, 150, 300, 300);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,240,230,0.92)';
  g.font = '600 26px "Inter Tight Variable", system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('N E O N   N O C T U R N E', 300, 540);
  return new Promise((resolve) => c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : undefined), 'image/jpeg', 0.9));
}

let cached: Promise<Track> | null = null;

export function getDemoTrack(): Promise<Track> {
  cached ??= (async () => {
    const [buffer, artwork] = await Promise.all([render(), makeArtwork()]);
    const url = URL.createObjectURL(encodeWav(buffer));
    return {
      id: 'demo:neon-nocturne',
      provider: 'demo',
      title: 'Neon Nocturne',
      artist: 'Vayro Synth Engine',
      album: 'Rendered live in your browser',
      duration: buffer.duration,
      artwork,
      streamUrl: url,
      playable: true,
    } satisfies Track;
  })().catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}
