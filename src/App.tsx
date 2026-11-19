import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { AlertTriangle, Upload } from 'lucide-react';
import { AmbientLighting } from './components/AmbientLighting';
import { Backdrop } from './components/Backdrop';
import { HeroBackdrop } from './components/hero/HeroBackdrop';
import { FullscreenExperience } from './components/FullscreenExperience';
import { Header } from './components/Header';
import { MusicPlayer } from './components/MusicPlayer';
import { PlaybackControls } from './components/PlaybackControls';
import { Visualizer } from './components/Visualizer';
import { initSpotify } from './services/spotifyAuth';
import { NotchBody } from './components/NotchBody';
import { LiquidGlassFilter } from './components/LiquidGlass';
import { nudgeOffset, setUserLyrics, stepLine } from './state/lyrics';
import { useSettings } from './hooks/useAudioPlayer';
import { useFullscreen } from './hooks/useFullscreen';
import { usePlayer, enqueue, next, prev, notify, seekBy, setVolume, toggleMute, togglePlay } from './hooks/useAudioPlayer';
import { MODES } from './config/lighting';
import { cycleView, setMode } from './state/settings';
import { useStore } from './store';
import { closePanels, openLibrary, openMusic, toggleMusic, toggleSettings, uiStore } from './state/ui';
import { dismissNotice, playerStore } from './state/player';
import { ensureBackend } from './state/backend';
import { filesToTracks, isAudioFile } from './services/localFiles';

function Toast() {
  const notice = usePlayer((s) => s.notice);
  return (
    // sits just above the player bar (never on top of it)
    <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-[196px] z-[45] flex justify-center px-6 max-md:bottom-[150px]">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex max-w-[560px] flex-wrap items-start gap-2 rounded-2xl px-4 py-2.5 text-[12.5px] leading-snug text-ink-2"
          >
            {notice.tone === 'error' && <AlertTriangle size={14} className="mt-[2px] shrink-0 text-red-300" />}
            <span className="min-w-0 flex-1">{notice.text}</span>
            {!!notice.actions?.length && (
              <span className="pointer-events-auto flex w-full flex-wrap justify-end gap-2 pt-1">
                {notice.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => {
                      dismissNotice();
                      a.run();
                    }}
                    className="press rounded-full bg-white/90 px-3.5 py-1.5 text-[12px] font-semibold text-black hover:bg-white"
                  >
                    {a.label}
                  </button>
                ))}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- panels load on first use (smaller first download), then stay mounted so their open/close
// animations keep working; once the page is idle they're fetched quietly so opening is instant
const loadMusicLibrary = () => import('./components/MusicLibrary');
const loadSettings = () => import('./components/SettingsPanel');
const loadGuide = () => import('./components/GuidePanel');
const loadArtists = () => import('./components/artists/ArtistsView');
const loadLibrary = () => import('./components/library/LibraryView');
const MusicLibrary = lazy(() => loadMusicLibrary().then((m) => ({ default: m.MusicLibrary })));
const SettingsPanel = lazy(() => loadSettings().then((m) => ({ default: m.SettingsPanel })));
const GuidePanel = lazy(() => loadGuide().then((m) => ({ default: m.GuidePanel })));
const ArtistsView = lazy(() => loadArtists().then((m) => ({ default: m.ArtistsView })));
const LibraryView = lazy(() => loadLibrary().then((m) => ({ default: m.LibraryView })));

function MountWhenOpened({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);
  return seen || open ? <Suspense fallback={null}>{children}</Suspense> : null;
}

function usePrefetchPanels() {
  useEffect(() => {
    const go = () => {
      for (const load of [loadLibrary, loadSettings, loadMusicLibrary, loadArtists, loadGuide]) {
        load().catch((e: unknown) => console.warn('[vayro] could not prefetch a panel (it will load when opened):', e));
      }
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(go, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(go, 2500); // Safari has no requestIdleCallback
    return () => clearTimeout(t);
  }, []);
}

/**
 * App commands, shared by keyboard shortcuts and the desktop app's native menu (which dispatches a
 * `vayro:command` window event: no Node access or IPC bridge needed in the page).
 */
export type AppCommand = 'search' | 'settings' | 'toggle' | 'next' | 'prev' | 'library';
/** focus an element that is about to mount (a lazily loaded panel), giving up after ~3 s */
function focusWhenReady(selector: string) {
  const until = performance.now() + 3000;
  const tryFocus = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el.focus();
    if (performance.now() < until) requestAnimationFrame(tryFocus);
  };
  requestAnimationFrame(tryFocus);
}

function runCommand(cmd: AppCommand) {
  switch (cmd) {
    case 'search':
      openMusic('discover');
      // the search box mounts with the panel (loaded on first use): focus it as soon as it exists
      focusWhenReady('[data-search-input]');
      break;
    case 'settings':
      if (!uiStore.getState().settings) toggleSettings();
      break;
    case 'library':
      toggleMusic();
      break;
    case 'toggle':
      togglePlay();
      break;
    case 'next':
      next();
      break;
    case 'prev':
      prev();
      break;
  }
}

export default function App() {
  const { immersive, toggle, exit } = useFullscreen();
  const lateNight = useSettings((s) => s.lateNight);
  const motionPref = useSettings((s) => s.motion);
  // which panels are open: plain booleans, so App re-renders only when one opens or closes
  const panels = {
    library: useStore(uiStore, (s) => !!s.library),
    settings: useStore(uiStore, (s) => s.settings),
    guide: useStore(uiStore, (s) => s.guide),
    artists: useStore(uiStore, (s) => !!s.artists),
    music: useStore(uiStore, (s) => !!s.music),
  };
  usePrefetchPanels();
  // CSS motion rules read this (Settings → Motion can override the system's "reduce motion")
  useEffect(() => {
    document.documentElement.dataset.motion = motionPref;
  }, [motionPref]);
  useEffect(() => {
    document.documentElement.toggleAttribute('data-late-night', lateNight);
  }, [lateNight]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  // ---- backend availability (catalog + proxy)
  useEffect(() => {
    // the API can be slow to answer the very first request (a serverless cold start): one retry
    let retry = 0;
    void ensureBackend().then((ok) => {
      if (!ok) retry = window.setTimeout(() => void ensureBackend(), 5000);
    });
    // a Spotify sign-in to finish/restore
    void initSpotify();
    return () => clearTimeout(retry);
  }, []);

  // ---- local files
  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    const { tracks, rejected } = await filesToTracks(files);
    if (tracks.length) {
      const idle = playerStore.getState().index < 0;
      enqueue(tracks, { autoplay: idle });
    }
    // one combined message, so the "added" note isn't immediately replaced by the "skipped" one
    const parts: string[] = [];
    if (tracks.length) parts.push(`Added ${tracks.length} track${tracks.length > 1 ? 's' : ''} to your queue.`);
    if (rejected.length) {
      parts.push(`Skipped ${rejected.slice(0, 3).map((r) => `${r.name} (${r.reason})`).join(', ')}${rejected.length > 3 ? '…' : ''}.`);
    }
    if (parts.length) notify(parts.join(' '), tracks.length ? 'info' : 'error');
  }, []);
  const openFiles = useCallback(() => fileInput.current?.click(), []);

  // ---- drag & drop anywhere
  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      // an .lrc / .txt dropped on the window becomes the current track's lyrics
      const lyric = files.find((f) => /\.(lrc|txt)$/i.test(f.name));
      if (lyric && !files.some(isAudioFile)) {
        void lyric.text().then((t) => {
          const err = setUserLyrics(t, 'file');
          notify(err ?? `Loaded lyrics from ${lyric.name}.`, err ? 'error' : 'info');
        });
        return;
      }
      if (!files.some(isAudioFile)) return notify('Those don’t look like audio or lyrics files.', 'error');
      // "Song.lrc" dropped next to "Song.mp3" is kept: it becomes that file's synced lyrics
      void addFiles(files.filter((f) => isAudioFile(f) || /\.lrc$/i.test(f.name)));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addFiles]);

  // ---- commands from the desktop app's menu
  useEffect(() => {
    const on = (e: Event) => runCommand((e as CustomEvent<AppCommand>).detail);
    window.addEventListener('vayro:command', on);
    return () => window.removeEventListener('vayro:command', on);
  }, []);

  // ---- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target instanceof Element ? e.target : document.body) as HTMLElement;
      // ⌘/Ctrl + F: search · ⌘/Ctrl + ,: settings (the Mac app's menu sends the same commands)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !immersive) {
        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault();
          return runCommand('search');
        }
        if (e.key === ',') {
          e.preventDefault();
          return runCommand('settings');
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Esc always closes panels — even while typing in a search box
      if (e.key === 'Escape' && !immersive) {
        if (t.closest('input, textarea, select')) (t as HTMLElement).blur();
        if (!document.querySelector('[role="dialog"]')) closePanels();
        return;
      }
      if (t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const onControl = t.closest('button, [role="slider"], a, [role="switch"], [role="radio"]');
      const { volume } = playerStore.getState();
      switch (e.key) {
        case ' ':
          if (onControl) return; // let the focused button handle Space
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight': if (onControl?.getAttribute('role') === 'slider') return; seekBy(5); break;
        case 'ArrowLeft': if (onControl?.getAttribute('role') === 'slider') return; seekBy(-5); break;
        case 'ArrowUp': if (onControl?.getAttribute('role') === 'slider') return; e.preventDefault(); setVolume(volume + 0.05); break;
        case 'ArrowDown': if (onControl?.getAttribute('role') === 'slider') return; e.preventDefault(); setVolume(volume - 0.05); break;
        case 'n': case 'N': next(); break;
        case 'p': case 'P': prev(); break;
        case 'm': case 'M': toggleMute(); break;
        case 'f': case 'F': toggle(); break;
        case 's': case 'S': if (!immersive) toggleSettings(); break;
        case 'l': case 'L': if (!immersive) toggleMusic(); break;
        case 'u': case 'U': if (!immersive) openLibrary('link'); break;
        case 'v': cycleView(1); break;
        case 'V': cycleView(-1); break;
        case '[': nudgeOffset(-0.1); break;
        case ']': nudgeOffset(0.1); break;
        case ',': stepLine(-1); break;
        case '.': stepLine(1); break;
        default:
          if (/^[0-9]$/.test(e.key)) {
            const i = e.key === '0' ? 9 : Number(e.key) - 1;
            if (MODES[i]) setMode(MODES[i].id);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, immersive]);

  return (
    <MotionConfig reducedMotion={motionPref === 'full' ? 'never' : motionPref === 'reduced' ? 'always' : 'user'}>
    <div className="relative isolate h-full overflow-hidden">
      <LiquidGlassFilter />
      <Backdrop />
      <HeroBackdrop />
      <Visualizer />

      <AnimatePresence>
        {!immersive && (
          <motion.div
            key="main"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="late-dim relative z-10 flex h-full flex-col transition-opacity duration-700"
          >
            <Header onFullscreen={toggle} />
            <MusicPlayer />
            <PlaybackControls />
            <MountWhenOpened open={!!panels.library}>
              <MusicLibrary onOpenFiles={openFiles} />
            </MountWhenOpened>
            <MountWhenOpened open={panels.settings}>
              <SettingsPanel />
            </MountWhenOpened>
            <MountWhenOpened open={panels.guide}>
              <GuidePanel />
            </MountWhenOpened>
            <MountWhenOpened open={!!panels.artists}>
              <ArtistsView />
            </MountWhenOpened>
            <MountWhenOpened open={!!panels.music}>
              <LibraryView />
            </MountWhenOpened>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{immersive && <FullscreenExperience key="immersive" onExit={exit} />}</AnimatePresence>

      <Toast />
      <NotchBody />
      <AmbientLighting />

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-line-2" style={{ boxShadow: '0 0 60px -10px var(--glow-p)' }}>
                <Upload size={24} />
              </span>
              <p className="text-[18px] font-semibold">Drop to add to your queue</p>
              <p className="text-[13px] text-ink-3">MP3 · WAV · OGG · M4A · FLAC — stays on your device</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileInput}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm,.lrc"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
    </MotionConfig>
  );
}
