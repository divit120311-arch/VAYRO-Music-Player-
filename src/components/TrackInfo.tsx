import { useRef } from 'react';
import { AlertTriangle, ExternalLink, RotateCw } from 'lucide-react';
import { useCurrentTrack, usePlayer, togglePlay } from '../hooks/useAudioPlayer';
import { useFrame, useVisualizerAnchor } from '../hooks/useAudioAnalyzer';
import { audioEngine } from '../engine/audioEngine';
import type { AnalysisStatus, Track } from '../types/music';
import { cx, formatTime } from './ui';

const PROVIDER_LABEL: Record<Track['provider'], string> = {
  openverse: 'Openverse',
  jamendo: 'Jamendo',
  apple: 'Apple Music',
  url: 'Direct link',
  local: 'Local file',
  demo: 'Synthesised demo',
  system: 'Now Playing',
  spotify: 'Spotify',
};

export function AnalysisBadge({ status, className }: { status: AnalysisStatus; className?: string }) {
  if (status === 'none') return null;
  const map = {
    full: { text: 'Live analysis', dot: 'bg-emerald-400', title: 'Audio samples are read directly — lighting follows the music.' },
    proxied: { text: 'Live analysis · via proxy', dot: 'bg-emerald-400', title: 'The host does not allow cross-origin reads, so audio is relayed through the Vayro server to make it analysable.' },
    unavailable: { text: 'Playback only', dot: 'bg-amber-400', title: 'This source refuses cross-origin access, so the browser hides its samples from Web Audio. It plays normally; lighting runs in ambient mode instead of reacting.' },
    provider: { text: 'Ambient lighting · provider player', dot: 'bg-sky-400', title: 'The full song plays inside the provider’s own protected player (Spotify, or the app you’re following in Now Playing). Its audio can’t be read by Web Audio, so the lighting runs in ambient mode instead of reacting to the beat.' },
  } as const;
  const m = map[status];
  return (
    <span title={m.title} className={cx('inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2 py-[3px] text-[11px] text-ink-3 ring-1 ring-line', className)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.text}
    </span>
  );
}

function Attribution({ track }: { track: Track }) {
  if (!track.license && !track.pageUrl && !track.externalUrls) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
      {track.preview && (
        <span data-testid="playback-kind" className="rounded-full px-2 py-[3px] ring-1 ring-line" title="A 30-second licensed preview supplied by Apple. No full-length source was available for this song.">
          30-sec preview · courtesy of Apple Music
        </span>
      )}
      {track.provider === 'spotify' && (
        <span data-testid="playback-kind" className="rounded-full px-2 py-[3px] text-emerald-200/85 ring-1 ring-emerald-300/25" title="The complete song plays through Spotify’s Web Playback SDK on your Premium account.">
          Full song · Spotify
        </span>
      )}
      {track.externalUrls?.apple && (
        <a href={track.externalUrls.apple} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink-2">
          Full song on Apple Music <ExternalLink size={10} />
        </a>
      )}
      {track.externalUrls?.spotify && (
        <a href={track.externalUrls.spotify} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink-2">
          Spotify <ExternalLink size={10} />
        </a>
      )}
      {track.license && (
        <a
          href={track.license.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full px-2 py-[3px] ring-1 ring-line transition-colors hover:text-ink-2"
          title={track.attribution}
        >
          {track.license.name}
        </a>
      )}
      {track.pageUrl && track.provider !== 'url' && track.provider !== 'apple' && (
        <a href={track.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 transition-colors hover:text-ink-2">
          {track.source && track.source !== track.provider ? `${track.source} via ${PROVIDER_LABEL[track.provider]}` : PROVIDER_LABEL[track.provider]}
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

/** elapsed / total, updated from the render loop without re-rendering React */
export function LiveTime({ className }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const duration = usePlayer((s) => s.duration);
  let last = '';
  useFrame(() => {
    const t = `${formatTime(audioEngine.currentTime)} / ${formatTime(audioEngine.duration || duration)}`;
    if (t !== last && ref.current) {
      ref.current.textContent = t;
      last = t;
    }
  });
  return <span ref={ref} className={cx('tabular font-mono', className)}>0:00 / {formatTime(duration)}</span>;
}

export function TrackInfo() {
  const track = useCurrentTrack();
  const status = usePlayer((s) => s.status);
  const error = usePlayer((s) => s.error);
  const analysis = usePlayer((s) => s.analysis);
  const eqRef = useVisualizerAnchor('eq');
  if (!track) return null;

  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-2 text-center">
      <h1 className="text-glow line-clamp-2 text-balance text-[clamp(22px,2.6vw,34px)] font-bold leading-tight tracking-[-0.02em] text-ink">
        {track.title}
      </h1>
      <p className="line-clamp-1 text-[15px] text-ink-2">
        {track.artistUrl ? (
          <a href={track.artistUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
            {track.artist}
          </a>
        ) : (
          track.artist
        )}
        {track.album && <span className="text-ink-3"> — {track.album}</span>}
      </p>

      {status === 'error' ? (
        <div role="alert" className="mt-1 flex max-w-[460px] items-start gap-2 rounded-xl bg-red-500/[0.07] px-3 py-2 text-left text-[12.5px] text-red-200/90 ring-1 ring-red-400/20">
          <AlertTriangle size={14} className="mt-[2px] shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={togglePlay} className="inline-flex shrink-0 items-center gap-1 font-medium text-red-100 hover:text-white">
            <RotateCw size={12} /> Retry
          </button>
        </div>
      ) : (
        <div className="mt-0.5 flex flex-wrap items-center justify-center gap-2.5 text-[12px] text-ink-3">
          <LiveTime />
          <AnalysisBadge status={analysis} />
        </div>
      )}
      <Attribution track={track} />
      {/* slot used by the "Minimal EQ" visualizer */}
      <div ref={eqRef} aria-hidden className="h-[34px] w-[120px]" />
    </div>
  );
}
