export type LightingMode =
  | 'amber'
  | 'neonPink'
  | 'purpleDream'
  | 'cyberBlue'
  | 'bloodRed'
  | 'rainbow'
  | 'reactive'
  | 'cinematic'
  | 'bassPulse'
  | 'spectrum';

export type VisualizerStyle = 'none' | 'bars' | 'circular' | 'waveform' | 'particles' | 'equalizer' | 'pulse';

export type EdgeLayout = 'strips' | 'corners' | 'both';

/** mirrors the reference app's "Animation: Music Sync … No Animation" */
export type Reactivity = 'music' | 'ambient' | 'static';

export type StageView = 'artwork' | 'lyrics' | 'visualizer' | 'clock' | 'ambient';

export type LyricsPosition = 'upper' | 'center' | 'lower';
export type LyricsAlign = 'left' | 'center' | 'right';

export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface LightingSettings {
  mode: LightingMode;
  primary: string;
  secondary: string;
  /** overall brightness 0.1–1.5 */
  brightness: number;
  /** bloom strength 0–1 */
  glow: number;
  /** core strip width in CSS px */
  width: number;
  /** bloom radius in CSS px */
  blur: number;
  /** overall audio gain 0.2–3 */
  sensitivity: number;
  /** extra gain for the low band 0.2–3 */
  bassSensitivity: number;
  /** 0 = twitchy, 1 = very smooth */
  smoothing: number;
  /** motion speed multiplier 0.2–3 */
  animationSpeed: number;
  /** how fast colours drift / blend 0.1–3 */
  colorSpeed: number;
  visualizer: VisualizerStyle;
  edges: Edges;
  layout: EdgeLayout;
  /** 0 = charcoal room, 1 = pitch black */
  darkness: number;
  /** borrow colours from the current album artwork */
  matchArtwork: boolean;
  /** last preset applied (cleared on manual tweaks) */
  preset: PresetId | null;
  /** trace a MacBook-style notch at the top centre */
  notch: boolean;
  reactivity: Reactivity;
  /** dim everything and bias the light warm */
  lateNight: boolean;
  /** animation: follow the system's "reduce motion", or always full / always reduced */
  motion: 'system' | 'full' | 'reduced';
  /** visual quality: auto (follow this computer) or a fixed level — see engine/quality.ts */
  quality: 'auto' | 'ultra' | 'balanced' | 'performance';
  /** what the centre stage shows */
  view: StageView;
  lyricsStyle: import('./lyrics').LyricsStyle;
  /** 0.7 – 1.5 */
  lyricsSize: number;
  lyricsPosition: LyricsPosition;
  /** look up lyrics online (LRCLIB) for tracks without local lyrics */
  onlineLyrics: boolean;
  /** transcribe lyrics (with word timing) on this device for uploaded files that have none */
  transcribeUploads: boolean;
  /** master switch for the lyrics feature */
  lyricsEnabled: boolean;
  /** 300 - 900 */
  lyricsWeight: number;
  lyricsAlign: LyricsAlign;
  /** line-height multiplier, 0.8 - 1.6 */
  lyricsLineSpacing: number;
  /** '' = follow the lighting colour, otherwise a hex colour */
  lyricsHighlight: string;
  /** text glow 0 - 1 */
  lyricsGlow: number;
  /** how much the light colour tints the lyric text, 0 (cream) – 1 (fully coloured) */
  lyricsTint: number;
  /** animation speed multiplier 0.5 - 2 */
  lyricsSpeed: number;
  /** darkness of the scrim behind lyrics 0 - 1 */
  lyricsBgOpacity: number;
  /** lines visible in the line-list styles (scroll / focus) */
  lyricsLines: number;
  /** highlight individual words when real word timestamps exist */
  wordHighlight: boolean;
  /** preferred writing system for online lyrics: Hindi in Roman letters vs. देवनागरी, etc. */
  lyricsScript: 'any' | 'latin' | 'native';
  /** show Devanagari lyrics in Roman letters (display-only transliteration, never translation) */
  lyricsRomanize: boolean;
  /** bend the lyrics through a fisheye lens (a bulge distortion of the glyphs) */
  lyricsFisheye: boolean;
  /** seconds of no scrolling before browsed lyrics return to the line being sung */
  lyricsResumeSec: number;
  /** play library songs in full (Spotify) when a source is available, before the preview */
  preferFullSongs: boolean;
  /** spoken language for on-device transcription ('auto' = detect) */
  transcribeLanguage: string;
  /** Whisper size: base (fast) or small (more accurate, esp. non-English; bigger download) */
  transcribeModel: 'base' | 'small';
  /** render the lighting at 30 fps while a transcription runs (frees CPU for the speech model) */
  transcribeEaseLighting: boolean;
  /** title + artist on the fullscreen lyrics screen */
  showTrackInfo: boolean;
  /** album artwork behind the lyrics */
  lyricsArtwork: 'off' | 'blurred' | 'clear';
  /** clock above lyrics / in immersive mode */
  showClock: boolean;
  /** album art in lyrics view + the blurred room wash */
  showArtwork: boolean;
}

export type PresetId =
  | 'lateNight' | 'cyberpunk' | 'warmStudio' | 'sunset' | 'deepSpace' | 'minimalOrange'
  | 'refPinkHaze' | 'refStageAmber' | 'refCobalt' | 'refWarmWhite' | 'refCrimson' | 'refEmberDesk';

export interface ModeInfo {
  id: LightingMode;
  name: string;
  blurb: string;
  primary: string;
  secondary: string;
  /** does this mode read primary/secondary? */
  usesPalette: boolean;
}

export interface Preset {
  id: PresetId;
  name: string;
  blurb: string;
  group: 'reference' | 'classic';
  settings: Partial<LightingSettings>;
}
