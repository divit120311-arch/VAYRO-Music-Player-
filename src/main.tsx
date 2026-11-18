import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initQuality } from './state/quality';

// pick the visual-quality level before the first frame is drawn
initQuality();
// the Mac desktop app draws its window buttons inside our header (see electron/main.cjs)
if (new URLSearchParams(location.search).get('shell') === 'mac') document.documentElement.dataset.shell = 'mac';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// ?debug exposes the engines for inspection in DevTools
if (new URLSearchParams(location.search).has('debug')) {
  void Promise.all([import('./engine/lightingEngine'), import('./engine/audioEngine'), import('./state/lyrics'), import('./state/settings'), import('./state/player'), import('./services/transcriber')]).then(([l, a, ly, st, pl, tr]) => {
    Object.assign(window, { __afterglow: { lighting: l.lightingEngine, audio: a.audioEngine, lyrics: ly.lyricsStore, settings: st.settingsStore, player: pl.playerStore, jumpTo: pl.jumpTo, playList: pl.playList, playNow: pl.playNow, transcribe: tr.transcribe, applyPreset: st.applyPreset } });
  });
}
