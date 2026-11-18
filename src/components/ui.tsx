import { forwardRef, useCallback, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { HoverLensGroup } from './HoverLens';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = 'md', className, children, ...rest },
  ref,
) {
  const dims = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        dims,
        'press liquid-hover inline-flex shrink-0 items-center justify-center rounded-full transition-[color,background-color,box-shadow,transform] duration-[var(--dur-base)] ease-out-soft',
        'text-ink-2 hover:bg-white/[0.07] hover:text-ink disabled:pointer-events-none disabled:opacity-30',
        active && 'liquid-pill text-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Accessible slider with pointer dragging; value 0..1 scaled to [min,max]. */
export function Slider({
  value, min = 0, max = 1, step = 0.01, onChange, label, className, trackClassName, fillStyle, format,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
  trackClassName?: string;
  fillStyle?: React.CSSProperties;
  format?: (v: number) => string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;
  const fromEvent = useCallback(
    (clientX: number) => {
      const r = ref.current!.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const raw = min + t * (max - min);
      onChange(Math.round(raw / step) * step);
    },
    [min, max, step, onChange],
  );
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={format?.(value)}
      className={cx('group relative flex h-5 cursor-pointer touch-none select-none items-center', className)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        fromEvent(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && fromEvent(e.clientX)}
      onKeyDown={(e) => {
        const big = (max - min) / 10;
        let v = value;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v += step * (e.shiftKey ? 10 : 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v -= step * (e.shiftKey ? 10 : 1);
        else if (e.key === 'PageUp') v += big;
        else if (e.key === 'PageDown') v -= big;
        else if (e.key === 'Home') v = min;
        else if (e.key === 'End') v = max;
        else return;
        e.preventDefault();
        e.stopPropagation();
        onChange(Math.min(max, Math.max(min, v)));
      }}
    >
      <div className={cx('relative h-[3px] w-full overflow-hidden rounded-full bg-white/10', trackClassName)}>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, var(--glow-s), var(--glow-p))', ...fillStyle }}
        />
      </div>
      <div
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 rounded-full bg-ink opacity-0 shadow-[0_0_12px_var(--glow-p)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300',
        checked ? 'bg-[color-mix(in_srgb,var(--glow-p)_70%,black)] shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]' : 'bg-white/10 shadow-[inset_0_1px_2px_rgb(0_0_0/0.4)]',
      )}
    >
      <span
        className={cx(
          // left-0: without it the knob starts from the button's centred content position, and the
          // slide pushes it outside the track
          'absolute left-0 top-[3px] h-4 w-4 rounded-full bg-ink shadow transition-transform duration-300 ease-out-soft',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, label, className,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  // its own id per control, so the pill only ever slides within this control
  const pill = useId();
  return (
    <HoverLensGroup role="radiogroup" aria-label={label} className={cx('flex rounded-full bg-white/[0.04] p-[3px] ring-1 ring-line', className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'liquid-hover relative flex-1 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-[var(--dur-base)]',
            value === o.id ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {value === o.id && (
            <motion.span
              layoutId={`seg-${pill}`}
              aria-hidden
              className="liquid-pill absolute inset-[-1px] rounded-full"
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </HoverLensGroup>
  );
}

/** Album art with a graceful glow-gradient placeholder when missing or broken. */
export function Artwork({ src, alt, className, rounded = 'rounded-lg', eager }: { src?: string; alt: string; className?: string; rounded?: string; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div className={cx('relative overflow-hidden bg-white/[0.04]', rounded, className)}>
      {show ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(120% 120% at 15% 100%, color-mix(in srgb, var(--glow-p) 50%, transparent), transparent 60%), radial-gradient(110% 110% at 100% 0%, color-mix(in srgb, var(--glow-s) 42%, transparent), transparent 55%), #0b0b0e',
          }}
        />
      )}
    </div>
  );
}
