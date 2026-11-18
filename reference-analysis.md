# Afterglow — Reference Video Analysis

**Source material:** the six `.mp4` files in the project root (all 720×1280 portrait phone recordings, 12.5–17.1 s long).

**Method:** FFmpeg was used to extract 12 evenly spaced frames per video across the full duration and tile them into contact sheets, followed by full-resolution crops of key moments (settings panel, clock + lyrics, notch, word highlight, constellation layout, artwork view, and lyrics over artwork).

| # | Caption burned into the video | Lighting colour | Main content shown |
|---|---|---|---|
| V1 | "Can't stop looking at my screen" | Pink → magenta → violet | Artwork view, then kinetic lyrics; clock + lyrics at the end |
| V2 | "Peak music setup" | Warm orange / amber | Artwork view, settings panel, then clock + lyrics |
| V3 | "Rate the music setup" | Electric blue (external monitor + laptop) | Lyrics over full-bleed artwork, mirrored on the laptop |
| V4 | "Music like this >>" | Warm white / pale yellow | Lyrics inside a ring over full-bleed artwork; laptop shows lyrics only |
| V5 | "The perfect late night setup" | Red | Artwork view (white + red cover), constellation-style lyrics on the laptop |
| V6 | "Ambient lighting in your Mac" | Amber with red-orange hotspots | Artwork view, settings panel, kinetic lyrics with highlight blocks |

Legend: **[O]** = directly observed in the footage. **[I]** = creative interpretation or inference.

---

## 1. Overall visual identity

- [O] Every video is filmed in a dark room. The only light sources are the screen and the glowing strip around it; the keyboard backlight is faintly visible.
- [O] The screen content is mostly black with one large element: the artwork, a few lyric words, or a clock.
- [O] Typography is heavy, rounded and sans-serif for lyrics, and light-weight for the clock.
- [I] The identity is "the display is a lamp": the UI recedes and light plus a few words carry the mood. It reads as hardware, not as an app.

## 2. Monitor-edge lighting design

- [O] One continuous glowing line traces the very edge of the display on all four sides.
- [O] On MacBooks the line **follows the notch**: it dips down around the camera housing and comes back up (V1, V2, V5, V6).
- [O] The line sits *on* the edge; there is no visible inset frame or gap.
- [O] It is visible regardless of what is on screen, including over the menu bar and over full-screen artwork.
- [I] It behaves like an LED strip glued to the bezel, not a CSS border: brightness varies along its length.

## 3. Strip thickness and position

- [O] Thin: roughly 0.3–0.5 % of the screen width on the laptop shots, about 3–6 px on a 1440p panel.
- [O] The settings panel exposes a **Thickness** slider (V2, V6), so thickness is user-controlled.
- [O] Top and bottom strips are horizontal, side strips vertical, with no visible joins.

## 4. Corner treatment and border geometry

- [O] Corners are rounded, following the rounded corners of the MacBook display.
- [O] The notch has its own rounded inner corners; the strip bends through it smoothly.
- [O] Corners and the notch often appear *brighter* than the middle of an edge (V1 notch hotspot, V6 bottom-right corner).
- [I] The brightening comes from light pooling where the line bends; a renderer should allow slight corner and notch hotspots.

## 5. RGB colour combinations

- [O] Pink fading into violet / blue-violet at the corners (V1).
- [O] Orange with red-orange sections (V2, V6).
- [O] Electric blue / cobalt (V3).
- [O] Warm white tinged pale yellow (V4).
- [O] Saturated red (V5).
- [O] The settings panel has **Primary** and **Secondary** colours, each with a brightness wheel and a hue/saturation colour wheel, plus an **"Override album color"** toggle.
- [O] In five of the six videos the strip colour matches the dominant colour of the album art on screen: pink artwork → pink, orange concert photo → orange, white + red cover → red, yellow cover → warm white, orange cover → amber. V3 (grey artwork, blue light) is the exception.
- [I] So the default behaviour is: **lighting colour follows the album artwork**, and "Override" switches to manual colours. This is the single most important behavioural insight from the references.

## 6. Light diffusion and glow

- [O] A **Glow** slider sits next to Thickness in the settings panel.
- [O] The line has a soft halo that spills a short distance onto the screen and onto the bezel. It reads as light, not as a stroke.
- [O] Glow intensity is uneven along the perimeter; some sections bloom more (bottom edge in V2 and V6, notch in V1).
- [O] Inside the screen the glow fades quickly. It does not wash over the content.
- [I] Two-radius bloom (tight + wide) with modest strength, plus slight non-uniformity, is the right model; full-screen neon washes would be wrong.

## 7. Lighting animation and transitions

- [O] The settings panel lists **Gradient** options (Default, Music Sync, 2 Colors) and **Animation** options (Music Sync … No Animation).
- [O] Colour distribution along the strip changes between frames: the violet section moves (V1) and red hotspots shift position (V6).
- [O] When the track changes, the strip colour changes with the new artwork.
- [I] Intensity follows the music in "Music Sync" mode. Exact pulse timing can't be confirmed from 30 fps phone footage with music-only audio, but the setting names make the intent explicit.
- [I] Colour changes are gradual crossfades, never hard cuts.

## 8. Music display and screen content

- [O] **Artwork view:** a medium, rounded-square album cover centred, with a thin light border; a huge blurred copy of the artwork fills the background; track title (semibold) and artist (small, grey) below; one row of small circular icon buttons under that (V2, V5, V6).
- [O] **Full-bleed artwork view:** the cover fills the screen and lyrics sit on top (V3, V4).
- [O] **Lyrics-only view:** black background, lyrics in the light colour (V1, V2, V6, and the laptops in V3/V4).
- [O] **Clock + lyrics view:** small date, large clock, lyrics below (V1, V2).
- [O] A second display can mirror the lyrics while the main one shows artwork (V3, V4).

## 9. Lyrics and typography treatment

- [O] Lyrics appear **word by word**, not line by line. Only about 2–4 words are visible at once, stacked vertically and centred.
- [O] Words in the stack have **different sizes**: the newest or most important word is much larger, earlier words smaller (e.g. "me" small above a huge "with").
- [O] Selected words get a **solid highlight block**: a rounded rectangle in the light colour behind the word, with dark text knocked out ("really", "Listen,", "yeah,", "tonight"). The block wipes in, so the first letter can be cut off mid-animation ("Listen" → "isten").
- [O] **Small pictograms** follow some words, tinted in the light colour: person after "you"/"she", aeroplane after "airport", heart before "love", ear after "Listen", house after "building", speech bubble after "talk", moon after "dream", sparkle after "beautiful"/"Stars", eye after "look".
- [O] Words enter with **motion blur / echo**: vertical smearing and ghosted duplicates mid-transition ("Sometimes still talk", "think", "commitment").
- [O] Lyric text is coloured with the lighting colour (orange text with orange light, pink text with pink light), sometimes cream or white.
- [O] **Constellation layout (V5):** words sit on small "+" nodes joined by thin straight lines across the screen, with one or two words larger ("dust", "lose").
- [O] **Ring layout (V4):** lyrics inside a circular ring over the artwork.
- [O] Typeface: very heavy rounded grotesque for lyrics, light-weight grotesque for the clock.
- [I] The style is "kinetic typography", not karaoke subtitles: rhythm and emphasis over legibility of the full line.

## 10. Clock and desktop elements

- [O] Date in the format "Sun Oct 25" (small, semibold) above a large time "12:39" in a **thin, light weight**, slightly translucent. It sits in the upper third, centred (V1, V2).
- [O] The 12-hour clock has no AM/PM marker.
- [O] A tiny line of text sits at the bottom centre of the clock view (unreadable at this resolution).
- [O] The macOS menu bar remains visible in windowed shots; in clock/lyrics views the screen is otherwise empty.
- [I] The clock view mimics a lock screen: calm, centred, very little chrome.

## 11. UI positioning and spacing

- [O] Content is centred horizontally; artwork and lyrics sit slightly above vertical centre.
- [O] The settings panel is a narrow, floating, dark, rounded panel docked to the **right** (V2, V6). Its sections, top to bottom: Gradient, Animation, Notch compatibility, Thickness, Glow, Override album color, Primary/Secondary wheels, Display.
- [O] Playback controls are a single row of small circular icon buttons under the track info, low contrast.
- [O] Generous empty space; a single focal element at a time.

## 12. Overall late-night atmosphere

- [O] Room fully dark; the screen glow is what lights the desk and keyboard.
- [O] Low overall brightness on screen; the strip and the lyrics are the brightest elements.
- [O] Warm palettes dominate (orange, amber, red, pink); blue appears once.
- [I] The mood is intimate and nocturnal: a single person, headphones on, screen as a lamp. UI should feel calm, slow and warm, never busy.

---

## Details worth implementing

1. **Lighting follows the album artwork by default**, with "Override album colour" for manual colours. [O]
2. **Notch-contour option**: the strip dips around a centred notch at the top edge. [O]
3. **Notch and corner hotspots**: slightly brighter light where the strip bends. [O]
4. **Thickness and Glow** as first-class sliders at the top of the settings. [O]
5. **Primary/Secondary colour wheels** (hue/saturation wheel + brightness) instead of plain pickers. [O]
6. **Reactivity selector** mirroring "Animation: Music Sync … No Animation": Music sync / Ambient / Static. [O]
7. **Uneven, slowly drifting brightness** along the strip, never perfectly uniform. [O]
8. **Kinetic word-stack lyrics**: 2–4 words stacked, the newest largest. [O]
9. **Highlight-block words** with knocked-out dark text and a wipe-in reveal. [O]
10. **Lyric pictograms**: small icons after keywords (love, look, talk, home, fly, dream, stars, listen, you). [O]
11. **Motion-blur / echo entrances** for lyric words. [O]
12. **Lyrics tinted with the lighting colour.** [O]
13. **Constellation lyric layout**: words on "+" nodes joined by hairlines. [O]
14. **Clock + lyrics view**: small date, large thin clock, lyrics below. [O]
15. **12-hour clock without AM/PM** in the lock-screen style. [O]
16. **Artwork view**: rounded cover with a thin light border, huge blurred artwork backdrop, semibold title, small grey artist, one row of small round controls. [O]
17. **Lyrics over full-bleed artwork** as an alternative look. [O]
18. **Right-docked, narrow, floating settings panel.** [O]
19. **Smooth colour crossfades on track change.** [I]
20. **Warm-white and electric-blue presets** alongside the warm palettes. [O]

## What the references do *not* establish

- The exact audio-to-light mapping (pulse timing, which band drives what). The phone audio is music overlaid on the video, not room audio.
- Whether lyrics are word-synced or line-synced in the source app. Words appear one at a time, which suggests word timing or an estimate.
- Exact fonts. They look like a heavy rounded grotesque (SF Pro Rounded-like) and a light grotesque for the clock; Afterglow uses open-licence fonts with the same character.
- The source app's name and branding. Afterglow reproduces interaction patterns and visual language, not another product's identity or assets. Album covers and lyrics seen in the videos are not reused.

## Round 3: frame-by-frame study of the lyric motion (V1 and V2)

**Method:** V1 (17.1 s) and V2 (12.5 s) were sampled at 4 frames per second into timestamped contact sheets, plus 2–3× crops of the lyric area at the moments words change (V1 at 5.5 s, 7.6 s, 9.1 s and 15.6 s; V2 at 5.6 s, 6.9–8.3 s, 10.6 s and 12.1 s). The earlier pass used 12 frames per video, which caught the look but not the mechanics.

### V2 "Peak music setup": a three-slot word reel (Afterglow's **Reel** style)
- [O] Exactly three slots, stacked: the **previous** word small above, the **current** word very large in the centre, the **next** word small below on a **solid accent block** with dark text.
- [O] Each sung word steps the reel up one slot in about 0.2–0.3 s. During the step the words are smeared vertically (motion blur over 2–3 frames at 24 fps). The block fades as its word grows into the centre slot.
- [O] Before a new line, its first word sits alone in the centre on a large block, like a card ("Fillin'" at 6.75 s, "You" at 10.25 s). The previous line's words are gone by then.
- [O] Previous and next words come only from the same line. At line ends the reel holds the last word until the next card appears.
- [O] Line-initial words are set in italic ("Bàby,", "Fillin'", "don't").
- [O] Filled pictograms in the accent colour: heart before "love", ⊗ before "lose", gift after "give", person after "You", person with sound waves after "baby". Leading for heart and ⊗, trailing for the rest.
- [O] Text colour is a pale cream tinted toward the light; the block and icons use the light colour itself (amber here, matching the album art and the strip).
- [O] The lock-screen clock (date plus a large thin time) sits above the reel throughout.
- [O] The settings panel's Animation menu reads Default / Music Sync / (a third, partly hidden) / No Animation, matching what Afterglow offers as Music sync / Ambient / Static.

### V1 "Can't stop looking at my screen": a stacking pile (Afterglow's **Stack** style)
- [O] A line builds up as a vertical pile of up to about four words. The **newest word is at the bottom**, on a block (magenta to violet) with pale-yellow text.
- [O] Earlier words **keep a size set by the word itself**, not by age: content words are large ("airport", "dream", "talking"), function words small ("the", "to", "hit", "you"). The pile therefore has an irregular, poster-like rhythm.
- [O] Words are **staggered left and right** of centre instead of strictly centred.
- [O] Non-current words use a two-tone gradient from the light colour to the secondary (pink to purple).
- [O] Entry: the new word rises from below with a strong vertical smear; the pile shifts up. When the next line starts, the pile blurs out and the new line's first word appears alone.
- [O] Pictograms: aeroplane after "airport", moon after "dream", speech bubble after "talk", person after "you", heart before "care", arrow before "left", people after "kids".
- [O] The opening shows lyrics laid over the full-screen album artwork (now the "Album art behind lyrics: Clear / Blurred" setting). Later the clock appears above the lyrics.

### What changed in Afterglow as a result
- New **Reel** style with the three-slot mechanics above, including the line-opening card, italics and leading/trailing icons.
- **Stack** (previously "Kinetic") rebuilt: newest at the bottom on a gradient block, size by word weight, left/right stagger, gradient type, vertical smear on entry and a blur-out on line change.
- Both styles scale their step animation to the time until the next word, so fast vocals snap and slow ones glide. The videos only show medium-tempo songs; this is an inference to keep fast songs readable.
