import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, Download, Laptop, Monitor } from 'lucide-react';
import { APP_FILES, APP_PLATFORM, GITHUB_RELEASES, IN_DESKTOP_APP, type AppBuild } from '../config/downloads';
import { notify } from '../state/player';

/**
 * "Download for Mac" / "Download for Windows" (whichever computer the visitor is on): the two Mac
 * builds (a website can't reliably tell an Apple Silicon Mac from an Intel one) or the Windows
 * installer. The files come from the repository's latest GitHub Release:
 * GitHub's API answers websites directly (CORS), so before downloading we can check the file is
 * really published and say so plainly if it isn't. Hidden inside the desktop app.
 *
 * Other parts of the page can open this menu with a `vayro:need-app` window event (e.g. "Sync
 * lyrics" on the website, which only works in the app).
 */
type Release = { assets?: { name: string; browser_download_url: string }[] };

async function releaseUrl(file: string): Promise<string | null> {
  const { owner, repo } = GITHUB_RELEASES;
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (r.status === 404) return null; // no release yet (or the repository is private)
  if (!r.ok) throw new Error(r.status === 403 ? 'GitHub is rate-limiting downloads right now — try again in a few minutes.' : `GitHub answered ${r.status}.`);
  const rel = (await r.json()) as Release;
  return rel.assets?.find((a) => a.name === file)?.browser_download_url ?? null;
}

export async function downloadApp(build: AppBuild) {
  try {
    const url = await releaseUrl(APP_FILES[build]);
    if (!url) {
      // no published release with this file (GitHub returns 404 for a private repository too)
      const label = build === 'windows' ? 'Windows' : 'Mac';
      notify(`The ${label} app hasn’t been published yet, so there’s nothing to download. Vayro works right here in the browser meanwhile.`, 'error');
      return;
    }
    window.location.href = url; // GitHub serves it as a file download; the page stays put
  } catch (e) {
    notify(`Couldn’t start the download: ${(e as Error).message}`, 'error');
  }
}

export function MacDownload({ onPointerMove }: { onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<AppBuild | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('vayro:need-app', show);
    return () => window.removeEventListener('vayro:need-app', show);
  }, []);
  // offered on Macs and Windows PCs; phones etc. use Vayro in the browser (and the app needs no download)
  if (IN_DESKTOP_APP || !APP_PLATFORM) return null;

  const pick = async (build: AppBuild) => {
    setBusy(build);
    await downloadApp(build);
    setBusy(null);
    setOpen(false);
  };
  const Item = ({ build, icon, title, hint }: { build: AppBuild; icon: React.ReactNode; title: string; hint: string }) => (
    <button
      type="button"
      role="menuitem"
      disabled={!!busy}
      onClick={() => void pick(build)}
      className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.07] disabled:opacity-60"
    >
      <span className="mt-0.5 shrink-0 text-ink-2">{icon}</span>
      <span>
        <span className="block text-[13.5px] font-medium text-ink">{busy === build ? 'Checking…' : title}</span>
        <span className="block text-[12px] text-ink-3">{hint}</span>
      </span>
    </button>
  );
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onPointerMove={onPointerMove}
        aria-expanded={open}
        aria-haspopup="menu"
        title="The Vayro app: syncs lyrics with the Spotify app, nothing else to install"
        className="press rim-follow relative inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-ink-2 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:text-ink"
        style={{ background: 'rgb(255 255 255 / 0.04)' }}
      >
        <Download size={15} strokeWidth={1.9} /> Download for {APP_PLATFORM}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Choose your computer"
            initial={{ opacity: 0, x: '-50%', y: -6, scale: 0.97 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: -4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            // opens upward: below it sits the player bar, which would cover it
            className="glass-strong absolute bottom-[calc(100%+10px)] left-1/2 z-50 w-[290px] origin-bottom rounded-2xl p-1.5 text-left"
            // nearly solid: it opens over the headline and buttons, which must not show through
            style={{ background: 'linear-gradient(180deg, rgb(32 31 40 / 0.96), rgb(16 15 20 / 0.97)) padding-box, linear-gradient(135deg, rgb(255 255 255 / 0.45), rgb(255 255 255 / 0.08) 45%, rgb(255 255 255 / 0.25)) border-box', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
          >
            {APP_PLATFORM === 'Windows' ? (
              <>
                <p className="px-3 pb-1 pt-2 text-[12px] leading-snug text-ink-2">To sync with the Spotify app on this PC, get the Vayro app. Websites can’t see your other apps.</p>
                <Item build="windows" icon={<Monitor size={17} />} title="Vayro for Windows" hint="Windows 10 / 11, 64-bit" />
              </>
            ) : (
              <>
                <p className="px-3 pb-1 pt-2 text-[12px] leading-snug text-ink-2">To sync with the Spotify app on this Mac, get the Vayro app. Websites can’t see your other apps.</p>
                <p className="px-3 pb-1 pt-1 text-[11px] text-ink-3">Which Mac? (Apple menu → About This Mac → Chip)</p>
                <Item build="appleSilicon" icon={<Cpu size={17} />} title="Apple Silicon" hint="Chip says M1, M2, M3, M4…" />
                <Item build="intel" icon={<Laptop size={17} />} title="Intel" hint="Processor says Intel (older Macs)" />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
