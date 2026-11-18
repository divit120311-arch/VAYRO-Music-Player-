import { useVisualizerCanvas } from '../hooks/useAmbientLighting';

/** Full-viewport canvas behind the UI; the engine draws the selected visualizer anchored to the artwork. */
export function Visualizer() {
  const ref = useVisualizerCanvas();
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
