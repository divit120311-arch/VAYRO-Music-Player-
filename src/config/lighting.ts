import type { LightingSettings, ModeInfo, Preset, VisualizerStyle } from '../types/lighting';

export const MODES: ModeInfo[] = [
  { id: 'amber', name: 'Amber Glow', blurb: 'Warm pools of light drifting along the edges', primary: '#ff8a1f', secondary: '#ff4b12', usesPalette: true },
  { id: 'neonPink', name: 'Neon Pink', blurb: 'Hot magenta sweeps with a white-hot core', primary: '#ff2d95', secondary: '#c41cff', usesPalette: true },
  { id: 'purpleDream', name: 'Purple Dream', blurb: 'Slow violet tides that breathe with the mids', primary: '#8b3dff', secondary: '#4b2cff', usesPalette: true },
  { id: 'cyberBlue', name: 'Cyber Blue', blurb: 'Electric comets racing the perimeter', primary: '#1fb8ff', secondary: '#2b4bff', usesPalette: true },
  { id: 'bloodRed', name: 'Blood Red', blurb: 'A deep red heartbeat locked to the kick', primary: '#ff1a2d', secondary: '#8a0010', usesPalette: true },
  { id: 'rainbow', name: 'Rainbow Flow', blurb: 'The full spectrum flowing around the screen', primary: '#ff3b3b', secondary: '#3b7bff', usesPalette: false },
  { id: 'reactive', name: 'Music Reactive', blurb: 'Hue follows the timbre, light follows the energy', primary: '#ff6a3d', secondary: '#3dc8ff', usesPalette: false },
  { id: 'cinematic', name: 'Cinematic Ambient', blurb: 'Slow, low and calm — borrows colour from the artwork', primary: '#ff9a52', secondary: '#7a4dff', usesPalette: true },
  { id: 'bassPulse', name: 'Bass Pulse', blurb: 'The room flashes with every low-end hit', primary: '#ff3d6e', secondary: '#ff9a3d', usesPalette: true },
  { id: 'spectrum', name: 'Frequency Spectrum', blurb: 'Bass on the floor, mids on the walls, highs on top', primary: '#ff5a1f', secondary: '#5a4bff', usesPalette: true },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<ModeInfo['id'], ModeInfo>;

export const VISUALIZERS: { id: VisualizerStyle; name: string }[] = [
  { id: 'pulse', name: 'Soft Pulse' },
  { id: 'circular', name: 'Circular' },
  { id: 'bars', name: 'Spectrum Bars' },
  { id: 'waveform', name: 'Waveform' },
  { id: 'particles', name: 'Particles' },
  { id: 'equalizer', name: 'Minimal EQ' },
  { id: 'none', name: 'Off' },
];

export const DEFAULT_SETTINGS: LightingSettings = {
  mode: 'amber',
  primary: MODES[0].primary,
  secondary: MODES[0].secondary,
  brightness: 1,
  glow: 0.85,
  width: 3,
  blur: 52,
  sensitivity: 1.1,
  bassSensitivity: 1.2,
  smoothing: 0.55,
  animationSpeed: 1,
  colorSpeed: 1,
  visualizer: 'pulse',
  edges: { top: true, right: true, bottom: true, left: true },
  layout: 'strips',
  darkness: 0.85,
  // the references take the strip colour from the album art by default
  matchArtwork: true,
  preset: null,
  notch: false,
  reactivity: 'music',
  lateNight: false,
  motion: 'system',
  quality: 'auto',
  view: 'artwork',
  lyricsStyle: 'reel',
  lyricsSize: 1,
  lyricsPosition: 'center',
  onlineLyrics: true,
  transcribeUploads: true,
  lyricsEnabled: true,
  lyricsWeight: 800,
  lyricsAlign: 'center',
  lyricsLineSpacing: 1,
  lyricsHighlight: '',
  lyricsGlow: 0.5,
  lyricsTint: 0.4,
  lyricsSpeed: 1,
  lyricsBgOpacity: 0.35,
  lyricsLines: 5,
  wordHighlight: true,
  lyricsArtwork: 'off',
  showTrackInfo: true,
  // Punjabi/Hindi lyrics in English letters by default: prefer Roman versions online, and show
  // Gurmukhi/Devanagari (e.g. a transcription) in Roman letters
  lyricsScript: 'latin',
  lyricsRomanize: true,
  lyricsFisheye: true,
  lyricsResumeSec: 4,
  preferFullSongs: true,
  transcribeLanguage: 'auto',
  transcribeModel: 'base',
  transcribeEaseLighting: true,
  showClock: true,
  showArtwork: true,
};

export const PRESETS: Preset[] = [
  // ---- the six reference videos, each reproduced as a complete look (see reference-study.md)
  {
    id: 'refEmberDesk', name: 'Orange Typography', group: 'reference', blurb: '“Ambient lighting in your Mac”: orange word reel on black, notch',
    settings: { mode: 'amber', primary: '#ff8a1a', secondary: '#ff4d0f', matchArtwork: false, brightness: 1, glow: 0.85, width: 3, blur: 50, notch: true, view: 'lyrics', lyricsStyle: 'reel', lyricsArtwork: 'off', lyricsBgOpacity: 0.35, lyricsTint: 0.85, showClock: false, visualizer: 'none', darkness: 1 },
  },
  {
    id: 'refPinkHaze', name: 'Pink Artwork', group: 'reference', blurb: '“Can’t stop looking at my screen”: word stack over the album art, pink/violet light',
    settings: { mode: 'neonPink', primary: '#ff4fae', secondary: '#8a3dff', matchArtwork: false, brightness: 1, glow: 0.8, width: 3, blur: 46, notch: true, view: 'lyrics', lyricsStyle: 'kinetic', lyricsArtwork: 'clear', lyricsBgOpacity: 0.3, lyricsTint: 0.4, showClock: true, visualizer: 'none', darkness: 1 },
  },
  {
    id: 'refStageAmber', name: 'Amber Clock', group: 'reference', blurb: '“Peak music setup”: lock-screen clock above the word reel, light follows the art',
    settings: { mode: 'amber', primary: '#ff8a1f', secondary: '#ff4b12', matchArtwork: true, brightness: 0.95, glow: 0.8, width: 3, blur: 50, notch: true, view: 'lyrics', lyricsStyle: 'reel', lyricsArtwork: 'off', lyricsBgOpacity: 0.35, lyricsTint: 0.3, showClock: true, visualizer: 'none', darkness: 0.95 },
  },
  {
    id: 'refCobalt', name: 'Blue Over Art', group: 'reference', blurb: '“Rate the music setup”: white reel straight on full-bleed art, electric blue edge',
    settings: { mode: 'cyberBlue', primary: '#3a5cff', secondary: '#1fb8ff', matchArtwork: false, brightness: 1.05, glow: 0.85, width: 3, blur: 44, notch: false, view: 'lyrics', lyricsStyle: 'overlay', lyricsArtwork: 'clear', lyricsBgOpacity: 0, lyricsTint: 0.4, showClock: false, visualizer: 'none', darkness: 0.9 },
  },
  {
    id: 'refCrimson', name: 'Red Constellation', group: 'reference', blurb: '“The perfect late night setup”: the line as a star chart, thin red edge',
    settings: { mode: 'bloodRed', primary: '#ff2a45', secondary: '#9a0016', matchArtwork: false, brightness: 0.9, glow: 0.75, width: 2.5, blur: 48, notch: true, view: 'lyrics', lyricsStyle: 'floating', lyricsArtwork: 'off', lyricsBgOpacity: 0.35, lyricsTint: 0.4, showClock: false, visualizer: 'none', darkness: 1 },
  },
  {
    id: 'refWarmWhite', name: 'Gold Ring', group: 'reference', blurb: '“Music like this >>”: reel inside a ring over the art, warm yellow light',
    settings: { mode: 'cinematic', primary: '#ffe27a', secondary: '#fff1c4', matchArtwork: false, brightness: 1.1, glow: 0.9, width: 3, blur: 56, notch: false, view: 'lyrics', lyricsStyle: 'ring', lyricsArtwork: 'clear', lyricsBgOpacity: 0.1, lyricsTint: 0.4, showClock: false, visualizer: 'none', darkness: 0.85 },
  },
  // ---- classics
  {
    id: 'lateNight', name: 'Late Night', group: 'classic', blurb: 'Dim pink haze, nothing too loud',
    settings: { matchArtwork: false, mode: 'neonPink', primary: '#ff2d95', secondary: '#7a1cff', brightness: 0.7, glow: 0.65, width: 2, blur: 54, smoothing: 0.75, animationSpeed: 0.7, colorSpeed: 0.6, visualizer: 'pulse', darkness: 0.95, layout: 'strips' },
  },
  {
    id: 'cyberpunk', name: 'Cyberpunk', group: 'classic', blurb: 'Electric blue, magenta trails, fast',
    settings: { matchArtwork: false, mode: 'cyberBlue', primary: '#19d3ff', secondary: '#ff2bd6', brightness: 1.2, glow: 0.95, width: 3, blur: 40, smoothing: 0.35, animationSpeed: 1.6, colorSpeed: 1.6, visualizer: 'bars', darkness: 0.9, layout: 'both' },
  },
  {
    id: 'warmStudio', name: 'Warm Studio', group: 'classic', blurb: 'Amber pools, follows the artwork',
    settings: { mode: 'cinematic', primary: '#ff9a3d', secondary: '#ff5a1f', brightness: 0.95, glow: 0.8, width: 3, blur: 60, smoothing: 0.8, animationSpeed: 0.6, colorSpeed: 0.5, visualizer: 'pulse', darkness: 0.75, matchArtwork: true, layout: 'strips' },
  },
  {
    id: 'sunset', name: 'Sunset', group: 'classic', blurb: 'Orange melting into pink, reactive',
    settings: { matchArtwork: false, mode: 'spectrum', primary: '#ff7a1a', secondary: '#ff2d7a', brightness: 1.05, glow: 0.85, width: 3, blur: 48, smoothing: 0.5, animationSpeed: 1, colorSpeed: 1, visualizer: 'circular', darkness: 0.8, layout: 'strips' },
  },
  {
    id: 'deepSpace', name: 'Deep Space', group: 'classic', blurb: 'Violet and cobalt, slow tides',
    settings: { matchArtwork: false, mode: 'purpleDream', primary: '#7b3dff', secondary: '#1f4bff', brightness: 0.9, glow: 0.9, width: 2, blur: 70, smoothing: 0.7, animationSpeed: 0.6, colorSpeed: 0.7, visualizer: 'particles', darkness: 1, layout: 'both' },
  },
  {
    id: 'minimalOrange', name: 'Minimal Orange', group: 'classic', blurb: 'A single thin line, no distractions',
    settings: { matchArtwork: false, mode: 'amber', primary: '#ff8a1f', secondary: '#ff8a1f', brightness: 0.85, glow: 0.45, width: 2, blur: 28, smoothing: 0.6, animationSpeed: 0.8, colorSpeed: 0.5, visualizer: 'none', darkness: 1, layout: 'strips', edges: { top: true, right: true, bottom: true, left: true } },
  },
];
