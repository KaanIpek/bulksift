/**
 * Design tokens.
 *
 * One place for colour, spacing and type so screens do not each invent their
 * own. The palette is dark because the app is used under a desk lamp with a
 * phone pointed at a table, and a white screen next to a glossy card is a
 * reflection waiting to happen - which the measurements say is the single most
 * damaging thing that can happen to a read.
 *
 * The accent is gold rather than the blue every app in this category uses
 * (Collectr teal, HoloDex blue, FoilSnap blue, Rare Candy indigo). Two reasons,
 * and neither is taste: on a shelf of blue icons a warm one is the one you find,
 * and gold is the colour of the thing the app is for - the card worth keeping
 * out of a box of bulk.
 */

import { Platform } from 'react-native';

export const c = {
  /** Backgrounds, darkest first. */
  bg: '#08090d',
  /** A raised surface: cards, rows, sheets. */
  surface: '#12141c',
  surfaceHi: '#1a1e29',
  /** The top layer - pressed states, floating controls. */
  surfaceTop: '#222634',
  line: '#272c3a',
  lineSoft: '#1b1f2a',

  text: '#f2f4f9',
  dim: '#98a1b8',
  faint: '#646e85',

  /** Money is green, and only money is green. */
  money: '#7ee7a8',
  moneyDim: '#3fbd75',

  /** The brand: warm, and the only warm thing on screen. */
  accent: '#f7c14b',
  accentDeep: '#c9922a',
  /** A wash of the accent, for selected chips and highlight fills. */
  accentWash: 'rgba(247,193,75,0.14)',
  accentLine: 'rgba(247,193,75,0.42)',
  /** Ink that reads on top of a solid accent fill. */
  onAccent: '#1a1204',

  warn: '#fbbf24',
  bad: '#fb7185',
  badWash: 'rgba(251,113,133,0.13)',
  good: '#34d399',
  goodWash: 'rgba(52,211,153,0.13)',

  /** Card art sits on this while it loads, and where art is missing. */
  slot: '#1c2130',
} as const;

/**
 * Rarity, as a colour.
 *
 * Collectors read rarity before they read anything else on a row, and the
 * catalogue's rarity strings are long and inconsistent ("Rare Holo VMAX",
 * "Ultra Rare", "Double Rare"). A dot in the right colour says it in 8 pixels.
 */
export function rarityTone(rarity: string | null | undefined): string {
  if (!rarity) return c.faint;
  const r = rarity.toLowerCase();
  if (r.includes('secret') || r.includes('hyper') || r.includes('rainbow')) return '#f0abfc';
  if (r.includes('illustration') || r.includes('star') || r.includes('shiny')) return '#fca5a5';
  if (r.includes('ultra') || r.includes('vmax') || r.includes('vstar') || r.includes('ex')) {
    return '#c4b5fd';
  }
  if (r.includes('double') || r.includes('holo')) return '#7dd3fc';
  if (r.includes('rare')) return '#fcd34d';
  if (r.includes('uncommon')) return '#9ca3af';
  if (r.includes('promo')) return '#5eead4';
  return '#6b7280';
}

/** A 4-point spacing scale. */
export const s = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const r = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/**
 * Money and counts are set in tabular figures.
 *
 * A column of prices where the digits are different widths does not line up,
 * and a list of prices that does not line up is unreadable at a glance - which
 * is the only way anyone reads a collection list.
 */
export const nums = { fontVariant: ['tabular-nums' as const] };

export const t = {
  hero: {
    fontSize: 38, fontWeight: '800' as const, letterSpacing: -1.1,
    ...nums,
  },
  title: { fontSize: 21, fontWeight: '800' as const, letterSpacing: -0.3 },
  subtitle: { fontSize: 17, fontWeight: '700' as const, letterSpacing: -0.2 },
  section: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.1 },
  body: { fontSize: 15, fontWeight: '600' as const },
  meta: { fontSize: 12.5, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '600' as const },
  money: { fontSize: 15, fontWeight: '700' as const, ...nums },
} as const;

/**
 * Shadows, as one token per level.
 *
 * `boxShadow` rather than the `shadow*` props: React Native has accepted the CSS
 * string since 0.76 and react-native-web now warns on the old ones, so this is
 * the single spelling both platforms agree on.
 *
 * Elevation is what separates a list of rows from a stack of objects, and this
 * app is a stack of objects.
 */
export const shadow = {
  low: { boxShadow: '0 3px 8px rgba(0,0,0,0.35)' },
  high: { boxShadow: '0 10px 24px rgba(0,0,0,0.5)' },
} as const;

/**
 * Money, formatted the way a price is read rather than the way a float prints.
 *
 * Sub-cent values round to "<$0.01" instead of "$0.00", because a bulk scan of
 * commons is full of them and a column of $0.00 makes the app look broken when
 * it is in fact correct.
 */
export function money(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v > 0 && v < 0.005) return '<$0.01';
  return `$${v.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact money for headline figures: $1.2k rather than $1,234.56. */
export function moneyShort(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v >= 100000) return `$${Math.round(v / 1000)}k`;
  if (v >= 10000) return `$${(v / 1000).toFixed(1)}k`;
  return money(v);
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Kill the focus ring a browser draws on a text field.
 *
 * `outlineStyle` is a react-native-web property that native React Native does
 * not know; spreading an empty object on the phone keeps both type-checkers
 * happy and leaves iOS's own focus behaviour alone.
 */
export const noOutline: Record<string, string> =
  Platform.OS === 'web' ? { outlineStyle: 'none' } : {};
