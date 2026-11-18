import { audioEngine } from './audioEngine';

/**
 * Playback clock for lyrics: the song position, read once per animation frame.
 *
 * The only source of truth is the player's own position (the <audio> element, the Spotify SDK or
 * the system media session). `HTMLMediaElement.currentTime` is coarse in some browsers (it can
 * update every 15–250 ms), which makes word highlights stutter. So between updates the clock
 * extrapolates with `performance.now() × playbackRate`, and it re-anchors to the real position:
 *  - immediately, on any jump > 0.3 s (seek, track change, buffering stall, source change);
 *  - gradually (drift correction: 15 % of the error per frame), when it drifts by a little;
 *  - never while paused: a paused player reports a fixed position, and the clock returns exactly it.
 * It never runs ahead of a stalled player for more than 0.25 s.
 */
const JUMP = 0.3;
const MAX_LEAD = 0.25;

let anchorPos = 0; // the player's last reported position
let anchorAt = 0; // performance.now() when it was reported
let smooth = 0; // what we return
let lastRaw = NaN;
let lastFrame = -1;

export function playbackTime(): number {
  const now = performance.now();
  if (now === lastFrame) return smooth;
  lastFrame = now;
  const raw = audioEngine.currentTime;
  const paused = audioEngine.paused;
  const rate = audioEngine.playbackRate || 1;
  if (paused || !Number.isFinite(raw)) {
    lastRaw = raw;
    anchorPos = smooth = raw || 0;
    anchorAt = now;
    return smooth;
  }
  if (raw !== lastRaw) {
    // a fresh report from the player
    lastRaw = raw;
    anchorPos = raw;
    anchorAt = now;
  }
  const predicted = anchorPos + Math.min(MAX_LEAD, ((now - anchorAt) / 1000) * rate);
  const err = predicted - smooth;
  // big jump → snap; small drift → ease towards the prediction (never backwards by a hair)
  if (Math.abs(err) > JUMP) smooth = predicted;
  else smooth += err > 0 ? err : err * 0.15;
  return smooth;
}
