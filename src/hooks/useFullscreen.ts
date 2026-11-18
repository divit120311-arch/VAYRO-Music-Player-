import { useCallback, useEffect } from 'react';
import { createStore, useStore } from '../store';

/**
 * Immersive mode = our minimal hardware-style UI, ideally inside the browser's real
 * Fullscreen API. If fullscreen is refused (e.g. inside an iframe) we still enter the
 * immersive layout so the feature degrades instead of breaking.
 */
const immersiveStore = createStore({ immersive: false });

export function enterImmersive() {
  immersiveStore.setState({ immersive: true });
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      /* not allowed — stay in immersive layout without OS fullscreen */
    });
  }
}

export function exitImmersive() {
  immersiveStore.setState({ immersive: false });
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

export function toggleImmersive() {
  if (immersiveStore.getState().immersive) exitImmersive();
  else enterImmersive();
}

export function useFullscreen() {
  const immersive = useStore(immersiveStore, (s) => s.immersive);

  useEffect(() => {
    // Esc in real fullscreen is handled by the browser → we follow it out
    const onChange = () => {
      if (!document.fullscreenElement && immersiveStore.getState().immersive) {
        immersiveStore.setState({ immersive: false });
      }
    };
    // Esc when fullscreen was refused (or when the browser forwards the key to the page)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && immersiveStore.getState().immersive) exitImmersive();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return {
    immersive,
    enter: useCallback(enterImmersive, []),
    exit: useCallback(exitImmersive, []),
    toggle: useCallback(toggleImmersive, []),
  };
}
