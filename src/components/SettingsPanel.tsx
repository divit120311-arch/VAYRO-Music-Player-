import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Maximize2, RotateCcw, X } from 'lucide-react';
import { LightColourRow, TextColourRow } from './ThemeSelector';
import { nowPlayingDiagnostics, nowPlayingStore, toggleNowPlaying } from '../state/nowPlaying';
import { lyricsStore } from '../state/lyrics';
import { LYRIC_STYLES } from './lyrics/LyricsView';
import { LyricsPreview } from './lyrics/LyricsPreview';
import { TranscribeDiagnostics } from './lyrics/TranscribeDiagnostics';
import { toggleImmersive } from '../hooks/useFullscreen';
import { useStore } from '../store';
import { qualityStore } from '../state/quality';
import { PRESETS, VISUALIZERS, MODE_BY_ID } from '../config/lighting';
import { applyPreset, resetSettings, updateSettings } from '../state/settings';
import { closeSettings, uiStore } from '../state/ui';
import { usePlayer, useSettings } from '../hooks/useAudioPlayer';
import type { EdgeLayout, Edges, LightingSettings, LyricsAlign, LyricsPosition, Reactivity } from '../types/lighting';
import type { LyricsStyle } from '../types/lyrics';
import { IconButton, Segmented, Slider, Toggle, cx } from './ui';
import { disconnectSpotify, redirectUri, spotifyStore, startSpotifyConnect } from '../services/spotifyAuth';

// =============================================================================================
// Settings, kept short on purpose:
//   Presets   — one grid (the six reference looks + classics) with a live preview
//   Lyrics    — on/off, style, size, album art, clock, where lyrics come from
//   Light     — colour, brightness, glow, how it reacts
//   More      — everything else, collapsed; fine-tuning only appears for styles that use it
// Controls that live elsewhere are not repeated here: view switcher (stage), late-night (header),
// lighting mode (player bar), sync offset (lyrics toolbar and [ ] keys).
// =============================================================================================

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4 first:border-t-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-ink-3">{title}</h3>
        {aside}
      </div>
      <div className="flex flex-col gap-3.5">{children}</div>
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">{title}</p>
      {children}
    </div>
  );
}

/** visual quality: Auto follows this computer; the fixed levels are for "I know my machine" */
function QualityRow() {
  const pref = useSettings((x) => x.quality);
  const q = useStore(qualityStore, (x) => x);
  const NAMES = { ultra: 'Ultra', balanced: 'Balanced', performance: 'Performance' } as const;
  const hint =
    pref === 'auto'
      ? `Now: ${NAMES[q.level]}${q.level !== q.ceiling ? ` (eased down from ${NAMES[q.ceiling]} to keep things smooth)` : ''}. Vayro watches how smoothly this computer draws and adjusts by itself.`
      : pref === 'ultra'
        ? 'Every effect at full quality: liquid-glass refraction, sharp 3D hero, 60 fps light.'
        : pref === 'balanced'
          ? 'The same look, lighter: the light idles at 30 fps when nothing plays, the 3D hero renders a little softer.'
          : 'For older or low-end PCs: lighter glass blur, a drawn (not 3D) hero, light at 30 fps. Lyrics stay exactly in time.';
  return (
    <Row label="Visual quality">
      <Segmented<'auto' | 'ultra' | 'balanced' | 'performance'>
        label="Visual quality"
        value={pref}
        onChange={(v) => updateSettings({ quality: v })}
        options={[
          { id: 'auto', label: 'Auto' },
          { id: 'ultra', label: 'Ultra' },
          { id: 'balanced', label: 'Balanced' },
          { id: 'performance', label: 'Performance' },
        ]}
      />
      <p className="mt-1 text-[11px] leading-snug text-ink-3">{hint}</p>
    </Row>
  );
}

function Row({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12.5px]">
        <span className="text-ink-2">{label}</span>
        {value && <span className="tabular font-mono text-[11px] text-ink-3">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function SliderRow({ k, label, min, max, step, fmt }: { k: keyof LightingSettings; label: string; min: number; max: number; step: number; fmt: (v: number) => string }) {
  const v = useSettings((s) => s[k] as number);
  return (
    <Row label={label} value={fmt(v)}>
      <Slider label={label} value={v} min={min} max={max} step={step} onChange={(x) => updateSettings({ [k]: x })} format={fmt} />
    </Row>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mult = (v: number) => `${v.toFixed(2)}×`;
const px = (v: number) => `${Math.round(v)} px`;

type BoolKey = 'preferFullSongs' | 'lyricsFisheye' | 'notch' | 'showClock' | 'showArtwork' | 'onlineLyrics' | 'transcribeUploads' | 'wordHighlight' | 'showTrackInfo' | 'transcribeEaseLighting';
function ToggleRow({ k, label, hint }: { k: BoolKey; label: string; hint?: string }) {
  const v = useSettings((s) => s[k]);
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12.5px] text-ink-2">{label}</p>
        {hint && <p className="text-[11px] leading-snug text-ink-3">{hint}</p>}
      </div>
      <Toggle label={label} checked={v} onChange={(x) => updateSettings({ [k]: x })} />
    </div>
  );
}

const SRC_ROW = 'flex items-start justify-between gap-3 rounded-xl bg-white/[0.025] px-3 py-2.5 ring-1 ring-line';
function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'off'; children: ReactNode }) {
  return (
    <span className={cx('shrink-0 rounded-full px-2 py-[2px] text-[10.5px] ring-1', tone === 'ok' ? 'text-emerald-200/90 ring-emerald-300/25' : tone === 'warn' ? 'text-amber-200/90 ring-amber-300/25' : 'text-ink-3 ring-line')}>
      {children}
    </span>
  );
}

/** Now Playing mode: follow the Spotify app (or any music app) on this computer */
/** Sync lyrics, in detail: what's being read off the Spotify tab and how closely it's followed */
function SyncDetails() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);
  const d = nowPlayingDiagnostics();
  const ly = lyricsStore.getState();
  const fmt = (s: number | null) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
  const rows: [string, string][] = d
    ? [
        ['Spotify player bar', d.found ? 'found' : 'looking for it…'],
        ['Song read', d.title ? `${d.title}${d.artist ? ' — ' + d.artist : ' (artist not read yet)'}` : '—'],
        ['Spotify shows', `${fmt(d.shown)} of ${fmt(d.total || null)}`],
        ['Vayro is at', d.position == null ? '—' : `${d.position.toFixed(2)} s · ${d.playing ? 'playing' : 'paused'}`],
        ['Timing precision', `± ${(d.uncertainty / 2).toFixed(2)} s`],
        ['Last correction', `${d.lastCorrection >= 0 ? '+' : ''}${d.lastCorrection.toFixed(2)} s`],
        ['Readings', `${d.readsPerSecond.toFixed(1)} / s · ${Math.round(d.readingMsPerSecond)} ms of reading per second`],
        ['Lyrics', ly.status === 'ready' && ly.doc ? (ly.doc.kind === 'plain' ? 'not time-synced' : ly.doc.hasWordSync ? 'word-synced' : 'line-synced') + (ly.doc.attribution ? ` · ${ly.doc.attribution}` : '') : ly.status],
      ]
    : [['Status', 'Not following a Spotify tab (Sync lyrics is off, or runs on this computer’s server).']];
  return (
    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 rounded-lg bg-white/[0.03] p-2 text-[11px] leading-snug">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className="min-w-0 truncate text-ink-2" title={v}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function NowPlayingRow() {
  const [details, setDetails] = useState(false);
  const np = useStore(nowPlayingStore, (s) => s);
  const on = np.status !== 'off' && np.status !== 'unsupported';
  const [label, tone]: [string, 'ok' | 'warn' | 'off'] =
    np.status === 'following' ? [`Following ${np.app ?? 'app'}`, 'ok'] : np.status === 'unsupported' ? ['Not available', 'off'] : np.status === 'error' ? ['Error', 'warn'] : on ? ['Waiting for a song', 'warn'] : ['Off', 'off'];
  return (
    <div className={SRC_ROW} data-testid="source-nowplaying">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink-2">Now Playing</p>
        <p className="text-[11px] leading-snug text-ink-3">
          Full songs with synced lyrics: play a song on Spotify (free accounts too) in another tab or the Spotify app, start this, and share that tab or window when your browser asks. Vayro reads the song and its time from Spotify’s player bar, on this computer only.
          {np.message && <span className="block text-amber-200/80">{np.message}</span>}
        </p>
        <div className="mt-2">
          <button type="button" onClick={toggleNowPlaying} className={cx('h-7 rounded-full px-3 text-[11.5px] ring-1', on ? 'text-ink-2 ring-line hover:text-ink' : 'bg-ink font-semibold text-black ring-transparent')}>
            {on ? 'Stop following' : 'Start Now Playing'}
          </button>
          <button type="button" onClick={() => setDetails((v) => !v)} aria-expanded={details} className="ml-2 h-7 rounded-full px-3 text-[11.5px] text-ink-3 ring-1 ring-line hover:text-ink">
            {details ? 'Hide details' : 'Details'}
          </button>
          {details && <SyncDetails />}
        </div>
      </div>
      <Pill tone={tone}>{label}</Pill>
    </div>
  );
}

/** which full-length sources are available, and how to connect them */
function FullSongs() {
  const sp = useStore(spotifyStore, (s) => s);
  const spLabel: Record<typeof sp.status, [string, 'ok' | 'warn' | 'off']> = {
    'not-configured': ['Not set up', 'off'],
    disconnected: ['Not connected', 'off'],
    connecting: ['Connecting…', 'warn'],
    connected: ['Connected · Premium', 'ok'],
    'premium-required': ['Premium required', 'warn'],
    expired: ['Sign-in expired', 'warn'],
    error: ['Error', 'warn'],
  };
  const [label, tone] = spLabel[sp.status];
  return (
    <div className="flex flex-col gap-2.5">
      <ToggleRow k="preferFullSongs" label="Play full songs when available" hint="Library songs use your connected Spotify Premium first; otherwise Apple's 30-second preview, all inside Vayro's own player" />
      <NowPlayingRow />
      <div className={SRC_ROW} data-testid="source-spotify">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-2">Spotify</p>
          <p className="text-[11px] leading-snug text-ink-3">
            {sp.status === 'not-configured'
              ? `Full tracks with Spotify Premium. Needs a Spotify app: add SPOTIFY_CLIENT_ID to server/.env and the redirect URI ${redirectUri()} in the Spotify dashboard.`
              : sp.status === 'connected'
                ? `Signed in as ${sp.user?.name}. Lyrics are off during Spotify playback (Spotify’s terms).`
                : sp.status === 'premium-required'
                  ? `Signed in as ${sp.user?.name} (${sp.user?.product}). Spotify only streams full tracks to Premium accounts.`
                  : 'Full tracks with Spotify Premium. You sign in on Spotify; Vayro never sees your password.'}
            {sp.error && <span className="block text-amber-200/80">{sp.error}</span>}
          </p>
          {sp.status !== 'not-configured' && (
            <div className="mt-2 flex gap-1.5">
              {sp.status === 'connected' || sp.status === 'premium-required' ? (
                <button type="button" onClick={disconnectSpotify} className="h-7 rounded-full px-3 text-[11.5px] text-ink-2 ring-1 ring-line hover:text-ink">
                  Disconnect
                </button>
              ) : (
                <button type="button" onClick={() => void startSpotifyConnect()} className="h-7 rounded-full bg-[#1ed760] px-3 text-[11.5px] font-semibold text-black">
                  Connect Spotify
                </button>
              )}
            </div>
          )}
        </div>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <div className={SRC_ROW} data-testid="source-apple">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-ink-2">Apple Music</p>
          <p className="text-[11px] leading-snug text-ink-3">30-second previews only. Full playback (MusicKit) needs a paid Apple Developer membership to sign tokens, plus an Apple Music subscription.</p>
        </div>
        <Pill tone="off">Previews</Pill>
      </div>
    </div>
  );
}

/** Whisper language codes offered for transcription ('auto' = let the model detect it) */
const TRANSCRIBE_LANGUAGES: [string, string][] = [
  ['auto', 'Detect automatically'],
  ['hi', 'Hindi (हिन्दी)'],
  ['en', 'English'],
  ['pa', 'Punjabi (ਪੰਜਾਬੀ)'],
  ['ur', 'Urdu (اردو)'],
  ['bn', 'Bengali (বাংলা)'],
  ['ta', 'Tamil (தமிழ்)'],
  ['te', 'Telugu (తెలుగు)'],
  ['mr', 'Marathi (मराठी)'],
  ['gu', 'Gujarati (ગુજરાતી)'],
  ['kn', 'Kannada (ಕನ್ನಡ)'],
  ['ml', 'Malayalam (മലയാളം)'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['pt', 'Portuguese'],
  ['ko', 'Korean'],
  ['ja', 'Japanese'],
  ['ar', 'Arabic'],
];

/** languages the fast model handles poorly: picking one switches listening quality to Accurate */
const PREFER_ACCURATE = new Set(['pa', 'hi', 'ur', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml']);

const SELECT = 'h-8 w-full cursor-pointer rounded-lg bg-white/[0.04] px-2 text-[12.5px] text-ink outline-none ring-1 ring-line';

/** One place for presets: the six reference looks (with a live preview) and the classic lights. */
function Presets() {
  const lyricsStyle = useSettings((s) => s.lyricsStyle);
  const preset = useSettings((s) => s.preset);
  const looks = PRESETS.filter((p) => p.group === 'reference');
  const classics = PRESETS.filter((p) => p.group !== 'reference');
  const [hover, setHover] = useState<string | null>(null);
  const shown = looks.find((p) => p.id === (hover ?? preset));
  const look = shown
    ? { primary: shown.settings.primary ?? '#ff8a1f', secondary: shown.settings.secondary ?? '#ff4b12', artwork: shown.settings.lyricsArtwork === 'clear', clock: !!shown.settings.showClock }
    : undefined;
  return (
    <div className="flex flex-col gap-3">
      <LyricsPreview style={(shown?.settings.lyricsStyle as typeof lyricsStyle) ?? lyricsStyle} look={look} />
      <div className="grid grid-cols-2 gap-1.5" onMouseLeave={() => setHover(null)}>
        {looks.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => applyPreset(p.id)}
            onMouseEnter={() => setHover(p.id)}
            onFocus={() => setHover(p.id)}
            title={p.blurb}
            className={cx('flex items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors', preset === p.id ? 'bg-white/[0.08] ring-1 ring-line-2' : 'bg-white/[0.025] hover:bg-white/[0.05]')}
          >
            <span className="h-3 w-3 flex-none rounded-full" style={{ background: `linear-gradient(135deg, ${p.settings.primary}, ${p.settings.secondary})`, boxShadow: `0 0 8px ${p.settings.primary}` }} />
            <span className="text-[12.5px] font-medium text-ink">{p.name}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {classics.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={preset === p.id}
            onClick={() => applyPreset(p.id)}
            title={p.blurb}
            className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] transition-colors', preset === p.id ? 'bg-white/[0.1] text-ink ring-1 ring-line-2' : 'text-ink-3 ring-1 ring-line hover:text-ink-2')}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: p.settings.primary }} />
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function EdgePicker() {
  const edges = useSettings((s) => s.edges);
  const flip = (e: keyof Edges) => updateSettings({ edges: { ...edges, [e]: !edges[e] } });
  const side = (e: keyof Edges, cls: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={edges[e]}
      aria-label={`${e} edge`}
      onClick={() => flip(e)}
      className={cx('absolute flex items-center justify-center', cls)}
    >
      <span
        className={cx('rounded-full transition-all duration-300', e === 'top' || e === 'bottom' ? 'h-[3px] w-full' : 'h-full w-[3px]')}
        style={{ background: edges[e] ? 'var(--glow-p)' : 'rgba(255,255,255,0.1)', boxShadow: edges[e] ? '0 0 10px var(--glow-p)' : 'none' }}
      />
    </button>
  );
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[70px] w-[112px] shrink-0 rounded-[8px] bg-black/50 ring-1 ring-line">
        {side('top', 'inset-x-3 -top-[6px] h-3')}
        {side('bottom', 'inset-x-3 -bottom-[6px] h-3')}
        {side('left', 'inset-y-3 -left-[6px] w-3')}
        {side('right', 'inset-y-3 -right-[6px] w-3')}
      </div>
      <p className="text-[11.5px] leading-snug text-ink-3">Click a side of the screen to switch that strip on or off.</p>
    </div>
  );
}

// which fine-tuning a style actually uses (so the panel never shows a control that does nothing)
const LINE_STYLES = new Set<LyricsStyle>(['cinematic', 'scroll', 'focus', 'minimal', 'glow', 'karaoke', 'reveal', 'typewriter']);
const LIST_STYLES = new Set<LyricsStyle>(['scroll', 'focus']);
const STYLE_GROUPS: [string, 'reference' | 'line' | 'word'][] = [
  ['From the reference videos', 'reference'],
  ['Line by line', 'line'],
  ['Word by word', 'word'],
];

export function SettingsPanel() {
  const open = useStore(uiStore, (s) => s.settings);
  const mode = useSettings((s) => s.mode);
  const layout = useSettings((s) => s.layout);
  const visualizer = useSettings((s) => s.visualizer);
  const matchArtwork = useSettings((s) => s.matchArtwork);
  const reactivity = useSettings((s) => s.reactivity);
  const lyricsStyle = useSettings((s) => s.lyricsStyle);
  const lyricsPosition = useSettings((s) => s.lyricsPosition);
  const lyricsEnabled = useSettings((s) => s.lyricsEnabled);
  const lyricsAlign = useSettings((s) => s.lyricsAlign);
  const lyricsArtwork = useSettings((s) => s.lyricsArtwork);
  const motionPref = useSettings((s) => s.motion);
  const lyricsScript = useSettings((s) => s.lyricsScript);
  const transcribeUploads = useSettings((s) => s.transcribeUploads);
  const transcribeLanguage = useSettings((s) => s.transcribeLanguage);
  const transcribeModel = useSettings((s) => s.transcribeModel);
  const palette = usePlayer((s) => s.palette);
  const [more, setMore] = useState(false);
  const usesPalette = MODE_BY_ID[mode].usesPalette;
  const lineStyle = LINE_STYLES.has(lyricsStyle);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Settings"
          className="glass fixed bottom-[164px] right-6 top-[var(--panel-top)] z-30 flex w-[360px] max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-[22px]"
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Settings</h2>
              <p className="text-[11.5px] text-ink-3">Saved automatically on this device</p>
            </div>
            <IconButton label="Close settings" onClick={closeSettings} size="sm">
              <X size={16} />
            </IconButton>
          </div>

          <div className="scroll-quiet flex-1 overflow-y-auto pb-2">
            {/* ---------------------------------------------------------------- presets */}
            <Section title="Presets">
              <Presets />
            </Section>

            <Section title="Full songs">
              <FullSongs />
            </Section>

            {/* ---------------------------------------------------------------- lyrics */}
            <Section
              title="Lyrics"
              aside={<Toggle label="Lyrics on or off" checked={lyricsEnabled} onChange={(v) => updateSettings({ lyricsEnabled: v })} />}
            >
              <Row label="Style">
                <select aria-label="Lyrics style" value={lyricsStyle} onChange={(e) => updateSettings({ lyricsStyle: e.target.value as LyricsStyle })} className={SELECT}>
                  {STYLE_GROUPS.map(([name, g]) => (
                    <optgroup key={g} label={name} className="bg-panel-solid">
                      {LYRIC_STYLES.filter((x) => x.group === g).map((st) => (
                        <option key={st.id} value={st.id} className="bg-panel-solid">
                          {st.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <p className="mt-1 text-[11px] leading-snug text-ink-3">{LYRIC_STYLES.find((x) => x.id === lyricsStyle)?.blurb}</p>
              </Row>
              <SliderRow k="lyricsSize" label="Text size" min={0.6} max={1.6} step={0.05} fmt={pct} />
              <ToggleRow k="lyricsFisheye" label="Fisheye" hint="Bend the lyrics like a lens: the middle swells, the edges curve away" />
              <SliderRow k="lyricsResumeSec" label="Return to the live line after scrolling" min={2} max={15} step={1} fmt={(v) => `${v} s`} />
              <Row label="Album art behind lyrics">
                <Segmented<'off' | 'blurred' | 'clear'>
                  label="Album art behind lyrics"
                  value={lyricsArtwork}
                  onChange={(v) => updateSettings({ lyricsArtwork: v })}
                  options={[
                    { id: 'off', label: 'Off' },
                    { id: 'blurred', label: 'Blurred' },
                    { id: 'clear', label: 'Clear' },
                  ]}
                />
              </Row>
              <ToggleRow k="showClock" label="Clock" hint="Lock-screen clock above the lyrics" />
              <ToggleRow k="onlineLyrics" label="Find lyrics online" hint="Synced lyrics from LRCLIB, a free community database" />
              <ToggleRow k="transcribeUploads" label="Write lyrics for my uploads" hint="When a file has none, listen to it on this computer and build word-timed lyrics" />
            </Section>

            <Section title="Motion">
              <Row label="Animations">
                <Segmented<'system' | 'full' | 'reduced'>
                  label="Animations"
                  value={motionPref}
                  onChange={(v) => updateSettings({ motion: v })}
                  options={[
                    { id: 'system', label: 'Follow system' },
                    { id: 'full', label: 'Full' },
                    { id: 'reduced', label: 'Reduced' },
                  ]}
                />
                <p className="mt-1 text-[11px] leading-snug text-ink-3">
                  {motionPref === 'system'
                    ? 'Uses your computer’s setting. If Windows “Animation effects” is off, Vayro keeps still — choose Full to animate anyway.'
                    : motionPref === 'full'
                      ? 'Everything animates: the flowing glass, hover effects and transitions.'
                      : 'Calm: no automatic motion. The glass still answers your cursor.'}
                </p>
              </Row>
              <QualityRow />
            </Section>

            {/* ---------------------------------------------------------------- light */}
            <Section title="Light">
              <Row label="Light colour">
                <LightColourRow showSecond />
              </Row>
              {(matchArtwork || mode === 'cinematic') && !palette && usesPalette && (
                <p className="-mt-2 text-[11.5px] text-ink-3">This song has no readable cover, so your last chosen colour is used.</p>
              )}
              <SliderRow k="brightness" label="Brightness" min={0.1} max={1.5} step={0.01} fmt={pct} />
              <SliderRow k="glow" label="Glow" min={0} max={1} step={0.01} fmt={pct} />
              <Row label="Reacts to">
                <Segmented<Reactivity>
                  label="Lighting animation"
                  value={reactivity}
                  onChange={(v) => updateSettings({ reactivity: v })}
                  options={[
                    { id: 'music', label: 'The music' },
                    { id: 'ambient', label: 'Slow drift' },
                    { id: 'static', label: 'Nothing' },
                  ]}
                />
              </Row>
            </Section>

            {/* ---------------------------------------------------------------- more */}
            <section className="border-t border-line px-5 py-3">
              <button
                type="button"
                aria-expanded={more}
                onClick={() => setMore((m) => !m)}
                className="flex w-full items-center justify-between py-1 text-[12.5px] font-medium text-ink-2 hover:text-ink"
              >
                More settings
                <ChevronDown size={15} className={cx('transition-transform', more && 'rotate-180')} />
              </button>
              {more && (
                <div className="mt-3 flex flex-col gap-6">
                  <Group title="Lyric text">
                    {!lineStyle && <p className="-mt-1 text-[11px] leading-snug text-ink-3">The reference styles set their own type. Pick a line or word style for alignment, spacing and line count.</p>}
                    <SliderRow k="lyricsSpeed" label="Lyric motion speed" min={0.5} max={2} step={0.05} fmt={mult} />
                    <Row label="Text colour">
                      <TextColourRow showStrength />
                    </Row>
                    <SliderRow k="lyricsGlow" label="Text glow" min={0} max={1} step={0.05} fmt={pct} />
                    {lyricsArtwork !== 'off' && <SliderRow k="lyricsBgOpacity" label="Darken the album art" min={0} max={0.9} step={0.05} fmt={pct} />}
                    {lineStyle && (
                      <>
                        <SliderRow k="lyricsWeight" label="Font weight" min={300} max={900} step={100} fmt={(v) => String(v)} />
                        <SliderRow k="lyricsLineSpacing" label="Line spacing" min={0.8} max={1.6} step={0.05} fmt={mult} />
                        {LIST_STYLES.has(lyricsStyle) && <SliderRow k="lyricsLines" label="Lines shown" min={3} max={9} step={2} fmt={(v) => String(v)} />}
                        <Row label="Alignment">
                          <Segmented<LyricsAlign>
                            label="Lyrics alignment"
                            value={lyricsAlign}
                            onChange={(v) => updateSettings({ lyricsAlign: v })}
                            options={[
                              { id: 'left', label: 'Left' },
                              { id: 'center', label: 'Centre' },
                              { id: 'right', label: 'Right' },
                            ]}
                          />
                        </Row>
                        <Row label="Position">
                          <Segmented<LyricsPosition>
                            label="Lyrics position"
                            value={lyricsPosition}
                            onChange={(v) => updateSettings({ lyricsPosition: v })}
                            options={[
                              { id: 'upper', label: 'Upper' },
                              { id: 'center', label: 'Centre' },
                              { id: 'lower', label: 'Lower' },
                            ]}
                          />
                        </Row>
                        <ToggleRow k="wordHighlight" label="Light up the sung word" hint="Only when the lyrics have real word timing" />
                      </>
                    )}
                    <ToggleRow k="showTrackInfo" label="Title and artist in fullscreen" />
                  </Group>

                  <Group title="Lyric sources">
                    <Row label="Online lyrics script">
                      <Segmented<'any' | 'latin' | 'native'>
                        label="Preferred lyrics script"
                        value={lyricsScript}
                        onChange={(v) => updateSettings({ lyricsScript: v })}
                        options={[
                          { id: 'any', label: 'Best match' },
                          { id: 'latin', label: 'English letters' },
                          { id: 'native', label: 'ਪੰਜਾਬੀ / हिंदी script' },
                        ]}
                      />
                    </Row>
                    {transcribeUploads && (
                      <>
                        <Row label="Song language (for writing lyrics)">
                          <select aria-label="Transcription language" value={transcribeLanguage} onChange={(e) => updateSettings({ transcribeLanguage: e.target.value, ...(PREFER_ACCURATE.has(e.target.value) ? { transcribeModel: 'small' as const } : {}) })} className={SELECT}>
                            {TRANSCRIBE_LANGUAGES.map(([id, name]) => (
                              <option key={id} value={id} className="bg-panel-solid">
                                {name}
                              </option>
                            ))}
                          </select>
                        </Row>
                        <Row label="Listening quality">
                          <Segmented<'base' | 'small'>
                            label="Transcription model"
                            value={transcribeModel}
                            onChange={(v) => updateSettings({ transcribeModel: v })}
                            options={[
                              { id: 'base', label: 'Fast' },
                              { id: 'small', label: 'Accurate (3× slower)' },
                            ]}
                          />
                        </Row>
                        <p className="-mt-1 text-[11px] leading-snug text-ink-3">For Punjabi, Hindi and other non-English songs, set the song’s language: Accurate is switched on for you (the fast model mishears these languages often).</p>
                        <ToggleRow k="transcribeEaseLighting" label="Ease the light while writing" hint="30 fps lighting during transcription, so it finishes sooner" />
                        <details className="rounded-xl bg-white/[0.02] px-3 py-2 ring-1 ring-line">
                          <summary className="cursor-pointer text-[12px] font-medium text-ink-2">Timings</summary>
                          <div className="mt-2">
                            <TranscribeDiagnostics />
                          </div>
                        </details>
                      </>
                    )}
                  </Group>

                  <Group title="Light shape">
                    <SliderRow k="width" label="Strip width" min={1} max={10} step={0.5} fmt={(v) => `${v.toFixed(1)} px`} />
                    <SliderRow k="blur" label="Glow spread" min={8} max={120} step={1} fmt={px} />
                    <Row label="Layout">
                      <Segmented<EdgeLayout>
                        label="Edge layout"
                        value={layout}
                        onChange={(v) => updateSettings({ layout: v })}
                        options={[
                          { id: 'strips', label: 'Strips' },
                          { id: 'corners', label: 'Corners' },
                          { id: 'both', label: 'Both' },
                        ]}
                      />
                    </Row>
                    <Row label="Screen edges">
                      <EdgePicker />
                    </Row>
                    <ToggleRow k="notch" label="Notch" hint="Trace a MacBook-style notch at the top" />
                  </Group>

                  {reactivity === 'music' && (
                    <Group title="Music response">
                      <SliderRow k="sensitivity" label="Sensitivity" min={0.2} max={3} step={0.05} fmt={mult} />
                      <SliderRow k="bassSensitivity" label="Bass" min={0.2} max={3} step={0.05} fmt={mult} />
                      <SliderRow k="smoothing" label="Smoothing" min={0} max={1} step={0.01} fmt={pct} />
                    </Group>
                  )}
                  {reactivity !== 'static' && (
                    <Group title="Light motion">
                      <SliderRow k="animationSpeed" label="Light motion speed" min={0.2} max={3} step={0.05} fmt={mult} />
                      <SliderRow k="colorSpeed" label="Colour change speed" min={0.1} max={3} step={0.05} fmt={mult} />
                    </Group>
                  )}

                  <Group title="Room">
                    <SliderRow k="darkness" label="Background darkness" min={0} max={1} step={0.01} fmt={pct} />
                    <ToggleRow k="showArtwork" label="Album artwork" hint="Cover in fullscreen and the blurred room glow" />
                    <Row label="Visualizer">
                      <div className="flex flex-wrap gap-1.5">
                        {VISUALIZERS.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            aria-pressed={visualizer === v.id}
                            onClick={() => updateSettings({ visualizer: v.id })}
                            className={cx(
                              'rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                              visualizer === v.id ? 'bg-white/[0.1] text-ink ring-1 ring-line-2' : 'text-ink-3 ring-1 ring-line hover:text-ink-2',
                            )}
                          >
                            {v.name}
                          </button>
                        ))}
                      </div>
                    </Row>
                  </Group>

                  <Group title="Keyboard">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11.5px]">
                      {[
                        ['Space', 'Play / pause'],
                        ['← →', 'Seek 5 s'],
                        ['↑ ↓', 'Volume'],
                        ['N / P', 'Next / previous'],
                        ['M', 'Mute'],
                        ['F', 'Immersive fullscreen'],
                        ['V / ⇧V', 'Next / previous view'],
                        ['[ / ]', 'Lyrics later / earlier'],
                        [', / .', 'Previous / next lyric line'],
                        ['1 – 0', 'Lighting modes'],
                        ['S / L', 'Settings / library'],
                      ].map(([k, v]) => (
                        <div key={k} className="contents">
                          <dt className="font-mono text-ink-2">{k}</dt>
                          <dd className="text-ink-3">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </Group>
                </div>
              )}
            </section>
          </div>

          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <button type="button" onClick={() => window.confirm('Reset every setting (lights, colours, lyrics) to the defaults?') && resetSettings()} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-ink">
              <RotateCcw size={13} /> Reset to defaults
            </button>
            <button type="button" onClick={toggleImmersive} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-3 hover:text-ink">
              <Maximize2 size={13} /> Fullscreen
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
