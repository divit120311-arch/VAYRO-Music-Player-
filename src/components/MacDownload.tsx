import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, Download, Laptop } from 'lucide-react';
import { IN_DESKTOP_APP, MAC_DOWNLOADS } from '../config/downloads';
import { notify } from '../state/player';

/**
 * "Download for Mac": a small menu with the two Mac builds (a website can't reliably tell an
 * Apple Silicon Mac from an Intel one). Before downloading it checks the file is really there, so a
 * missing upload shows a clear message instead of a broken download. Hidden inside the desktop app.
 */
async function available(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    // the dev server and the site answer unknown paths with the page itself: that's "missing" too
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

async function download(url: string) {
  if (!(await available(url))) {
    notify('The Mac app isn’t available to download yet — check back soon.', 'error');
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = url.split('/').pop() || 'Vayro.dmg';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function MacDownload({ onPointerMove }: { onPointerMove?: (e: React.PointerEvent<HTMLElement>) => void }) {
  const [open, setOpen] = useState(false);
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
  if (IN_DESKTOP_APP) return null;

  const pick = (url: string) => {
    setOpen(false);
    void download(url);
  };
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onPointerMove={onPointerMove}
        aria-expanded={open}
        aria-haspopup="menu"
        title="The Vayro app for Mac: syncs lyrics with the Spotify app, nothing else to install"
        className="press rim-follow relative inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-ink-2 ring-1 ring-white/15 backdrop-blur-md transition-colors hover:text-ink"
        style={{ background: 'rgb(255 255 255 / 0.04)' }}
      >
        <Download size={15} strokeWidth={1.9} /> Download for Mac
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Choose your Mac"
            initial={{ opacity: 0, x: '-50%', y: 6, scale: 0.97 }}
            animate={{ opacity: 1, x: '-50%', y: 0, scale: 1 }}
            exit={{ opacity: 0, x: '-50%', y: 4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong absolute left-1/2 top-[calc(100%+10px)] z-20 w-[290px] rounded-2xl p-1.5 text-left"
          >
            <p className="px-3 pb-1 pt-2 text-[11px] text-ink-3">Which Mac? (Apple menu → About This Mac → Chip)</p>
            <button type="button" role="menuitem" onClick={() => pick(MAC_DOWNLOADS.appleSilicon)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.07]">
              <Cpu size={17} className="mt-0.5 shrink-0 text-ink-2" />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">Apple Silicon</span>
                <span className="block text-[12px] text-ink-3">Chip says M1, M2, M3, M4…</span>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => pick(MAC_DOWNLOADS.intel)} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.07]">
              <Laptop size={17} className="mt-0.5 shrink-0 text-ink-2" />
              <span>
                <span className="block text-[13.5px] font-medium text-ink">Intel</span>
                <span className="block text-[12px] text-ink-3">Processor says Intel (older Macs)</span>
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
