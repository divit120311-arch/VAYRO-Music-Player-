import { useMemo, useRef, type CSSProperties } from 'react';
import { demoLyricsLrc } from '../../services/demoLyrics';
import { parseLrc } from '../../utils/lrc';
import type { LyricsStyle } from '../../types/lyrics';
import { SyncedLyrics } from './LyricsDisplay';

export interface PreviewLook {
  primary: string;
  secondary: string;
  /** show a sample "album art" behind the lyrics (no real covers are bundled) */
  artwork: boolean;
  clock: boolean;
}

/**
 * A small live preview of a lyric style or a whole reference look, using Vayro's own sample
 * lines (written for the demo track) on a looping preview clock. This clock exists ONLY for the
 * preview; real lyrics are always driven by the audio element's playback position.
 */
export function LyricsPreview({ style, look }: { style: LyricsStyle; look?: PreviewLook }) {
  const lines = useMemo(() => parseLrc(demoLyricsLrc()), []);
  const loop = useMemo(() => {
    const spoken = lines.filter((l) => l.text.trim());
    const from = spoken[0]?.t ?? 0;
    const to = spoken[Math.min(5, spoken.length - 1)]?.end ?? from + 12;
    return { from: Math.max(0, from - 0.6), len: Math.max(4, to - from + 0.6) };
  }, [lines]);
  const t0 = useRef(performance.now());
  const time = () => loop.from + (((performance.now() - t0.current) / 1000) % loop.len);
  const vars = (look ? { '--glow-p': look.primary, '--glow-s': look.secondary } : {}) as CSSProperties;
  const now = new Date();
  return (
    <div
      className="relative h-[190px] overflow-hidden rounded-xl bg-black ring-1 ring-line"
      style={{
        ...vars,
        // a thin light frame standing in for the perimeter lighting
        boxShadow: look ? `inset 0 0 0 1.5px ${look.primary}, inset 0 0 18px -4px ${look.primary}` : undefined,
      }}
      aria-label={`Preview of the ${style} lyric style`}
    >
      {look?.artwork && (
        <div
          aria-hidden
          className="absolute inset-[3px] rounded-[10px]"
          style={{
            background: `radial-gradient(120% 90% at 20% 15%, color-mix(in srgb, ${look.secondary} 70%, white) 0%, transparent 55%),
              conic-gradient(from 210deg at 70% 60%, ${look.primary}, color-mix(in srgb, ${look.secondary} 60%, black), ${look.primary})`,
            filter: 'saturate(0.85)',
          }}
        />
      )}
      {look?.clock && (
        <div className="absolute inset-x-0 top-2 text-center leading-none" aria-hidden>
          <p className="text-[8px] font-semibold text-ink-2">{now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
          <p className="text-[22px] text-ink/80" style={{ fontWeight: 250 }}>
            {now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]\.?M\.?$/i, '')}
          </p>
        </div>
      )}
      <div className="absolute inset-0" style={{ fontSize: 10, top: look?.clock ? 26 : 0 }}>
        <SyncedLyrics key={style} lines={lines} style={style} offset={0} size={0.42} position="center" timeSource={time} compact />
      </div>
      <span className="absolute bottom-1.5 left-2 rounded-full bg-black/60 px-2 py-[1px] text-[10px] text-ink-3">
        Preview · sample lines{look?.artwork ? ' · sample art' : ''}
      </span>
    </div>
  );
}
