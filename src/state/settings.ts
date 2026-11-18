import { createStore } from '../store';
import { DEFAULT_SETTINGS, MODE_BY_ID, PRESETS } from '../config/lighting';
import type { LightingMode, LightingSettings, PresetId } from '../types/lighting';

const KEY = 'afterglow:settings:v1';
const ROMAN_DEFAULT = 'afterglow:roman-lyrics-default:v1';

function load(): LightingSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<LightingSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed, edges: { ...DEFAULT_SETTINGS.edges, ...parsed.edges } };
    if (!(merged.mode in MODE_BY_ID)) merged.mode = DEFAULT_SETTINGS.mode;
    // one-time: lyrics in English letters became the default — switch it on for existing settings
    // once; after that the listener's own choice is kept
    if (!localStorage.getItem(ROMAN_DEFAULT)) {
      merged.lyricsRomanize = true;
      merged.lyricsScript = 'latin';
      localStorage.setItem(ROMAN_DEFAULT, '1');
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settingsStore = createStore<LightingSettings>(load());

let saveTimer: number | undefined;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsStore.getState()));
  } catch {
    /* storage full or blocked — preferences just won't persist */
  }
};
settingsStore.subscribe(() => {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(save, 250);
});
// a reload / tab close inside the debounce window must not lose the last change
window.addEventListener('pagehide', () => saveTimer !== undefined && save());

/** Manual tweak: clears the "active preset" marker. */
export function updateSettings(patch: Partial<LightingSettings>) {
  settingsStore.setState({ ...patch, preset: null });
}

export function setMode(mode: LightingMode) {
  const info = MODE_BY_ID[mode];
  settingsStore.setState({ mode, primary: info.primary, secondary: info.secondary, preset: null });
}

/** Personal display preferences a lighting preset should never silently reset. */
const PERSONAL_KEYS = ['view', 'lyricsStyle', 'lyricsSize', 'lyricsPosition', 'onlineLyrics', 'transcribeUploads', 'lyricsEnabled', 'lyricsWeight', 'lyricsAlign', 'lyricsLineSpacing', 'lyricsHighlight', 'lyricsGlow', 'lyricsTint', 'lyricsSpeed', 'lyricsBgOpacity', 'lyricsLines', 'wordHighlight', 'lyricsArtwork', 'showTrackInfo', 'lyricsScript', 'lyricsRomanize', 'lyricsFisheye', 'lyricsResumeSec', 'preferFullSongs', 'transcribeLanguage', 'transcribeModel', 'transcribeEaseLighting', 'showClock', 'showArtwork', 'lateNight', 'motion', 'quality'] as const;

export function applyPreset(id: PresetId) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return;
  const cur = settingsStore.getState();
  const personal = Object.fromEntries(PERSONAL_KEYS.map((k) => [k, cur[k]])) as Partial<LightingSettings>;
  // reference presets may deliberately set a view/lyrics style (that's part of the look)
  settingsStore.setState({ ...DEFAULT_SETTINGS, ...personal, ...p.settings, preset: id });
}

const VIEW_ORDER = ['artwork', 'lyrics', 'visualizer', 'clock', 'ambient'] as const;
export function cycleView(dir = 1) {
  const i = VIEW_ORDER.indexOf(settingsStore.getState().view);
  settingsStore.setState({ view: VIEW_ORDER[(i + dir + VIEW_ORDER.length) % VIEW_ORDER.length] });
}

export function resetSettings() {
  settingsStore.setState({ ...DEFAULT_SETTINGS });
}
