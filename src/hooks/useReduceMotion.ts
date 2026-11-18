import { useReducedMotion } from 'framer-motion';
import { useSettings } from './useAudioPlayer';

/**
 * Should animation be reduced? Follows the system's "reduce motion" (on Windows: Settings →
 * Accessibility → Visual effects → Animation effects) unless the listener chose otherwise in
 * Vayro's Settings → Motion.
 */
export function useReduceMotion(): boolean {
  const system = useReducedMotion();
  const motion = useSettings((s) => s.motion);
  if (motion === 'full') return false;
  if (motion === 'reduced') return true;
  return !!system;
}
