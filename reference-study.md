# Afterglow: Reference Study of the Six Videos (lyrics focus)

This study covers how the six reference videos present lyrics. It builds on [reference-analysis.md](reference-analysis.md), which covers the lighting, settings panel and general atmosphere.

**Method:**
- **Frames:** FFmpeg frames at 0.5 s intervals (2 fps) for every video. V1 and V2 were also sampled at 0.25 s (4 fps) through their lyric sections. Frames were tiled into timestamped contact sheets.
- **Close-ups:** 2–3× crops at each word change.
- **Sequences:** frames were read in order, so entrances, exits and timing could be judged from neighbouring frames, not single screenshots.
- **Notation:** **[O]** is observed in the footage. **[I]** is my interpretation or a design decision.

## The six videos

| # | File (prefix) | Caption | Length | Light | Lyric system | Afterglow look |
|---|---|---|---|---|---|---|
| V1 | `AQMWY…` | "Can't stop looking at my screen" | 17.1 s | pink → violet | **Stack**, first over the album art, then on black with a clock | **2 · Pink Artwork** |
| V2 | `AQNf2…` | "Peak music setup" | 12.5 s | warm orange | **Reel** on black, lock-screen clock above | **3 · Amber Clock** |
| V3 | `AQOAOz…` | "Rate the music setup" | 13.7 s | electric blue | **Reel straight on full-bleed artwork** (and mirrored on a laptop) | **4 · Blue Over Art** |
| V4 | `AQOMe…` | "Music like this >>" | 13.4 s | warm yellow / gold | **Reel inside the album's circular graphic**, then on black with a clock | **6 · Gold Ring** |
| V5 | `AQPL9…` | "The perfect late night setup" | 13.3 s | red | **Constellation** | **5 · Red Constellation** |
| V6 | `AQPp4…` | "Ambient lighting in your Mac" | 15.0 s | deep amber | **Reel** on black in saturated orange, notch | **1 · Orange Typography** |

Your brief numbers the modes 1–6 by visual direction. The table maps each one to its video.

## Recurring vs. unique

**Recurring** (four or more videos):
- **[O] The word reel** in V2, V3, V4 and V6.
  - Three slots: the previous word small above, the current word very large, the next word small below.
  - Each sung word moves the reel up one slot.
  - Before a line starts, its first word appears alone as a card.
- **[O] Pictograms after words.** Seen in V1, V2, V3, V4 and V6: heart before "love/care", ear after "listen", house after "building", aeroplane after "airport", moon after "dream", gift after "give", eye after "look", truck after "Vans", a person after "you/she".
- **[O] A thin glowing perimeter** that follows the album art's colour, with a notch dip at the top centre on MacBook screens.
- **[O] The lock-screen clock:** a small bold date over a large, very light time with no AM/PM. Centred, above the lyrics, in V1, V2 and V4.
- **[O] The app's player screen first** (artwork, title, controls), then the settings panel, then the lyric view.

**Unique** to one video:
- V1: the **stack** layout.
- V3: **lyrics directly on clear artwork** with no dimming.
- V4: **the reel inside a ring.** The ring belongs to that album cover, not to the app.
- V5: the **constellation**.

## Per-video findings

### V1 "Can't stop looking at my screen": Stack (pink)
- **Composition [O]:** first, full-screen album art (pink sky, cartoon figure) with lyrics on top. From about 4 s the screen is black with lyrics in the centre. From about 14 s the clock is above the lyrics.
- **Word positions [O]:**
  - A vertical pile of up to four words from the current line, with the newest at the bottom.
  - Earlier words are pushed up.
  - Words are **staggered left and right** of centre ("you" left, "really" left, "care" right, "for" left).
- **Word sizes [O]:**
  - Sizes follow the word, not its age: "airport", "dream", "talking", "kids" are big; "the", "to", "hit", "you" are small.
  - The newest word keeps that size ("for" stays small on its block).
- **Weight and spacing [O]:** heavy rounded grotesque, tight tracking, lines nearly touching (line height about 1.0).
- **Colour [O]:**
  - Older words: pink-to-lilac with a two-tone gradient.
  - Newest word: pale yellow text on a magenta-to-violet block.
  - Icons: lilac.
- **Entrance [O]:** the new word rises from below with a strong vertical smear over 2–3 frames (motion blur), and the pile shifts up.
- **Exit [O]:** when the next line starts, the whole pile blurs out and the first word of the new line appears alone.
- **Timing [O]:** each step takes about 0.2–0.3 s; line changes take about 0.3 s.
- **Border [O]:** thin pink line with a violet bottom-right corner, notch at the top centre.

### V2 "Peak music setup": Reel + clock (amber)
- **Composition [O]:** the clock is centred about 16% down the screen. The reel's centre sits about 45% down.
- **Slots and colours [O]:**
  - Previous word: small, above.
  - Current word: very large, pale peach (#f2c88a-ish).
  - Next word: small, below, on a **solid orange block** with dark text.
- **Spacing and style [O]:**
  - The three slots almost touch.
  - Line-initial words are **italic** ("Bàby,", "Fillin'", "don't").
- **Motion [O]:** a step takes about 0.2–0.3 s with vertical smear. The block fades as its word grows into the centre slot.
- **Line openings [O]:** the next line's first word waits alone, large, on a block ("Fillin'" at 6.75 s, "You" at 10.25 s).
- **Settings panel [O]:** Gradient, Animation (Default / Music Sync / … / No Animation), Notch compatibility, Thickness, Glow, Override album color, Primary/Secondary wheels.

### V3 "Rate the music setup": Reel over artwork (blue)
- **Composition [O]:**
  - Full-bleed album art (a building against cloudy sky) fills the external monitor.
  - The reel sits on top with **no dark overlay**.
  - The laptop mirrors the reel on black.
- **Type [O]:**
  - White, heavy, lowercase-friendly, with a soft dark shadow.
  - **No colour blocks.** The next word ("now") is plain, small and white.
- **Border [O]:** thin electric-blue line around the monitor. No notch on the external display.
- **[I]:** readability comes from size and weight, not from a scrim, so the artwork must stay visible.

### V4 "Music like this >>": Reel in a ring (gold)
- **Composition [O]:**
  - The album art (yellow, with a large ring and barbed-wire graphics) fills the screen.
  - The reel sits **inside the cover's circle**. The current word ("Vans") overflows the ring sideways.
- **Type [O]:**
  - Cream-white words with a soft shadow.
  - The next word ("though") sits on a **pale yellow block** with dark text.
  - Icon: a truck after "Vans", in the word's colour.
- **Later [O]:** a black screen with gold text, a highlighted block ("Stars") and the clock above.
- **Border [O]:** warm yellow perimeter.

### V5 "The perfect late night setup": Constellation (red)
- **Composition [O]:**
  - The external monitor shows the album art in the player.
  - The laptop shows the **constellation** on black, spread across about 60% of the width and 30% of the height.
- **Nodes [O]:**
  - Every word of the current line sits beside a small **four-point star**.
  - A **hairline joins the stars in word order**, zig-zagging, so lines cross.
  - The sung word becomes **large and bold**, and its node becomes a **glowing red ring** with a white star.
  - Weighty words ("lose", "dust") are medium; small words ("the", "and", "in") are small.
- **Colour [O]:** labels pale pink-grey, lines pale pink, active node red.
- **Change [O]:** the composition changes when the next line starts.
- **[I]:** showing the whole current line at once is part of the look. It is the line already being sung, so this doesn't reveal future lyrics.

### V6 "Ambient lighting in your Mac": Orange reel
- **Same reel as V2, with these differences [O]:**
  - Words are **saturated orange**, not cream.
  - No clock.
  - Notch at the top centre.
  - The opening word "Listen" is a card on a block, with an ear icon.
- **Composition [O]:** the reel is centred. Prev/current/next spacing is tight: "hard / at / buildin' 🏠".
- **Border [O]:** amber line, brighter along the bottom and at the notch.

## What the footage does not establish
- **Fonts:** the exact fonts. They look like SF Pro Rounded-style heavy type plus a light grotesque for the clock. Afterglow uses Nunito (rounded heavy) and Noto Sans Devanagari, both open licence.
- **Timing source:** whether the source app uses word timestamps or estimates them.
- **Hindi:** none of the six videos shows Hindi lyrics. Devanagari rendering follows the same visual rules: the same sizes, blocks and motion.
- **App and covers:** the source app's identity. Album covers and lyrics seen in the videos are not reused; the test screenshots use generated abstract covers and Afterglow's own sample lines.
