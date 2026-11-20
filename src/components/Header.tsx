import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { HoverLensGroup } from './HoverLens';
import { VayroSymbol, VayroWordmark } from './brand/VayroMark';
import { BookOpen, Compass, FolderOpen, Home as HomeIcon, Library, Link2, ListMusic, Maximize2, Moon, Radio, Search, Settings, SlidersHorizontal, Star } from 'lucide-react';
import { useStore } from '../store';
import { closeArtists, closePanels, openGuide, openArtists, openLibrary, openMusic, toggleLibrary, toggleMusic, toggleSettings, uiStore, type LibraryTab } from '../state/ui';
import { updateSettings } from '../state/settings';
import { nowPlayingStore, toggleNowPlaying, warmUpNowPlaying } from '../state/nowPlaying';
import { usePlayer, useSettings } from '../hooks/useAudioPlayer';
import { cx } from './ui';

/**
 * True once the open page (Library, Artists…) has scrolled: the header then settles into a compact
 * floating glass bar. Listens to scroll events from any `[data-scroll-main]` element (capture phase,
 * passive), so no page-level scroll hijacking.
 */
function useMainScrolled(resetKey: unknown) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.('[data-scroll-main]')) return;
      setScrolled(el.scrollTop > 24);
    };
    document.addEventListener('scroll', on, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', on, { capture: true });
  }, []);
  useEffect(() => setScrolled(false), [resetKey]);
  return scrolled;
}

export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // tick on the minute boundary, then every minute
    let id: number;
    const schedule = () => {
      const d = new Date();
      id = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, 60_000 - d.getSeconds() * 1000 - d.getMilliseconds() + 20);
    };
    schedule();
    return () => clearTimeout(id);
  }, []);
  return now;
}

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3', className)} aria-label="Vayro" role="img">
      {/* the brand: the ribbon V and the VΛYRO wordmark */}
      <VayroSymbol className="h-[17px] w-auto drop-shadow-[0_0_10px_rgb(255_255_255/0.18)]" />
      <VayroWordmark className="h-[11px] w-auto text-ink max-sm:hidden" />
    </div>
  );
}

const SOURCES: { id: LibraryTab; label: string; icon: typeof Compass }[] = [
  { id: 'link', label: 'Link', icon: Link2 },
  { id: 'files', label: 'Files', icon: FolderOpen },
];

/**
 * A tab in a header pill group. The active tab carries a glass pill with a soft glow in the light
 * colour; the pill slides between tabs of the same group instead of jumping.
 */
export function NavTab({
  group, on, onClick, icon, label, title, role, compactLabel = 'max-lg:hidden',
}: { group: string; on: boolean; onClick: () => void; icon: React.ReactNode; label: string; title?: string; role?: 'radio'; compactLabel?: string }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? on : undefined}
      aria-pressed={role ? undefined : on}
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'press liquid-hover relative flex items-center gap-1.5 rounded-full font-medium transition-colors duration-[var(--dur-base)] max-sm:px-2.5',
        // the main navigation is the page's primary chrome: larger, like the mockup
        group === 'main' ? 'px-6 py-[9px] text-[16px] font-normal max-xl:px-4 max-lg:px-3 max-lg:py-[7px] max-sm:!px-3.5 max-sm:text-[13.5px]' : 'px-3 py-[6px] text-[12px]',
        on ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
      )}
    >
      {on && (
        <motion.span
          layoutId={`nav-pill-${group}`}
          aria-hidden
          className={cx('absolute inset-[-1px] rounded-full', group === 'main' ? 'nav-pill-dark' : 'liquid-pill')}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {/* the main navigation is text only (the mockup); icons stand in when the labels collapse */}
        <span className={cx('flex', group === 'main' && 'lg:hidden max-sm:hidden')}>{icon}</span>
        <span className={cx(compactLabel, group === 'main' && 'max-sm:!inline')}>{label}</span>
      </span>
    </button>
  );
}

type MenuItem = { label: string; hint?: string; icon: React.ReactNode; on: boolean; run: () => void; keepOpen?: boolean };

/**
 * The round button on the right of the header (the mockup's profile button): a glass menu with the
 * app's tools. Vayro has no accounts, so it's named "Menu", not "Profile".
 */
function HeaderMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    warmUpNowPlaying(); // "Sync Spotify lyrics" is in this menu: get its text reader loading
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label="Settings and tools"
        title="Settings and tools: artists, Spotify lyrics, files, queue, settings…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('press round-glass flex h-[48px] w-[48px] items-center justify-center rounded-full text-ink max-sm:h-10 max-sm:w-10', open && 'round-glass-on')}
      >
        <Settings size={20} strokeWidth={1.8} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass absolute right-0 top-[calc(100%+12px)] z-50 w-[260px] origin-top-right rounded-2xl p-1.5"
          >
            <HoverLensGroup className="flex flex-col" radius={12}>
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    it.run();
                    if (!it.keepOpen) setOpen(false);
                  }}
                  className={cx('liquid-hover flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] transition-colors', it.on ? 'text-ink' : 'text-ink-2 hover:text-ink')}
                >
                  <span className={cx('flex h-5 w-5 items-center justify-center', it.on && 'text-[color-mix(in_srgb,var(--glow-p)_70%,white)]')}>{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && it.hint.length <= 2 && <kbd className="rounded bg-white/[0.06] px-1.5 py-[1px] font-mono text-[10.5px] text-ink-3">{it.hint}</kbd>}
                  {it.on && <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--glow-p)', boxShadow: '0 0 8px var(--glow-p)' }} />}
                </button>
              ))}
            </HoverLensGroup>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Header({ onFullscreen }: { onFullscreen: () => void }) {
  const now = useClock();
  const library = useStore(uiStore, (s) => s.library);
  const settings = useStore(uiStore, (s) => s.settings);
  const artists = useStore(uiStore, (s) => s.artists);
  const music = useStore(uiStore, (s) => s.music);
  const guide = useStore(uiStore, (s) => s.guide);
  const queueLen = usePlayer((s) => s.queue.length);
  const lateNight = useSettings((s) => s.lateNight);
  const notch = useSettings((s) => s.notch);
  const np = useStore(nowPlayingStore, (s) => s);
  const npOn = np.status !== 'off' && np.status !== 'unsupported';
  const npLabel = np.status === 'following' && np.app ? `Following ${np.app}` : npOn ? 'Waiting for a song in Spotify…' : 'Sync Spotify lyrics';
  const npTitle =
    np.status === 'unsupported' || np.status === 'error'
      ? np.message ?? 'Now Playing isn’t available'
      : npOn
        ? `${np.message ?? 'Showing synced lyrics for what this computer is playing'} — click to stop`
        : 'Follow the song playing in Spotify (or any music app) on this computer and show its synced lyrics';

  const compact = useMainScrolled(`${music}|${library}|${artists}|${settings}`);

  return (
    <header
      data-compact={compact || undefined}
      className={cx(
        'app-drag relative z-40 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-7 transition-[height,padding] duration-[var(--dur-slow)] ease-out-soft max-md:grid-cols-[auto_minmax(0,1fr)] max-sm:h-auto max-sm:gap-x-2 max-sm:gap-y-1.5 max-sm:px-4 max-sm:pb-1 max-sm:pt-2',
        compact ? 'h-[58px]' : 'h-[68px]',
      )}
    >
      {/* scrolled: the header becomes a compact floating glass bar */}
      <motion.div
        aria-hidden
        className="glass-strong pointer-events-none absolute inset-x-3 inset-y-[5px] -z-10 rounded-full max-sm:hidden"
        initial={false}
        animate={{ opacity: compact ? 1 : 0, scale: compact ? 1 : 0.985 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />
      <div className="flex min-w-0 items-center gap-4">
        <Logo />
        <time className="tabular hidden whitespace-nowrap text-[12px] font-medium text-ink-3" dateTime={now.toISOString()}>
          {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
          <span className="mx-1.5 text-ink-4">·</span>
          <span className="text-ink-2">{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        </time>
      </div>

      {/* main navigation (with the notch on, drop below its 28 px housing and the light around it) */}
      <div className={cx('transition-transform duration-[var(--dur-slow)] ease-out-soft max-sm:col-span-2 max-sm:row-start-2 max-sm:justify-self-center', notch && 'translate-y-[22px] max-sm:translate-y-0')}>
        <HoverLensGroup role="navigation" aria-label="Main" className="flex gap-2 rounded-full p-[4px] max-sm:gap-0.5 max-sm:bg-white/[0.04] max-sm:ring-1 max-sm:ring-white/10 max-sm:backdrop-blur-xl">
          <NavTab group="main" compactLabel="max-lg:hidden" on={!music && !library && !artists && !settings} onClick={closePanels} title="Home" icon={<HomeIcon size={14} strokeWidth={2} />} label="Home" />
          <NavTab group="main" compactLabel="max-lg:hidden" on={!!music?.startsWith('discover')} onClick={() => openMusic('discover')} title="Discover: search Apple’s catalogue, add artists" icon={<Compass size={14} strokeWidth={2} />} label="Discover" />
          <NavTab group="main" compactLabel="max-lg:hidden" on={!!music && !music.startsWith('discover') && !music.startsWith('playlist')} onClick={() => openMusic('home')} title="Music library (L)" icon={<Library size={14} strokeWidth={2} />} label="Library" />
          <NavTab group="main" compactLabel="max-lg:hidden" on={!!music?.startsWith('playlist')} onClick={() => openMusic('playlists')} title="Your playlists" icon={<ListMusic size={14} strokeWidth={2} />} label="Playlists" />
        </HoverLensGroup>
      </div>

      <nav className="flex items-center justify-end gap-3 max-sm:gap-2">
        <button type="button" onClick={() => openMusic('discover')} aria-label="Search the library" title="Search the library" className="press round-glass flex h-[48px] w-[48px] items-center justify-center rounded-full text-ink max-sm:h-10 max-sm:w-10">
          <Search size={19} strokeWidth={1.9} />
        </button>
        <button type="button" onClick={onFullscreen} aria-label="Immersive fullscreen (F)" title="Immersive fullscreen (F)" className="press round-glass flex h-[48px] w-[48px] items-center justify-center rounded-full text-ink max-sm:h-10 max-sm:w-10">
          <Maximize2 size={18} strokeWidth={1.9} />
        </button>
        <HeaderMenu
          items={[
            // phones: the centre navigation is hidden, so the Library is reached from here
            { label: 'Library', hint: 'L', icon: <Library size={16} />, on: !!music, run: toggleMusic },
            { label: 'Artists', icon: <Star size={16} />, on: !!artists, run: () => (artists ? closeArtists() : openArtists()) },
            { label: npLabel, hint: npTitle, icon: <Radio size={16} className={cx(np.status === 'following' && 'animate-pulse')} style={np.status === 'following' ? { color: 'var(--glow-p)' } : undefined} />, on: npOn, run: toggleNowPlaying },
            ...SOURCES.map(({ id, icon: Icon }) => ({ label: id === 'link' ? 'Play a link' : 'Your files', icon: <Icon size={16} />, on: library === id, run: () => (library === id ? toggleLibrary() : openLibrary(id)) })),
            { label: `Queue${queueLen ? ` · ${queueLen}` : ''}`, icon: <ListMusic size={16} />, on: library === 'queue', run: () => (library === 'queue' ? toggleLibrary() : openLibrary('queue')) },
            { label: lateNight ? 'Late-night mode on' : 'Late-night mode', icon: <Moon size={16} fill={lateNight ? 'currentColor' : 'none'} />, on: lateNight, run: () => updateSettings({ lateNight: !lateNight }), keepOpen: true },
            { label: 'How to: lyric video', icon: <BookOpen size={16} />, on: guide, run: () => (guide ? closePanels() : openGuide()) },
            { label: 'Settings', hint: 'S', icon: <SlidersHorizontal size={16} />, on: settings, run: toggleSettings },
            { label: 'Immersive fullscreen', hint: 'F', icon: <Maximize2 size={16} />, on: false, run: onFullscreen },
          ]}
        />
      </nav>
    </header>
  );
}
