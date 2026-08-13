/**
 * What the collection was worth, day by day.
 *
 * Every competitor sells "5 years of price history" and none of it is
 * derivable from what this app has: one price snapshot, shipped with the build.
 * Inventing a curve from a single point would be a drawn lie, so this records
 * the real thing instead - one point per day, from the day the feature ships,
 * measured from the collection itself.
 *
 * That makes it honest and, for the thing a collector actually asks ("is my
 * collection up or down"), it becomes useful after a week and better than a
 * purchased curve after a month, because it follows *their* cards.
 */

export interface Point {
  /** Local calendar day, YYYY-MM-DD. One point per day, last write wins. */
  day: string;
  value: number;
  cards: number;
}

/** Keep two years. A point is ~40 bytes, so this is a rounding error on disk. */
const MAX_POINTS = 730;

export const dayOf = (at: number): string => {
  const d = new Date(at);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/**
 * Record today's total, replacing today's earlier point if there is one.
 *
 * Returns the same array when nothing changed, so React does not re-render and
 * the file is not rewritten on every scan.
 */
export function record(points: Point[], value: number, cards: number, at: number): Point[] {
  const day = dayOf(at);
  const last = points[points.length - 1];
  if (last && last.day === day) {
    if (last.value === value && last.cards === cards) return points;
    const next = points.slice(0, -1);
    next.push({ day, value, cards });
    return next;
  }
  const next = [...points, { day, value, cards }];
  return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
}

export interface Change {
  /** Absolute change over the window, in dollars. */
  delta: number;
  /** Proportional change, or null when the earlier value was zero. */
  fraction: number | null;
  /** The day the comparison was made against. */
  since: string;
  /** How many days of history the answer actually rests on. */
  span: number;
}

/**
 * Change over roughly `days`, against the oldest point still inside the window.
 *
 * Returns null rather than guessing when there is nothing to compare to. A
 * collection recorded for two days cannot report a monthly change, and saying
 * so is more useful than a number that looks like one.
 */
export function changeOver(points: Point[], days: number, now: number): Change | null {
  if (points.length < 2) return null;
  const cutoff = dayOf(now - days * 86400000);
  // The oldest point that is still no older than the window, falling back to
  // the very first point when the whole history is shorter than the window.
  let base = points.find((p) => p.day >= cutoff) ?? points[0];
  if (base === points[points.length - 1]) base = points[points.length - 2];
  const latest = points[points.length - 1];
  if (!base || base === latest) return null;

  const delta = latest.value - base.value;
  return {
    delta,
    fraction: base.value > 0 ? delta / base.value : null,
    since: base.day,
    span: Math.max(1, Math.round((Date.parse(latest.day) - Date.parse(base.day)) / 86400000)),
  };
}

/**
 * Points laid out for a sparkline: x in 0..1 across time, y in 0..1 by value.
 *
 * The y range is padded so a flat line sits in the middle rather than on the
 * floor, and a single point returns nothing to draw - a chart of one day is a
 * dot pretending to be a trend.
 */
export function spark(points: Point[], samples = 40): Array<{ x: number; y: number }> {
  if (points.length < 2) return [];
  const take = points.length <= samples
    ? points
    : Array.from({ length: samples }, (_, i) =>
        points[Math.round((i * (points.length - 1)) / (samples - 1))]);

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of take) {
    if (p.value < lo) lo = p.value;
    if (p.value > hi) hi = p.value;
  }
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.1) : (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;

  const n = take.length - 1;
  return take.map((p, i) => ({
    x: n === 0 ? 0 : i / n,
    y: (p.value - lo) / (hi - lo),
  }));
}

export interface Series {
  points: Array<{ x: number; y: number }>;
  /** The real values at the bottom and top of the plot, for the axis. */
  low: number;
  high: number;
  /** First and last day in the window, for the captions under it. */
  from: string;
  to: string;
  /** How many days the window actually holds. */
  days: number;
}

/**
 * The last `days` of history, ready to plot, or null when there is too little.
 *
 * `days` of Infinity means everything. The window is taken from the end rather
 * than from a date, because a gap in recording - the app not opened for a week
 * - should not blank the chart; the points that exist are the points shown.
 */
export function series(points: Point[], days: number, samples = 46): Series | null {
  if (points.length < 2) return null;
  const cutoff = Number.isFinite(days)
    ? dayOf(Date.parse(`${points[points.length - 1].day}T00:00:00`) - days * 86400000)
    : '';
  const win = points.filter((p) => p.day >= cutoff);
  if (win.length < 2) return null;

  const drawn = spark(win, samples);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of win) {
    if (p.value < lo) lo = p.value;
    if (p.value > hi) hi = p.value;
  }
  // spark() pads the range so a flat line does not sit on the floor; the axis
  // labels have to report the same padded range or they would not match the
  // heights drawn against them.
  const pad = hi === lo ? Math.max(1, Math.abs(hi) * 0.1) : (hi - lo) * 0.12;
  return {
    points: drawn,
    low: lo - pad,
    high: hi + pad,
    from: win[0].day,
    to: win[win.length - 1].day,
    days: win.length,
  };
}

/** "3 Aug" - short enough for a chart caption. */
export function shortDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${MONTHS[m - 1]}`;
}
