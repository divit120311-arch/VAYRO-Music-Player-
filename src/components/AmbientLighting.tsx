import { useAmbientLighting } from '../hooks/useAmbientLighting';

/**
 * The four glowing strips. Two stacked canvases above all content, never intercepting input:
 *  - bloom: quarter-resolution, blurred, `screen`-blended — the light spilling into the room
 *  - core:  full-resolution thin line on the very edge of the viewport
 */
export function AmbientLighting() {
  const { coreRef, bloomRef } = useAmbientLighting();
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <canvas ref={bloomRef} className="absolute inset-0 h-full w-full mix-blend-screen" />
      <canvas ref={coreRef} className="absolute inset-0 h-full w-full mix-blend-screen" />
    </div>
  );
}
