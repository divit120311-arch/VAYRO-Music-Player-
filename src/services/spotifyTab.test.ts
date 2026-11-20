import { describe, expect, it } from 'vitest';
import { sameText } from './spotifyTab';

describe('sameText (titles read off the screen)', () => {
  it('matches identical and differently-punctuated titles', () => {
    expect(sameText('One Dance', 'One Dance')).toBe(true);
    expect(sameText('Blinding Lights', 'blinding lights!')).toBe(true);
  });
  it('tolerates a misread letter or two', () => {
    expect(sameText('Blinding Lights', 'Blindinq Lights')).toBe(true);
    expect(sameText('Drake', 'Drakc')).toBe(true);
  });
  it('tells different songs apart', () => {
    expect(sameText('One Dance', 'Blinding Lights')).toBe(false);
    expect(sameText('Hotline Bling', 'One Dance')).toBe(false);
    expect(sameText('', 'One Dance')).toBe(false);
  });
});
