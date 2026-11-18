import { useStore } from '../store';
import { currentTrack, playerStore, type PlayerState } from '../state/player';
import { settingsStore } from '../state/settings';
import type { LightingSettings } from '../types/lighting';

export function usePlayer<U>(selector: (s: PlayerState) => U): U {
  return useStore(playerStore, selector);
}

export function useCurrentTrack() {
  return useStore(playerStore, (s) => currentTrack(s));
}

export function useSettings<U>(selector: (s: LightingSettings) => U): U {
  return useStore(settingsStore, selector);
}

export function useIsPlaying() {
  return useStore(playerStore, (s) => s.status === 'playing' || s.status === 'buffering');
}

export {
  playTracks, playList, playNow, enqueue, togglePlay, next, prev, seek, seekBy, setVolume, toggleMute,
  cycleRepeat, toggleShuffle, removeFromQueue, clearQueue, jumpTo, notify,
} from '../state/player';
