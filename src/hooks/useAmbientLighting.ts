import { useEffect, useRef } from 'react';
import { lightingEngine } from '../engine/lightingEngine';
import { css } from '../utils/colorUtils';

/** Hands the two lighting canvases to the engine and keeps CSS accent variables in sync. */
export function useAmbientLighting() {
  const coreRef = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!coreRef.current || !bloomRef.current) return;
    const detach = lightingEngine.attachLighting(coreRef.current, bloomRef.current);

    // mirror the live colours into CSS so UI accents follow the light (≈10 Hz)
    let last = 0;
    let prev = '';
    const root = document.documentElement;
    const off = lightingEngine.onFrame((f) => {
      if (f.t - last < 0.1) return;
      last = f.t;
      const p = css(f.P);
      const s = css(f.S);
      if (p + s === prev) return;
      prev = p + s;
      root.style.setProperty('--glow-p', p);
      root.style.setProperty('--glow-s', s);
    });
    return () => {
      off();
      detach();
    };
  }, []);

  return { coreRef, bloomRef };
}

export function useVisualizerCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    return lightingEngine.attachVisualizer(ref.current);
  }, []);
  return ref;
}
