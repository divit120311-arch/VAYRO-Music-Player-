import { describe, expect, it } from 'vitest';
import { QualityGovernor, estimateQuality } from './quality';

describe('estimateQuality (hardware ceiling)', () => {
  it('software rendering → performance', () => {
    expect(estimateQuality({ cores: 8, memoryGB: 8, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).toBe('performance');
    expect(estimateQuality({ cores: 8, memoryGB: 8, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe('performance');
  });
  it('2 cores, 2 GB or data saver → performance', () => {
    expect(estimateQuality({ cores: 2, memoryGB: 8 })).toBe('performance');
    expect(estimateQuality({ cores: 8, memoryGB: 2 })).toBe('performance');
    expect(estimateQuality({ cores: 8, memoryGB: 8, saveData: true })).toBe('performance');
  });
  it('older Intel integrated graphics / 4 GB / 4 cores → balanced', () => {
    expect(estimateQuality({ cores: 8, memoryGB: 8, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toBe('balanced');
    expect(estimateQuality({ cores: 4, memoryGB: 8, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650)' })).toBe('balanced');
    expect(estimateQuality({ cores: 8, memoryGB: 4, gpu: 'ANGLE (AMD, Radeon RX 6600)' })).toBe('balanced');
  });
  it('Apple Silicon, Iris Xe and discrete GPUs with enough cores → ultra', () => {
    expect(estimateQuality({ cores: 8, memoryGB: 8, gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)' })).toBe('ultra');
    expect(estimateQuality({ cores: 12, memoryGB: 8, gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)' })).toBe('ultra');
    expect(estimateQuality({ cores: 16, memoryGB: 8, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060)' })).toBe('ultra');
  });
  it('unknown signals (Safari / Firefox hide memory) default sensibly', () => {
    expect(estimateQuality({ cores: 8 })).toBe('ultra');
    expect(estimateQuality({})).toBe('balanced');
  });
});

/** feed `seconds` one-second samples starting at `t0`; returns the time after the last one */
function run(g: QualityGovernor, t0: number, seconds: number, drawn: number, wanted = 60) {
  const changes: string[] = [];
  for (let i = 0; i < seconds; i++) {
    const c = g.sample(t0 + i, drawn, wanted);
    if (c) changes.push(c);
  }
  return { t: t0 + seconds, changes };
}

describe('QualityGovernor (Auto, with hysteresis)', () => {
  it('ignores short dips (opening a panel, a GC pause)', () => {
    const g = new QualityGovernor('ultra');
    let t = run(g, 100, 4, 20).t; // 4 s of stutter
    t = run(g, t, 3, 60).t;
    expect(run(g, t, 3, 20).changes).toEqual([]); // and 3 more: never 5 in a row
    expect(g.level).toBe('ultra');
  });

  it('steps down one level after 5 s of real stutter', () => {
    const g = new QualityGovernor('ultra');
    expect(run(g, 100, 5, 30).changes).toEqual(['balanced']);
  });

  it('waits 20 s before changing again (no flapping)', () => {
    const g = new QualityGovernor('ultra');
    const a = run(g, 100, 5, 30); // → balanced at t=104
    const b = run(g, a.t, 10, 30); // still slow, but inside the cooldown
    expect(b.changes).toEqual([]);
    const c = run(g, b.t, 10, 30); // cooldown over → performance
    expect(c.changes).toEqual(['performance']);
  });

  it('counts a capped rate that is met as healthy (30 of 30 is fine)', () => {
    const g = new QualityGovernor('performance');
    expect(run(g, 100, 30, 30, 30).changes).toEqual([]);
  });

  it('steps back up only after 40 s of smooth frames, never above the hardware ceiling', () => {
    const g = new QualityGovernor('balanced');
    let t = run(g, 100, 5, 20).t; // → performance
    expect(g.level).toBe('performance');
    const up = run(g, t + 20, 40, 60);
    expect(up.changes).toEqual(['balanced']);
    t = up.t;
    expect(run(g, t + 30, 120, 60).changes).toEqual([]); // ceiling is balanced: stays there
    expect(g.level).toBe('balanced');
  });
});
