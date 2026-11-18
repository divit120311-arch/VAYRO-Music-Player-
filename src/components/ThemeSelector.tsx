import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronUp } from 'lucide-react';
import { MODES, MODE_BY_ID } from '../config/lighting';
import { setMode, updateSettings } from '../state/settings';
import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from '../utils/colorUtils';
import { useSettings } from '../hooks/useAudioPlayer';
import type { LightingMode } from '../types/lighting';
import { cx } from './ui';
import { HoverLensGroup } from './HoverLens';

export function modeSwatch(id: LightingMode, primary?: string, secondary?: string) {
  const m = MODE_BY_ID[id];
  if (id === 'rainbow') return 'conic-gradient(from 200deg, #ff3b3b, #ffb23b, #c8ff3b, #3bffb0, #3bb5ff, #8a3bff, #ff3bb5, #ff3b3b)';
  if (id === 'reactive') return 'linear-gradient(135deg, #ff5a1f, #ffcf3d 35%, #3dc8ff 70%, #7a4dff)';
  return `linear-gradient(135deg, ${primary ?? m.primary}, ${secondary ?? m.secondary})`;
}

/**
 * The ten modes are each a colour AND a way of moving; the names only say the colour. So the picker
 * groups them by what the light DOES, and says it in plain words under each name.
 */
const GROUPS: { title: string; note: string; modes: LightingMode[] }[] = [
  { title: 'Calm', note: 'Slow and soft, good for relaxing', modes: ['amber', 'purpleDream', 'cinematic', 'rainbow'] },
  { title: 'Moving', note: 'Light travels around the screen', modes: ['neonPink', 'cyberBlue'] },
  { title: 'Reacts to the music', note: 'Pulses and changes with the song', modes: ['bassPulse', 'bloodRed', 'reactive', 'spectrum'] },
];

const HINT: Record<LightingMode, string> = {
  amber: 'Warm orange glow, slowly drifting',
  purpleDream: 'Soft violet waves',
  cinematic: 'Dim and calm, takes its colours from the album cover',
  rainbow: 'Every colour flowing around the screen',
  neonPink: 'Pink light sweeping along the edges',
  cyberBlue: 'Blue streaks racing around the screen',
  bassPulse: 'Flashes on every bass hit',
  bloodRed: 'Red heartbeat on every drum kick',
  reactive: 'Colour and brightness follow the music',
  spectrum: 'Bass along the bottom, mids on the sides, highs on top',
};

/** The lighting modes, grouped by behaviour, each with its swatch and a plain description. */
export function ModeGrid({ onPick }: { onPick?: () => void }) {
  const mode = useSettings((s) => s.mode);
  return (
    <div role="radiogroup" aria-label="Lighting mode" className="flex flex-col gap-3">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="px-2 pb-1 text-[11.5px] font-semibold text-ink-2">
            {g.title} <span className="font-normal text-ink-3">· {g.note}</span>
          </p>
          <HoverLensGroup className="grid grid-cols-2 gap-1" radius={12}>
            {g.modes.map((id) => {
              const m = MODE_BY_ID[id];
              const on = mode === id;
              const key = (MODES.findIndex((x) => x.id === id) + 1) % 10;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  title={`${HINT[id]} (shortcut: ${key})`}
                  onClick={() => {
                    setMode(id);
                    onPick?.();
                  }}
                  className={cx(
                    'group flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
                    on ? 'liquid-pill' : 'liquid-hover',
                  )}
                >
                  <span
                    className="mt-[1px] h-5 w-5 shrink-0 rounded-full ring-1 ring-white/10"
                    style={{ background: modeSwatch(id), boxShadow: on ? `0 0 14px ${m.primary}` : undefined }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cx('flex items-center gap-1 text-[12.5px] font-medium', on ? 'text-ink' : 'text-ink-2')}>
                      <span className="truncate">{m.name}</span>
                      {on && <Check size={12} className="shrink-0 text-ink-2" />}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{HINT[id]}</span>
                  </span>
                </button>
              );
            })}
          </HoverLensGroup>
        </div>
      ))}
    </div>
  );
}

// ---- colours: the light and the lyric text, chosen separately ------------------------------
const LIGHT_SWATCHES = ['#ff8a1f', '#ff2d55', '#ff2d95', '#a03dff', '#2b6bff', '#1fb8ff', '#19e3b1', '#7dff5a', '#ffd23f', '#ffffff'];
const TEXT_SWATCHES = ['#ffd27a', '#ff8a1f', '#ff5fb4', '#9b7bff', '#5ec8ff', '#7dffb0'];

/** a second shade for the light's gradient: a little darker and slightly hue-shifted */
function companion(hex: string) {
  const [h, sat, l] = rgbToHsl(hexToRgb(hex));
  if (sat < 0.08) return rgbToHex(hslToRgb(h, sat, Math.max(0.55, l * 0.8))); // white/grey stays neutral
  return rgbToHex(hslToRgb(h - 0.04, Math.min(1, sat * 1.05), Math.max(0.22, l * 0.72)));
}

function Dot({ c, on, label, onClick, disabled }: { c: string; on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx('h-6 w-6 shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-transparent transition-transform enabled:hover:scale-110 disabled:opacity-30', on ? 'ring-ink' : 'ring-white/10')}
      style={{ background: c }}
    />
  );
}

function Chip({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cx('h-7 shrink-0 rounded-full px-2.5 text-[11.5px] ring-1 disabled:opacity-30', on ? 'bg-white/[0.1] text-ink ring-line-2' : 'text-ink-3 ring-line enabled:hover:text-ink-2')}
    >
      {children}
    </button>
  );
}

const RAINBOW = 'conic-gradient(#ff3b3b, #ffd23f, #7dff5a, #1fb8ff, #a03dff, #ff2d95, #ff3b3b)';

function AnyColour({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-full ring-2 ring-white/10" title="Any colour" style={{ background: RAINBOW }}>
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
    </label>
  );
}

/** The light's colour: from the album art, a swatch, or any colour (the second shade follows). */
export function LightColourRow({ showSecond = false }: { showSecond?: boolean }) {
  const mode = useSettings((s) => s.mode);
  const primary = useSettings((s) => s.primary);
  const secondary = useSettings((s) => s.secondary);
  const matchArtwork = useSettings((s) => s.matchArtwork);
  const own = MODE_BY_ID[mode].usesPalette;
  const cinematic = mode === 'cinematic';
  const lightAuto = matchArtwork || cinematic;
  const pickLight = (c: string) => updateSettings({ primary: c, secondary: companion(c), matchArtwork: false });
  if (!own) {
    return <p className="text-[11.5px] leading-snug text-ink-3">{MODE_BY_ID[mode].name} makes its own colours from the music. Pick a Calm or Moving mode to choose a light colour.</p>;
  }
  if (cinematic) {
    return <p className="text-[11.5px] leading-snug text-ink-3">Cinematic Ambient always takes its colours from the album cover. Pick another mode to choose a light colour.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={lightAuto} onClick={() => updateSettings({ matchArtwork: true })}>From album art</Chip>
        {LIGHT_SWATCHES.map((c) => (
          <Dot key={c} c={c} label={`Light ${c}`} on={!lightAuto && primary.toLowerCase() === c} onClick={() => pickLight(c)} />
        ))}
        <AnyColour label="Custom light colour" value={primary} onChange={pickLight} />
      </div>
      {showSecond && !lightAuto && (
        <label className="flex items-center gap-2 text-[11.5px] text-ink-3">
          <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15" style={{ background: secondary }}>
            <input type="color" aria-label="Second light colour" value={secondary} onChange={(e) => updateSettings({ secondary: e.target.value, matchArtwork: false })} className="absolute inset-0 cursor-pointer opacity-0" />
          </span>
          Second colour (the gradient blends into this; set automatically when you pick a colour)
        </label>
      )}
    </div>
  );
}

/** The lyrics' colour, independent of the light. */
export function TextColourRow({ showStrength = false }: { showStrength?: boolean }) {
  const highlight = useSettings((s) => s.lyricsHighlight);
  const tint = useSettings((s) => s.lyricsTint);
  const textSame = !highlight && tint > 0;
  const textWhite = !highlight && tint === 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip on={textSame} onClick={() => updateSettings({ lyricsHighlight: '', lyricsTint: tint > 0 && tint < 1 ? tint : 0.4 })}>Same as light</Chip>
        <Chip on={textWhite} onClick={() => updateSettings({ lyricsHighlight: '', lyricsTint: 0 })}>White</Chip>
        {TEXT_SWATCHES.map((c) => (
          <Dot key={c} c={c} label={`Text ${c}`} on={highlight.toLowerCase() === c} onClick={() => updateSettings({ lyricsHighlight: c, lyricsTint: 1 })} />
        ))}
        <AnyColour label="Custom text colour" value={highlight || '#ffd27a'} onChange={(c) => updateSettings({ lyricsHighlight: c, lyricsTint: 1 })} />
      </div>
      {showStrength && textSame && (
        <label className="flex items-center gap-3 text-[11.5px] text-ink-3">
          <span className="shrink-0">Colour strength</span>
          <input
            type="range"
            aria-label="How strongly the lyrics take the light colour"
            min={0.05}
            max={1}
            step={0.05}
            value={tint}
            onChange={(e) => updateSettings({ lyricsTint: Number(e.target.value) })}
            className="flex-1 accent-[var(--glow-p)]"
          />
          <span className="tabular w-9 text-right font-mono">{Math.round(tint * 100)}%</span>
        </label>
      )}
    </div>
  );
}

/** "Light colour" and "Text colour": two independent choices. */
export function ColourControls() {
  return (
    <div className="flex flex-col gap-3 px-2">
      <div>
        <p className="pb-1.5 text-[11.5px] font-semibold text-ink-2">
          Light colour <span className="font-normal text-ink-3">· the glow around your screen</span>
        </p>
        <LightColourRow />
      </div>
      <div>
        <p className="pb-1.5 text-[11.5px] font-semibold text-ink-2">
          Text colour <span className="font-normal text-ink-3">· the lyrics</span>
        </p>
        <TextColourRow />
      </div>
    </div>
  );
}

/** Compact mode selector in the control bar: current mode + popover grid. */
export function ThemeSelector() {
  const mode = useSettings((s) => s.mode);
  const primary = useSettings((s) => s.primary);
  const secondary = useSettings((s) => s.secondary);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-full pl-1.5 pr-2.5 text-[12px] font-medium text-ink-2 ring-1 ring-line transition-colors hover:bg-white/[0.05] hover:text-ink"
        title="Lighting mode"
      >
        <span className="h-6 w-6 rounded-full ring-1 ring-white/10" style={{ background: modeSwatch(mode, primary, secondary) }} />
        <span className="max-w-[118px] truncate max-lg:hidden">{MODE_BY_ID[mode].name}</span>
        <ChevronUp size={13} className={cx('transition-transform', !open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass scroll-quiet absolute bottom-[calc(100%+14px)] right-0 max-h-[calc(100vh-150px)] w-[440px] max-w-[calc(100vw-32px)] origin-bottom-right overflow-y-auto rounded-2xl p-2.5"
          >
            <p className="px-2 pb-0.5 pt-1 text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink-3">Lighting mode</p>
            <p className="px-2 pb-2.5 text-[11px] text-ink-3">Pick how the light moves, then its colour and the lyrics’ colour. More in Settings (S).</p>
            <ModeGrid />
            <div className="my-3 border-t border-line" />
            <ColourControls />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
