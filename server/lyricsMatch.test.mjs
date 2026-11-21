import { describe, expect, it } from 'vitest';
import { artistMatches, lyricLanguage, rankLyrics } from './index.mjs';

describe('artistMatches (lyrics must be by the artist asked for)', () => {
  it('accepts the same artist, other spellings and any shared name', () => {
    expect(artistMatches('Drake', 'Drake')).toBe(true);
    expect(artistMatches('Talwinder', 'Afusic ,Talwiinder')).toBe(true);
    expect(artistMatches('Zehr Vibe, Intense, Sardar Khehra', 'Zehr Vibe & Intense')).toBe(true);
    expect(artistMatches('AP Dhillon, Gurinder Gill, Shinda Kahlon', 'AP Dhillon')).toBe(true);
    expect(artistMatches('Mithoon & Arijit Singh', 'Arijit Singh')).toBe(true);
  });
  it('rejects another artist with a song of the same title (the "Sensation" mix-up)', () => {
    expect(artistMatches('Zehr Vibe, Intense, Sardar Khehra', 'PLUM')).toBe(false);
    expect(artistMatches('iS)', 'PLUM')).toBe(false);
    expect(artistMatches('Drake', 'Rockabye Baby!')).toBe(false);
    expect(artistMatches('', 'Drake')).toBe(false);
  });
});

describe('lyrics language (real words, not a translation)', () => {
  const english = 'Because you are the one, my love\nYou are the one I need\nWithout you my heart can never be whole\nI will stay with you all my life';
  const hinglish = 'Hum tere bin ab reh nahi sakte\nTere bina kya wajood mera\nTujhse juda agar ho jaayenge\nToh khud se hi ho jaayenge judaa';
  it('tells Hinglish from English', () => {
    expect(lyricLanguage(english)).toBe('english');
    expect(lyricLanguage(hinglish)).toBe('roman');
    expect(lyricLanguage('हम तेरे बिन अब रह नहीं सकते')).toBe('indic');
  });
  it('prefers the Hinglish version of a Hindi song over an English translation', () => {
    const v = (id, text) => ({ id, trackName: 'Tum Hi Ho', artistName: 'Arijit Singh', duration: 262, syncedLyrics: text });
    const picked = rankLyrics([v(1, english), v(2, hinglish)], { title: 'Tum Hi Ho', artist: 'Arijit Singh', duration: 262, script: 'latin' })[0];
    expect(picked.id).toBe(2);
  });
});
