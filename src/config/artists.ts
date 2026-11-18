import type { CSSProperties } from 'react';

export interface ArtistTheme {
  slug: string;
  name: string;
  tagline: string;
  /** verified against Spotify's official oEmbed endpoint */
  spotifyId: string;
  /** name typography */
  nameStyle: CSSProperties;
  /** page background */
  background: string;
  accent: string;
  accent2: string;
  /** applied to artwork on the page (e.g. monochrome for The Neighbourhood) */
  artFilter?: string;
  /** "Light the room" palette */
  light: { primary: string; secondary: string };
  /** text colour on the page */
  ink: string;
}

export const ARTISTS: ArtistTheme[] = [
  {
    slug: 'kanye-west',
    name: 'Kanye West',
    tagline: 'Experimental · maximal · album-as-artwork',
    spotifyId: '5K4W6rqBFWDnAN6FQUkS6x',
    nameStyle: { fontFamily: "'Anton', Impact, 'Arial Narrow', sans-serif", textTransform: 'uppercase', letterSpacing: '0.005em', lineHeight: 0.86, fontWeight: 400 },
    background: 'radial-gradient(120% 90% at 85% 10%, rgba(217,199,163,0.16), transparent 55%), radial-gradient(90% 80% at 0% 100%, rgba(120,84,40,0.22), transparent 60%), #0b0a08',
    accent: '#e3d3b0',
    accent2: '#8a6a3f',
    artFilter: 'contrast(1.06) saturate(1.05)',
    light: { primary: '#ffd9a0', secondary: '#a8682a' },
    ink: '#f2ead9',
  },
  {
    slug: 'drake',
    name: 'Drake',
    tagline: 'Minimal · atmospheric · after-hours',
    spotifyId: '3TVXtAsR1Inumwj472S9r4',
    nameStyle: { fontFamily: "'Inter Tight Variable', system-ui, sans-serif", fontWeight: 200, textTransform: 'uppercase', letterSpacing: '0.32em', lineHeight: 1 },
    background: 'radial-gradient(110% 80% at 80% 0%, rgba(201,178,139,0.13), transparent 55%), radial-gradient(100% 90% at 0% 100%, rgba(63,90,122,0.28), transparent 60%), #07090c',
    accent: '#cdb68d',
    accent2: '#4d6a8f',
    light: { primary: '#d8b47a', secondary: '#3c5f8f' },
    ink: '#ece7de',
  },
  {
    slug: 'the-weeknd',
    name: 'The Weeknd',
    tagline: 'Cinematic · red · neon noir',
    spotifyId: '1Xyo4u8uXC1ZmMpatF05PJ',
    nameStyle: {
      fontFamily: "'Inter Tight Variable', system-ui, sans-serif",
      fontWeight: 900,
      fontStyle: 'italic',
      letterSpacing: '-0.045em',
      lineHeight: 0.9,
      color: '#ff2a3a',
      textShadow: '0 0 18px rgba(255,30,45,0.65), 0 0 60px rgba(255,30,45,0.35)',
    },
    background: 'radial-gradient(90% 70% at 70% 30%, rgba(255,24,40,0.2), transparent 60%), radial-gradient(60% 60% at 10% 90%, rgba(255,90,40,0.1), transparent 60%), #050203',
    accent: '#ff2a3a',
    accent2: '#ff7a3d',
    artFilter: 'contrast(1.1) saturate(1.15)',
    light: { primary: '#ff1e2d', secondary: '#7a0010' },
    ink: '#f6e9ea',
  },
  {
    slug: 'the-neighbourhood',
    name: 'The Neighbourhood',
    tagline: 'Monochrome · dark indie · black & white',
    spotifyId: '77SW9BnxLY8rJ0RciFqkHh',
    nameStyle: { fontFamily: "'Instrument Serif', Georgia, 'Times New Roman', serif", fontStyle: 'italic', fontWeight: 400, letterSpacing: '-0.01em', lineHeight: 0.92 },
    background: 'radial-gradient(100% 80% at 50% 0%, rgba(255,255,255,0.07), transparent 60%), #060606',
    accent: '#ededed',
    accent2: '#7b7b7b',
    artFilter: 'grayscale(1) contrast(1.12)',
    light: { primary: '#f4f1ea', secondary: '#6f6f6f' },
    ink: '#f1f1f1',
  },
];

export const ARTIST_BY_SLUG = Object.fromEntries(ARTISTS.map((a) => [a.slug, a])) as Record<string, ArtistTheme>;

export const spotifyArtistUrl = (id: string) => `https://open.spotify.com/artist/${id}`;
export const spotifyEmbedUrl = (id: string) => `https://open.spotify.com/embed/artist/${id}?utm_source=generator&theme=0`;
export const spotifySearchUrl = (q: string) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;
