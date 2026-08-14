/**
 * Deciding what to do about prices. The fetching lives in `pricesStore.ts`.
 *
 * The index and the card metadata are fixed for a build; prices are not. A
 * snapshot ships inside the app so a fresh install works offline on day one,
 * and a refresh replaces it with something newer.
 *
 * WHAT IT COSTS US, since that decides the whole design:
 *
 *   The data comes from tcgcsv.com, a free mirror of TCGplayer's price feed
 *   (TCGplayer's own API is closed to new applications). Refreshing the whole
 *   catalogue is about 220 small requests, run once a day by a scheduled job -
 *   not by the app. No API key, no per-call charge.
 *
 *   What the app downloads is one file. Measured on the current data: 1.73 MB
 *   raw, 0.26 MB gzipped, and gzip is what crosses the wire because every
 *   static host does it. Ten thousand people refreshing daily is about 78 GB a
 *   month, and on Cloudflare R2 - whose egress is free - that costs nothing.
 *   Storage for a 2 MB file is a rounding error.
 *
 *   So serving a price refresh is free. That is not a footnote, it decides the
 *   policy: an app whose prices are stale is not a limited app, it is a wrong
 *   one, and charging to make it correct is charging to fix a defect. The
 *   competitors agree - Collectr sells five years of price HISTORY while
 *   current prices are free, and HoloDex shows "last update 24h ago" to
 *   everyone.
 *
 * So everyone gets a daily refresh, automatically. Pro gets it on demand, which
 * is a convenience rather than a correctness fix.
 *
 * A ~100 byte manifest is checked before the file is fetched at all, so on most
 * days most users transfer a tenth of a kilobyte.
 */

import type { PriceBook } from '@bulksift/core';

export interface PriceState {
  /** The date of the book currently in use. */
  updated: string;
  /** When the app last successfully checked, epoch ms, or 0 for never. */
  checkedAt: number;
}

export type RefreshOutcome =
  | { status: 'updated'; book: PriceBook }
  | { status: 'current' }
  | { status: 'unavailable'; reason: string };

/**
 * Whether a downloaded book may replace the one in use.
 *
 * The failure this prevents is a truncated or half-written file taking over: the
 * app would come up with a third of its cards unpriced and a headline total that
 * had quietly lost thousands of dollars, with nothing on screen to say why.
 * Refusing leaves yesterday's prices in place - wrong by a day rather than
 * wrong by a third.
 */
export function acceptable(book: unknown, against: PriceBook | null): boolean {
  if (!book || typeof book !== 'object') return false;
  const b = book as Partial<PriceBook>;
  if (typeof b.updated !== 'string' || !b.prices || typeof b.prices !== 'object') return false;
  const n = Object.keys(b.prices).length;
  if (n < 1000) return false;
  if (against) {
    const had = Object.keys(against.prices).length;
    // A feed that lost a tenth of its cards is a bad fetch, not news.
    if (had > 0 && n < had * 0.9) return false;
  }
  return true;
}

/** Whether an automatic check is due, in the device's own calendar day. */
export function refreshDue(state: PriceState, at: number): boolean {
  if (!state.checkedAt) return true;
  const day = (t: number) => new Date(t).toDateString();
  return day(state.checkedAt) !== day(at);
}

/**
 * Whole days between the date a file was built and a moment in time.
 *
 * Days, not elapsed hours. The file carries a date - "2026-08-13" - and nothing
 * finer, so any answer computed from hours invents precision the data does not
 * have. Anchoring the file at noon and flooring the elapsed time made a file
 * built yesterday morning read as "updated today", which is the app telling a
 * small lie about the only thing that makes its prices trustworthy.
 */
export function daysOld(updated: string, at: number): number {
  const [y, m, d] = updated.split('-').map(Number);
  if (!y || !m || !d) return Number.NaN;
  const built = Date.UTC(y, m - 1, d);
  const now = new Date(at);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - built) / 86400000);
}

/** "updated 3 days ago", for the line under a total that claims to be money. */
export function freshness(updated: string, at: number): string {
  const days = daysOld(updated, at);
  if (!Number.isFinite(days)) return `updated ${updated}`;
  if (days <= 0) return 'updated today';
  if (days === 1) return 'updated yesterday';
  if (days < 30) return `updated ${days} days ago`;
  const months = Math.round(days / 30);
  return `updated ${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * How old a price file may get before the total stops being trustworthy.
 *
 * Not a hard limit - a stale price beats no price - but past this the app says
 * so beside the number rather than presenting a month-old figure as today's
 * money.
 */
export const STALE_AFTER_DAYS = 10;

export function isStale(updated: string, at: number): boolean {
  const days = daysOld(updated, at);
  return !Number.isFinite(days) || days > STALE_AFTER_DAYS;
}
