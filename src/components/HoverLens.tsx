import { useEffect, useRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform, useVelocity } from 'framer-motion';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * One liquid glass lens per group of options, which glides after the pointer like a drop of thick
 * glass:
 *   - it sits ON TOP of the options and magnifies them (Chromium: #liquid-magnify in LiquidGlass.tsx),
 *     bending them hardest at its rim;
 *   - while it travels it swells past the edges of the bar, and stretches in the direction of
 *     travel the faster it goes; when it stops it settles back to the option's size;
 *   - entering a group it appears where the pointer is; leaving, it fades away.
 * Options opt in with the `liquid-hover` class. Keyboard focus moves it too. "Reduce motion": it
 * jumps instead of gliding, with no swell or stretch.
 */
const GLIDE = { stiffness: 340, damping: 30, mass: 0.75 };
const SIZE = { stiffness: 340, damping: 40 };
const SWELL = 1.16; // size while travelling, relative to the option

export function HoverLensGroup({
  as: Tag = 'div', className, children, radius = 999, ...rest
}: { as?: ElementType; className?: string; children: ReactNode; radius?: number } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReduceMotion();
  const on = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);

  // target values (set directly) → springs (what's drawn)
  const tx = useMotionValue(0);
  const ty = useMotionValue(0);
  const tw = useMotionValue(0);
  const th = useMotionValue(0);
  const x = useSpring(tx, GLIDE);
  const y = useSpring(ty, GLIDE);
  const w = useSpring(tw, SIZE);
  const h = useSpring(th, SIZE);
  const swellTarget = useMotionValue(1);
  const swell = useSpring(swellTarget, { stiffness: 300, damping: 22 });
  const opacityTarget = useMotionValue(0);
  const opacity = useSpring(opacityTarget, { stiffness: 260, damping: 30 });

  // stretch along the direction of travel with speed; squeeze a little the other way
  const vx = useVelocity(x);
  const vy = useVelocity(y);
  const stretchX = useTransform(vx, (v) => 1 + Math.min(Math.abs(v) / 3200, 0.22));
  const stretchY = useTransform(vy, (v) => 1 + Math.min(Math.abs(v) / 3200, 0.22));
  const scaleX = useTransform([swell, stretchX, stretchY], ([s, a, b]: number[]) => (s * a) / Math.pow(b, 0.25));
  // the swell shows mostly as height (the drop rises out of the bar), the stretch mostly as width
  const scaleY = useTransform([swell, stretchX, stretchY], ([s, a, b]: number[]) => (s * s * b) / Math.pow(a, 0.25));

  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  const track = (target: EventTarget | null) => {
    const box = ref.current;
    const el = (target as HTMLElement | null)?.closest?.('.liquid-hover') as HTMLElement | null;
    if (!box || !el || !box.contains(el) || (el as HTMLButtonElement).disabled) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // scroll offset: groups like the Library menu scroll
    const nx = r.left - b.left + box.scrollLeft;
    const ny = r.top - b.top + box.scrollTop;
    if (on.current && nx === tx.get() && ny === ty.get() && r.width === tw.get() && r.height === th.get()) return;
    const fresh = !on.current;
    on.current = true;
    tx.set(nx);
    ty.set(ny);
    tw.set(r.width);
    th.set(r.height);
    opacityTarget.set(1);
    if (fresh || reduce) {
      // first appearance in the group (or reduced motion): be there, don't fly in from elsewhere
      x.jump(nx);
      y.jump(ny);
      w.jump(r.width);
      h.jump(r.height);
      return;
    }
    // travelling: swell, then settle back once it has (nearly) arrived
    swellTarget.set(SWELL);
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => swellTarget.set(1), 230);
  };

  const leave = () => {
    on.current = false;
    opacityTarget.set(0);
    swellTarget.set(1);
  };

  return (
    <Tag
      ref={ref}
      className={['lens-group relative', className].filter(Boolean).join(' ')}
      onPointerOver={(e: React.PointerEvent) => track(e.target)}
      onPointerLeave={leave}
      onFocus={(e: React.FocusEvent) => (e.target as HTMLElement).matches(':focus-visible') && track(e.target)}
      onBlur={leave}
      {...rest}
    >
      {children}
      {/* after the options and above them: the lens shows (and magnifies) what's under it */}
      <motion.span
        aria-hidden
        className="liquid-lens-el pointer-events-none absolute left-0 top-0 z-[2] origin-center"
        style={{ x, y, width: w, height: h, opacity, scaleX: reduce ? 1 : scaleX, scaleY: reduce ? 1 : scaleY, borderRadius: radius }}
      />
    </Tag>
  );
}
