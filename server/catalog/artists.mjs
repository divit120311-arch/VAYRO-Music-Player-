// The artists Vayro's library is built around. Everything about their songs (titles, albums,
// dates, durations, artwork, previews, links) comes from Apple's catalogue at build time and is
// verified — nothing here is a song. `genres` are Apple's primary genre names, used only to pick the
// right artist when several share a name. `tags` drive the genre collections in the library.
// "international" = artists from outside the US.

/** @typedef {{ slug: string, name: string, group: 'hiphop' | 'rnb-alt' | 'pop-intl', genres: string[], tags: string[], spotifyId?: string }} ArtistDef */

/** @type {ArtistDef[]} */
export const ARTISTS = [
  // ---------------------------------------------------------------- hip-hop and rap
  { slug: 'drake', name: 'Drake', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap', 'international'], spotifyId: '3TVXtAsR1Inumwj472S9r4' },
  { slug: 'kendrick-lamar', name: 'Kendrick Lamar', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'kanye-west', name: 'Kanye West', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'], spotifyId: '5K4W6rqBFWDnAN6FQUkS6x' },
  { slug: 'travis-scott', name: 'Travis Scott', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'future', name: 'Future', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'j-cole', name: 'J. Cole', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'tyler-the-creator', name: 'Tyler, The Creator', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap', 'alternative'] },
  { slug: 'eminem', name: 'Eminem', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: '21-savage', name: '21 Savage', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'metro-boomin', name: 'Metro Boomin', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'lil-wayne', name: 'Lil Wayne', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'jay-z', name: 'JAY-Z', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'nas', name: 'Nas', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'asap-rocky', name: 'A$AP Rocky', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'playboi-carti', name: 'Playboi Carti', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'don-toliver', name: 'Don Toliver', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'childish-gambino', name: 'Childish Gambino', group: 'hiphop', genres: ['Hip-Hop/Rap', 'R&B/Soul'], tags: ['hip-hop', 'rap', 'r&b'] },
  { slug: 'juice-wrld', name: 'Juice WRLD', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'xxxtentacion', name: 'XXXTENTACION', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'post-malone', name: 'Post Malone', group: 'hiphop', genres: ['Hip-Hop/Rap', 'Pop'], tags: ['hip-hop', 'pop'] },
  { slug: 'central-cee', name: 'Central Cee', group: 'hiphop', genres: ['Hip-Hop/Rap', 'UK Hip-Hop'], tags: ['hip-hop', 'rap', 'international'] },
  { slug: 'jid', name: 'JID', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'lil-uzi-vert', name: 'Lil Uzi Vert', group: 'hiphop', genres: ['Hip-Hop/Rap'], tags: ['hip-hop', 'rap'] },
  { slug: 'nicki-minaj', name: 'Nicki Minaj', group: 'hiphop', genres: ['Hip-Hop/Rap', 'Pop'], tags: ['hip-hop', 'rap', 'pop'] },
  { slug: 'doja-cat', name: 'Doja Cat', group: 'hiphop', genres: ['Hip-Hop/Rap', 'Pop'], tags: ['hip-hop', 'rap', 'pop'] },

  // ---------------------------------------------------------------- R&B and alternative
  { slug: 'the-weeknd', name: 'The Weeknd', group: 'rnb-alt', genres: ['R&B/Soul', 'Pop'], tags: ['r&b', 'pop', 'international'], spotifyId: '1Xyo4u8uXC1ZmMpatF05PJ' },
  { slug: 'frank-ocean', name: 'Frank Ocean', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b', 'alternative'] },
  { slug: 'sza', name: 'SZA', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b'] },
  { slug: 'brent-faiyaz', name: 'Brent Faiyaz', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b'] },
  { slug: 'daniel-caesar', name: 'Daniel Caesar', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b', 'international'] },
  { slug: 'partynextdoor', name: 'PARTYNEXTDOOR', group: 'rnb-alt', genres: ['R&B/Soul', 'Hip-Hop/Rap'], tags: ['r&b', 'international'] },
  { slug: 'steve-lacy', name: 'Steve Lacy', group: 'rnb-alt', genres: ['R&B/Soul', 'Alternative'], tags: ['r&b', 'alternative', 'indie'] },
  { slug: 'giveon', name: 'Giveon', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b'] },
  { slug: 'miguel', name: 'Miguel', group: 'rnb-alt', genres: ['R&B/Soul'], tags: ['r&b'] },
  { slug: 'joji', name: 'Joji', group: 'rnb-alt', genres: ['Alternative', 'R&B/Soul', 'Pop'], tags: ['alternative', 'indie', 'r&b', 'international'] },
  { slug: 'the-neighbourhood', name: 'The Neighbourhood', group: 'rnb-alt', genres: ['Alternative'], tags: ['alternative', 'indie', 'rock'], spotifyId: '77SW9BnxLY8rJ0RciFqkHh' },
  { slug: 'arctic-monkeys', name: 'Arctic Monkeys', group: 'rnb-alt', genres: ['Alternative', 'Rock'], tags: ['alternative', 'indie', 'rock', 'international'] },
  { slug: 'chase-atlantic', name: 'Chase Atlantic', group: 'rnb-alt', genres: ['Alternative', 'Pop'], tags: ['alternative', 'international'] },
  { slug: 'lana-del-rey', name: 'Lana Del Rey', group: 'rnb-alt', genres: ['Alternative', 'Pop'], tags: ['alternative', 'pop'] },
  { slug: 'billie-eilish', name: 'Billie Eilish', group: 'rnb-alt', genres: ['Alternative', 'Pop'], tags: ['alternative', 'pop'] },
  { slug: 'rihanna', name: 'Rihanna', group: 'rnb-alt', genres: ['Pop', 'R&B/Soul'], tags: ['pop', 'r&b', 'international'] },
  { slug: 'beyonce', name: 'Beyoncé', group: 'rnb-alt', genres: ['Pop', 'R&B/Soul'], tags: ['r&b', 'pop'] },
  { slug: 'justin-bieber', name: 'Justin Bieber', group: 'rnb-alt', genres: ['Pop'], tags: ['pop', 'international'] },
  { slug: 'adele', name: 'Adele', group: 'rnb-alt', genres: ['Pop'], tags: ['pop', 'international'] },
  { slug: 'bruno-mars', name: 'Bruno Mars', group: 'rnb-alt', genres: ['Pop'], tags: ['pop', 'r&b'] },

  // ---------------------------------------------------------------- pop and international
  { slug: 'taylor-swift', name: 'Taylor Swift', group: 'pop-intl', genres: ['Pop', 'Country'], tags: ['pop'] },
  { slug: 'the-1975', name: 'The 1975', group: 'pop-intl', genres: ['Alternative', 'Pop'], tags: ['alternative', 'indie', 'pop', 'international'] },
  { slug: 'harry-styles', name: 'Harry Styles', group: 'pop-intl', genres: ['Pop'], tags: ['pop', 'international'] },
  { slug: 'dua-lipa', name: 'Dua Lipa', group: 'pop-intl', genres: ['Pop', 'Dance'], tags: ['pop', 'electronic', 'international'] },
  { slug: 'ed-sheeran', name: 'Ed Sheeran', group: 'pop-intl', genres: ['Pop', 'Singer/Songwriter'], tags: ['pop', 'international'] },
  { slug: 'olivia-rodrigo', name: 'Olivia Rodrigo', group: 'pop-intl', genres: ['Pop', 'Alternative'], tags: ['pop'] },
  { slug: 'coldplay', name: 'Coldplay', group: 'pop-intl', genres: ['Alternative', 'Rock', 'Pop'], tags: ['alternative', 'rock', 'pop', 'international'] },
  { slug: 'imagine-dragons', name: 'Imagine Dragons', group: 'pop-intl', genres: ['Alternative', 'Rock', 'Pop'], tags: ['alternative', 'rock', 'pop'] },
  { slug: 'onerepublic', name: 'OneRepublic', group: 'pop-intl', genres: ['Pop', 'Alternative', 'Rock'], tags: ['pop', 'rock'] },
  { slug: 'linkin-park', name: 'Linkin Park', group: 'pop-intl', genres: ['Alternative', 'Rock', 'Hard Rock'], tags: ['rock', 'alternative'] },
  { slug: 'cigarettes-after-sex', name: 'Cigarettes After Sex', group: 'pop-intl', genres: ['Alternative', 'Indie Pop', 'Rock'], tags: ['indie', 'alternative'] },
  { slug: 'radiohead', name: 'Radiohead', group: 'pop-intl', genres: ['Alternative', 'Rock'], tags: ['alternative', 'rock', 'indie', 'international'] },
  { slug: 'lorde', name: 'Lorde', group: 'pop-intl', genres: ['Alternative', 'Pop'], tags: ['pop', 'alternative', 'indie', 'international'] },
  { slug: 'ariana-grande', name: 'Ariana Grande', group: 'pop-intl', genres: ['Pop'], tags: ['pop', 'r&b'] },
  { slug: 'sabrina-carpenter', name: 'Sabrina Carpenter', group: 'pop-intl', genres: ['Pop'], tags: ['pop'] },
];

export const GENRE_COLLECTIONS = [
  { id: 'hip-hop', name: 'Hip-Hop' },
  { id: 'rap', name: 'Rap' },
  { id: 'r&b', name: 'R&B' },
  { id: 'alternative', name: 'Alternative' },
  { id: 'indie', name: 'Indie' },
  { id: 'pop', name: 'Pop' },
  { id: 'electronic', name: 'Electronic' },
  { id: 'rock', name: 'Rock' },
  { id: 'international', name: 'International' },
];
