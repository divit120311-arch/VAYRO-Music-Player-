import { formatLrcTime } from '../utils/lrc';

/**
 * Sample lyrics for the synthesised demo ("Neon Nocturne"), written for Vayro.
 * The demo is instrumental — these lines exist to show the lyric engine working without
 * using anyone's copyrighted lyrics. Word stamps are placed on the demo's own beat grid
 * (112 BPM, one line per bar), so the timing is exact for this track.
 */
const BEAT = 60 / 112;
const BAR = BEAT * 4;

const LINES: [bar: number, text: string][] = [
  [0, 'Lights low, the city hums'],
  [1, 'Edges glowing in the dark'],
  [2, 'Every beat a little brighter'],
  [3, 'Keep the screen awake'],
  [4, 'Amber on the walls tonight'],
  [5, 'Hold the colour in your hands'],
  [6, 'Listen, the room is breathing'],
  [7, 'Neon tracing every line'],
  [8, 'Stay until the morning comes'],
  [9, 'Look how beautiful it gets'],
  [10, 'Love it when the bass comes home'],
  [11, 'Fly into the afterglow'],
  [12, 'Quiet now'],
  [13, 'Dream a little slower'],
  [14, 'Back into the light'],
  [15, 'Afterglow'],
];

export function demoLyricsLrc() {
  const out = ['[ti:Neon Nocturne]', '[ar:Vayro Synth Engine]', '[re:Sample lyrics written for the Vayro demo]'];
  for (const [bar, text] of LINES) {
    const start = bar * BAR;
    const words = text.split(' ');
    // words land on 8th notes across the first three beats of the bar
    const step = Math.min(BEAT / 2, (BEAT * 3) / words.length);
    const body = words.map((w, i) => `<${formatLrcTime(start + i * step)}>${w}`).join(' ');
    out.push(`[${formatLrcTime(start)}]${body}`);
  }
  out.push(`[${formatLrcTime(16 * BAR)}]`);
  return out.join('\n');
}
