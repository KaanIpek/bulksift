/**
 * Design tokens.
 *
 * One place for colour, spacing and type so screens do not each invent their
 * own. The palette is dark because the app is used under a desk lamp with a
 * phone pointed at a table, and a white screen next to a glossy card is a
 * reflection waiting to happen - which the measurements say is the single most
 * damaging thing that can happen to a read.
 */

export const c = {
  /** Backgrounds, darkest first. */
  bg: '#0b0e14',
  surface: '#131824',
  surfaceHi: '#1a2131',
  line: '#242c3d',
  lineSoft: '#1c2334',

  text: '#e7ecf5',
  dim: '#8b97b0',
  faint: '#5e6a80',

  /** Money is green, and only money is green. */
  money: '#86efac',
  moneyDim: '#4ade80',

  accent: '#5cc8ff',
  accentDim: '#1d4ed8',
  warn: '#fbbf24',
  bad: '#f87171',
  good: '#22c55e',
  goodBg: '#166534',
} as const;

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
  pill: 999,
} as const;

export const t = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const },
  section: { fontSize: 12, fontWeight: '700' as const, letterSpacing: 0.8 },
  body: { fontSize: 15, fontWeight: '600' as const },
  meta: { fontSize: 12.5, fontWeight: '500' as const },
  tiny: { fontSize: 11, fontWeight: '500' as const },
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
