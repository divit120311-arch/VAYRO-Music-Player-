import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// a stand-in for the real player: the clock only reads currentTime, paused and playbackRate
const player = vi.hoisted(() => ({ currentTime: 0, paused: true, playbackRate: 1 }));
vi.mock('./audioEngine', () => ({ audioEngine: player }));

let now = 0;
const frame = (ms = 16) => {
  now += ms;
};

describe('playbackTime', () => {
  let playbackTime: () => number;
  beforeEach(async () => {
    vi.resetModules();
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    Object.assign(player, { currentTime: 0, paused: true, playbackRate: 1 });
    ({ playbackTime } = await import('./playbackClock'));
  });
  afterEach(() => vi.restoreAllMocks());

  it('paused: returns exactly the player position, and holds it', () => {
    player.currentTime = 42.5;
    frame();
    expect(playbackTime()).toBe(42.5);
    frame(500);
    expect(playbackTime()).toBe(42.5);
  });

  it('playing: moves smoothly between coarse position reports (no stair-steps)', () => {
    player.paused = false;
    player.currentTime = 10;
    frame();
    expect(playbackTime()).toBeCloseTo(10, 3);
    // the element reports nothing new for 3 frames, yet time advances
    frame(16);
    const a = playbackTime();
    frame(16);
    const b = playbackTime();
    expect(a).toBeCloseTo(10.016, 3);
    expect(b).toBeCloseTo(10.032, 3);
    // a fresh report that agrees: no jump
    player.currentTime = 10.048;
    frame(16);
    expect(playbackTime()).toBeCloseTo(10.048, 3);
  });

  it('seek: jumps immediately to the new position (forwards and backwards)', () => {
    player.paused = false;
    player.currentTime = 10;
    frame();
    playbackTime();
    player.currentTime = 95;
    frame();
    expect(playbackTime()).toBeCloseTo(95, 2);
    player.currentTime = 3;
    frame();
    expect(playbackTime()).toBeCloseTo(3, 2);
  });

  it('never runs more than 0.25 s ahead of a stalled (buffering) player', () => {
    player.paused = false;
    player.currentTime = 20;
    frame();
    playbackTime();
    for (let i = 0; i < 120; i++) {
      frame(16); // 2 s with no new position from the player
      playbackTime();
    }
    expect(playbackTime()).toBeLessThanOrEqual(20.25 + 1e-9);
  });

  it('follows the playback rate', () => {
    player.paused = false;
    player.playbackRate = 2;
    player.currentTime = 5;
    frame();
    playbackTime();
    frame(100);
    expect(playbackTime()).toBeCloseTo(5.2, 3);
  });

  it('does not drift over a long session: tracks the player exactly when it reports every frame', () => {
    player.paused = false;
    player.currentTime = 0;
    for (let i = 0; i < 60 * 60 * 5; i++) {
      // 5 minutes at 60 fps; the real position advances 1/60 s per frame
      frame(1000 / 60);
      player.currentTime += 1 / 60;
      playbackTime();
    }
    expect(Math.abs(playbackTime() - player.currentTime)).toBeLessThan(0.02);
  });
});
