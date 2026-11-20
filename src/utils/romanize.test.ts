import { describe, expect, it } from 'vitest';
import { hasIndicScript, romanize } from './romanize';

describe('romanize (Hindi / Punjabi titles → Latin search keys)', () => {
  it('Devanagari', () => {
    expect(romanize('तुम ही हो')).toBe('tum hi ho');
    expect(romanize('केसरिया')).toBe('kesariya');
    expect(romanize('दिल से')).toBe('dil se');
  });
  it('Gurmukhi', () => {
    expect(romanize('ਬ੍ਰਾਉਨ ਮੁੰਡੇ')).toBe('braun munde');
    expect(romanize('ਬ੍ਰਾਊਨ ਮੁੰਡੇ')).toBe('braun munde');
    expect(romanize('ਪਿੱਛੇ')).toBe('pichhe');
  });
  it('leaves Latin text alone and detects the scripts', () => {
    expect(romanize('One Dance')).toBe('One Dance');
    expect(hasIndicScript('तुम ही हो')).toBe(true);
    expect(hasIndicScript('ਮੁੰਡੇ')).toBe(true);
    expect(hasIndicScript('Tum Hi Ho')).toBe(false);
  });
});
