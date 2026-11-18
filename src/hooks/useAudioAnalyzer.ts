import { useCallback, useEffect, useRef } from 'react';
import { lightingEngine, type FrameInfo } from '../engine/lightingEngine';

/**
 * Subscribe to the render loop. The callback runs every animation frame with the
 * latest audio features and colours — use it for direct DOM writes (refs), never setState.
 */
export function useFrame(cb: (f: FrameInfo) => void, enabled = true) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!enabled) return;
    return lightingEngine.onFrame((f) => ref.current(f));
  }, [enabled]);
}

/**
 * Register an element whose on-screen rect anchors the centre visualizer.
 * Uses a React 19 ref cleanup so an unmounting view (e.g. immersive mode fading out)
 * only removes *its own* anchor, never the one the next view just registered.
 */
export function useVisualizerAnchor(name: 'art' | 'eq') {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      lightingEngine.setAnchor(name, el);
      return () => lightingEngine.clearAnchor(name, el);
    },
    [name],
  );
}
