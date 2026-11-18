export interface LyricWord {
  /** seconds */
  t: number;
  text: string;
}

export interface LyricLine {
  /** start, seconds */
  t: number;
  /** end, seconds (next line start when not given) */
  end: number;
  text: string;
  /** real word timestamps when the source provides them */
  words?: LyricWord[];
}

export type LyricsSource = 'lrclib' | 'file' | 'manual' | 'sample' | 'transcribed' | 'embedded';
export type UserLyricsSource = 'file' | 'manual' | 'transcribed' | 'embedded' | 'lrclib';

export interface LyricsDoc {
  /** synced = line timestamps exist; plain = text only (never shown as if synced) */
  kind: 'synced' | 'plain';
  lines: LyricLine[];
  /** plain text lines when kind === 'plain' */
  plain?: string[];
  hasWordSync: boolean;
  source: LyricsSource;
  /** shown in the UI: where the lyrics came from */
  attribution?: string;
  /** length (s) of the recording these timestamps were made for, when the source says */
  recordingSeconds?: number;
}

export type LyricsStatus = 'idle' | 'loading' | 'ready' | 'instrumental' | 'unavailable' | 'error' | 'disabled' | 'transcribing' | 'off';

export type LyricsStyle = 'reel' | 'overlay' | 'ring' | 'kinetic' | 'scroll' | 'glow' | 'reveal' | 'cinematic' | 'karaoke' | 'minimal' | 'floating' | 'typewriter' | 'focus';
