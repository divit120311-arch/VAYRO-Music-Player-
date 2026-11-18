import { useStore } from '../../store';
import { lyricsStore } from '../../state/lyrics';

const s = (ms?: number | null) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/**
 * Developer diagnostics for the last transcription: the real measured numbers, nothing estimated.
 * RTF = total processing time ÷ audio duration (0.25 means a 3-minute song takes 45 s).
 */
export function TranscribeDiagnostics() {
  const d = useStore(lyricsStore, (x) => x.diag);
  const job = useStore(lyricsStore, (x) => x.job);
  if (!d && !job) return <p className="text-[11.5px] text-ink-3">No transcription has run in this session yet.</p>;
  const rows: [string, string][] = d
    ? [
        ['Engine', d.engine],
        ['Model', `Whisper ${d.model} (8-bit)`],
        ['Language setting', d.language === 'auto' ? 'Detect automatically' : d.language],
        ['Script of the result', d.script ?? '—'],
        ['Audio length', `${d.audioSeconds} s`],
        ['Result from cache', d.cacheHit ? 'yes — nothing was transcribed' : 'no'],
        ['Cache check', s(d.cacheCheckMs)],
        ['Audio preparation (decode)', s(d.decodeMs)],
        ['Upload to the local server', s(d.uploadMs)],
        ['Model initialisation', d.modelInitMs === 0 ? 'already loaded' : s(d.modelInitMs)],
        ['First lyrics on screen', s(d.firstLyricsMs)],
        ['Recognition (incl. word timing)', s(d.recogniseMs)],
        ['Total', s(d.totalMs)],
        ['RTF (total ÷ audio length)', d.rtf == null ? '—' : String(d.rtf)],
      ]
    : [];
  return (
    <div className="flex flex-col gap-1.5" data-testid="transcribe-diagnostics">
      {job && (
        <p className="text-[11.5px] text-ink-2">
          Running now: {job.phase} · {Math.round(job.progress * 100)}%
        </p>
      )}
      {rows.length > 0 && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-lg bg-black/30 px-3 py-2 font-mono text-[11px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="text-right text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
