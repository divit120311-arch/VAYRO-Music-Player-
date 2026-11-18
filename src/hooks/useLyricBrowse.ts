import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { LyricLine } from '../types/lyrics';

/**
 * Manual lyric browsing. Auto-follow stops the moment the listener scrolls (wheel / trackpad) or
 * drags (touch) over the lyrics, and steps through the lines instead; after `resumeSec` with no
 * interaction (or on "Back to live") it hands control back to the playback clock.
 * Returns `line: null` while following the music.
 */
const WHEEL_STEP = 70; // px of wheel travel per line
const DRAG_STEP = 46; // px of finger travel per line

export function useLyricBrowse(lines: LyricLine[], liveLine: number, resumeSec: number, enabled: boolean) {
  const [line, setLine] = useState<number | null>(null);
  const acc = useRef(0);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cur = useRef<number | null>(null);
  cur.current = line;

  // only lines with words are browse stops
  const stops = useRef<number[]>([]);
  stops.current = lines.map((_, i) => i).filter((i) => lines[i].text.trim());

  const resume = useCallback(() => {
    window.clearTimeout(timer.current);
    acc.current = 0;
    setLine(null);
  }, []);

  const arm = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(resume, Math.max(1, resumeSec) * 1000);
  }, [resume, resumeSec]);

  const step = useCallback(
    (dir: number) => {
      const s = stops.current;
      if (!s.length) return;
      const from = cur.current ?? Math.max(0, liveLine);
      let p = s.findIndex((i) => i >= from);
      if (p < 0) p = s.length - 1;
      if (cur.current === null && s[p] !== from && dir < 0) p += 1; // live line is a gap: count from the next stop
      const n = s[Math.min(s.length - 1, Math.max(0, p + dir))];
      cur.current = n; // several steps can land before React re-renders (one big wheel event)
      setLine(n);
      arm();
    },
    [liveLine, arm],
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);
  // a new song: follow it
  useEffect(resume, [lines, resume]);

  const onWheel = (e: WheelEvent) => {
    if (!enabled || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    acc.current += e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    while (Math.abs(acc.current) >= WHEEL_STEP) {
      const d = Math.sign(acc.current);
      acc.current -= d * WHEEL_STEP;
      step(d);
    }
    if (cur.current !== null) arm();
  };
  const onPointerDown = (e: PointerEvent) => {
    if (!enabled || e.pointerType === 'mouse') return;
    drag.current = { y: e.clientY, id: e.pointerId };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = d.y - e.clientY;
    if (Math.abs(dy) >= DRAG_STEP) {
      d.y = e.clientY;
      step(Math.sign(dy));
    }
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return { line, resume, handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}
