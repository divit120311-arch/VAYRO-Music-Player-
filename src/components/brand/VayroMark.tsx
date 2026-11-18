import { useId, type CSSProperties } from 'react';

/**
 * Vayro's brand marks, drawn as vectors from the brand board: the silver ribbon "V" symbol and the
 * monoline "VΛYRO" wordmark (the A has no crossbar).
 */

/** the ribbon V (128 × 50): one shape, a silver sweep, the fold shaded underneath, a sheen on top */
export const V_PATH = 'M0 0 C18 -0.5 30 0 40 8 C52 17 60 28 69 32 C82 26 100 6 128 0 C104 18 84 49 67 49 C52 47 42 40 34 31 C24 20 10 5 0 0 Z';

export function VayroSymbol({ className, style, mono }: { className?: string; style?: CSSProperties; mono?: boolean }) {
  const id = useId().replace(/:/g, '');
  if (mono) {
    return (
      <svg viewBox="0 -1 128 52" className={className} style={style} aria-hidden fill="currentColor">
        <path d={V_PATH} />
      </svg>
    );
  }
  return (
    <svg viewBox="0 -1 128 52" className={className} style={style} aria-hidden>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f7f7f7" />
          <stop offset=".3" stopColor="#c9c9c9" />
          <stop offset=".5" stopColor="#8d8d8d" />
          <stop offset=".62" stopColor="#d4d4d4" />
          <stop offset=".8" stopColor="#f6f6f6" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <radialGradient id={`${id}f`} cx="0.53" cy="1" r="0.42" gradientTransform="translate(0.53 1) scale(1 1.7) translate(-0.53 -1)">
          <stop offset="0" stopColor="#000" stopOpacity=".62" />
          <stop offset=".55" stopColor="#000" stopOpacity=".22" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={V_PATH} fill={`url(#${id}g)`} />
      <path d={V_PATH} fill={`url(#${id}f)`} />
      <path d={V_PATH} fill={`url(#${id}s)`} />
    </svg>
  );
}

/** monoline wordmark, in the current text colour (135 × 20 units) */
export function VayroWordmark({ className, style, weight = 2.4 }: { className?: string; style?: CSSProperties; weight?: number }) {
  return (
    <svg
      viewBox="-1.5 -1.5 138 23"
      className={className}
      style={style}
      role="img"
      aria-label="Vayro"
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinejoin="miter"
      strokeMiterlimit={10}
    >
      <path d="M0 0 L9.5 20 L19 0" />
      <path d="M30 20 L39.5 0 L49 20" />
      <path d="M60 0 L69 10 L78 0 M69 10 V20" />
      <path d="M89 20 V0 H97 A5.5 5.5 0 0 1 97 11 H89 M96 11 L103 20" />
      <circle cx="124.5" cy="10" r="10" />
    </svg>
  );
}
