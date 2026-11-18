import { useRef, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, type HTMLMotionProps } from 'framer-motion';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { cx } from './ui';

/**
 * Vayro's motion system: one set of timings and curves (mirrored as CSS variables in
 * index.css), so every entrance, reveal and press moves the same way. Only transform and opacity
 * are animated, and "reduce motion" turns movement off.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const DUR = { fast: 0.16, base: 0.28, slow: 0.56 };

/** A route/page swap inside a scrolling view: the new page settles in from slightly below. */
export function PageTransition({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const reduce = useReduceMotion();
  return (
    <motion.div
      key={id}
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A list or grid whose children fade up one after another as it scrolls into view (once).
 * Children use StaggerItem. Capped so a long list never takes long to appear.
 */
export function Stagger({ children, className, as = 'div', gap = 0.035 }: { children: ReactNode; className?: string; as?: 'div' | 'ul'; gap?: number }) {
  const reduce = useReduceMotion();
  const M = as === 'ul' ? motion.ul : motion.div;
  return (
    <M
      className={className}
      initial={reduce ? false : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </M>
  );
}

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } },
};

export function StaggerItem({ children, className, as = 'div', index = 0 }: { children: ReactNode; className?: string; as?: 'div' | 'li'; index?: number }) {
  // past ~24 items, appear together: long lists shouldn't trickle in
  const M = as === 'li' ? motion.li : motion.div;
  return (
    <M className={className} variants={index > 24 ? undefined : item}>
      {children}
    </M>
  );
}

/**
 * A button that leans a few pixels toward the pointer and springs back. Used only on the play
 * button: one magnetic control, not a page full of them.
 */
export function MagneticButton({ children, className, strength = 0.22, onPointerMove, onPointerLeave, ...rest }: HTMLMotionProps<'button'> & { strength?: number }) {
  const reduce = useReduceMotion();
  const ref = useRef<HTMLButtonElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.6 });
  return (
    <motion.button
      ref={ref}
      type="button"
      className={cx(className)}
      style={reduce ? undefined : { x: sx, y: sy }}
      onPointerMove={(e) => {
        onPointerMove?.(e);
        if (reduce || e.pointerType !== 'mouse' || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={(e) => {
        onPointerLeave?.(e);
        x.set(0);
        y.set(0);
      }}
      whileHover={reduce ? undefined : { scale: 1.05 }}
      whileTap={reduce ? undefined : { scale: 0.93 }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      {...rest}
    >
      {children}
    </motion.button>
  );
}
