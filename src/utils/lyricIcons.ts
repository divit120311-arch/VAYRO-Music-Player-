import {
  Baby, Building2, Car, CircleX, Ear, Eye, Flame, Gift, Heart, Home, Moon, MessageCircle, Music2, Plane, Sparkles, Sun, User, Users, type LucideIcon,
} from 'lucide-react';

/**
 * Small pictograms that follow certain words, as in the reference videos
 * ("airport ✈", "listen 👂", "love ♥", "give 🎁", "lose ⊗", "you 👤"…).
 * Matching is on the bare lowercase word.
 */
const MAP: [RegExp, LucideIcon][] = [
  [/^(love|loved|loving|heart|hearts|lover|feel|feeling|feelings)$/, Heart],
  [/^(listen|listening|hear|heard|ears?)$/, Ear],
  [/^(look|looking|see|seen|eyes?|watch|watching)$/, Eye],
  [/^(talk|talking|say|said|call|called|tell|told|text|words?)$/, MessageCircle],
  [/^(home|house|building|room)$/, Home],
  [/^(fly|flying|flew|airport|plane|flight|sky)$/, Plane],
  [/^(dream|dreams|dreaming|night|nights|tonight|moon|sleep)$/, Moon],
  [/^(star|stars|beautiful|shine|shining|glow|glowing|light|lights|bright|brighter|afterglow)$/, Sparkles],
  [/^(fire|burn|burning|flame|flames|hot)$/, Flame],
  [/^(sun|sunrise|morning|day)$/, Sun],
  [/^(city|cities|town|downtown)$/, Building2],
  [/^(car|drive|driving|ride|riding)$/, Car],
  [/^(kids?|child|children|baby)$/, Baby],
  [/^(give|giving|gave|gift|gifts)$/, Gift],
  [/^(lose|losing|lost|never|no|nothing)$/, CircleX],
  [/^(we|us|everybody|everyone|together|friends)$/, Users],
  [/^(you|she|he|her|him|me|girl|boy)$/, User],
  [/^(song|songs|music|sing|singing|bass|beat)$/, Music2],
];

/** icons that read better in front of the word (♥ love, ⊗ lose), as in the reference */
export const LEADING_ICONS: ReadonlySet<LucideIcon> = new Set([Heart, CircleX]);

export function iconFor(word: string): LucideIcon | null {
  const w = word.toLowerCase().replace(/[^a-z']/g, '').replace(/'s$/, '');
  if (!w) return null;
  for (const [re, icon] of MAP) if (re.test(w)) return icon;
  return null;
}
