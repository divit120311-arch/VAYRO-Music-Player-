import { useEffect, useState } from 'react';
import { notchGeometry } from '../engine/lightingEngine';
import { useSettings } from '../hooks/useAudioPlayer';

/**
 * With "Notch contour" on, draw the camera housing the strip wraps around (as on the
 * MacBooks in the reference videos). Pure black, sitting just under the light layer.
 */
export function NotchBody() {
  const notch = useSettings((s) => s.notch);
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!notch) return null;
  const g = notchGeometry(w);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed top-0 z-[49] bg-black"
      style={{ left: g.x0, width: g.w, height: g.d, borderBottomLeftRadius: g.r, borderBottomRightRadius: g.r }}
    />
  );
}
