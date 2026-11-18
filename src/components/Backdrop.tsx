import { useEffect, useRef } from 'react';
import { useCurrentTrack, useSettings } from '../hooks/useAudioPlayer';
import { useFrame } from '../hooks/useAudioAnalyzer';

/**
 * The "room": a near-black field with the album art smeared huge and dim behind
 * everything, like the screen glow in the reference footage. Background darkness
 * controls how much of it bleeds through.
 */
export function Backdrop() {
  const track = useCurrentTrack();
  const darkness = useSettings((s) => s.darkness);
  const showArtwork = useSettings((s) => s.showArtwork);
  const washRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // room colour: charcoal (0) → pitch black (1)
    const v = Math.round(20 * (1 - darkness));
    document.documentElement.style.setProperty('--room', `rgb(${v} ${v} ${v + 3})`);
  }, [darkness]);

  const base = 0.06 + (1 - darkness) * 0.42;
  useFrame((f) => {
    const el = washRef.current;
    if (!el) return;
    const e = f.features.energySlow * f.live;
    el.style.opacity = String(base * (0.75 + 0.5 * e + 0.25 * f.features.beat * f.live));
  });

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        ref={washRef}
        className="absolute inset-[-15%] transition-[background-image] duration-1000"
        style={{
          opacity: base,
          backgroundImage: track?.artwork && showArtwork
            ? `url("${track.artwork}")`
            : 'radial-gradient(60% 50% at 30% 70%, var(--glow-p), transparent 70%), radial-gradient(50% 40% at 75% 30%, var(--glow-s), transparent 70%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(90px) saturate(140%)',
        }}
      />
      {/* ambient light orbs: pre-softened radial gradients (no blur filter), drifting over minutes */}
      <div className="orb orb-a" style={{ width: '46vw', height: '46vw', left: '-8vw', top: '38vh', opacity: 0.1, background: 'radial-gradient(closest-side, var(--glow-p), transparent)' }} />
      <div className="orb orb-b" style={{ width: '40vw', height: '40vw', right: '-6vw', top: '-10vh', opacity: 0.08, background: 'radial-gradient(closest-side, var(--glow-s), transparent)' }} />
      <div className="orb orb-c" style={{ width: '30vw', height: '30vw', left: '38vw', bottom: '-14vh', opacity: 0.05, background: 'radial-gradient(closest-side, color-mix(in srgb, var(--glow-p) 50%, #6d5cff), transparent)' }} />
      {/* vignette keeps the edges dark so the strips read as the light source */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(75% 70% at 50% 45%, transparent 30%, var(--room) 100%)' }} />
      {/* film grain: breaks up gradient banding, barely visible */}
      <div className="grain absolute inset-0" />
    </div>
  );
}
