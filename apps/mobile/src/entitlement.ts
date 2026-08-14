/**
 * What the user is allowed to scan, and where that allowance came from.
 *
 * Pure arithmetic over a plain record. Nothing here knows about a store, an ad
 * network or a network at all - those hand it events, and it decides. That
 * split exists because this is the one part of the app that decides whether
 * someone gets what they paid for, and it has to be testable without a device,
 * a sandbox account or a live ad.
 *
 * The model:
 *
 *   Pro          removes the limit entirely, and is a subscription.
 *   Daily        a free allowance that refills once a calendar day.
 *   Credits      bought as a consumable pack, or earned by watching an ad.
 *
 * Two rules follow from "never take away something that was paid for":
 *
 *  1. The daily allowance is spent before any credit is. Credits were bought or
 *     earned; the free ration is a gift and costs nothing to burn first.
 *  2. Credits never expire and are never reset. The daily allowance resets; the
 *     balance beside it does not, and no code path here reduces it except a
 *     scan actually happening.
 *
 * Clocks are the other hazard. A device's calendar day can move backwards -
 * time zones, manual changes, an honest DST shift - and a refill keyed on
 * "is today a different string than last time" would hand out a fresh
 * allowance on every such move. So the refill also refuses to run when the
 * clock has gone backwards past the recorded day.
 */

/** The day an allowance belongs to, in the device's own calendar. */
export const dayKey = (at: number): string => {
  const d = new Date(at);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export interface Entitlement {
  /** True while a Pro subscription is active. Nothing else matters when it is. */
  pro: boolean;
  /** Scans left from today's free allowance. */
  freeLeft: number;
  /** The day `freeLeft` belongs to. */
  freeDay: string;
  /** Bought or earned scans. Never expire, never reset. */
  credits: number;
  /** Rewarded ads watched today, and the day that count belongs to. */
  adsToday: number;
  adsDay: string;
  /** Lifetime totals, for the paywall to say something true. */
  scansEver: number;
  creditsEver: number;
}

export interface Limits {
  /** Free scans per calendar day. */
  freePerDay: number;
  /** Scans granted by one rewarded ad. */
  perAd: number;
  /** How many rewarded ads may be watched in one day. */
  adsPerDay: number;
}

/**
 * 30 a day is the number a curious person can finish a small stack with, and
 * not the number someone sorting a 5,000-card box can live on - which is the
 * line the paid tier is meant to sit on. Five ads a day at 25 scans each is
 * another 125, so a patient user is never *stuck*, only slowed.
 */
export const LIMITS: Limits = {
  freePerDay: 30,
  perAd: 25,
  adsPerDay: 5,
};

export function fresh(at: number): Entitlement {
  const day = dayKey(at);
  return {
    pro: false,
    freeLeft: LIMITS.freePerDay,
    freeDay: day,
    credits: 0,
    adsToday: 0,
    adsDay: day,
    scansEver: 0,
    creditsEver: 0,
  };
}

/**
 * Refill the daily allowance if the calendar day has moved on.
 *
 * Returns the same object when nothing changed, so React does not re-render and
 * the file is not rewritten on every scan.
 *
 * A day that is *earlier* than the recorded one is a clock that went backwards,
 * not a new day. Refilling on it would turn "set the date back one day" into an
 * unlimited free tier, so the recorded day is left where it is - the user keeps
 * whatever they had, and the next genuine forward day refills as normal.
 */
export function refill(e: Entitlement, at: number, limits: Limits = LIMITS): Entitlement {
  const day = dayKey(at);
  if (day === e.freeDay && day === e.adsDay) return e;
  const forward = day > e.freeDay;
  return {
    ...e,
    freeLeft: forward ? limits.freePerDay : e.freeLeft,
    freeDay: forward ? day : e.freeDay,
    adsToday: day > e.adsDay ? 0 : e.adsToday,
    adsDay: day > e.adsDay ? day : e.adsDay,
  };
}

export type Blocked = 'none' | 'out-of-scans';

/** Whether one more card may be scanned right now. */
export function canScan(e: Entitlement): Blocked {
  if (e.pro) return 'none';
  if (e.freeLeft > 0 || e.credits > 0) return 'none';
  return 'out-of-scans';
}

/** How many scans are left, or null when there is no limit. */
export function scansLeft(e: Entitlement): number | null {
  if (e.pro) return null;
  return e.freeLeft + e.credits;
}

/**
 * Spend one scan.
 *
 * The free ration goes first: it was a gift and it expires tonight anyway,
 * while a credit was bought or earned and keeping it costs the user nothing.
 * Spending them the other way round would quietly destroy paid value every
 * single day, which is the kind of thing nobody notices and everybody resents.
 */
export function spend(e: Entitlement): Entitlement {
  if (e.pro) return { ...e, scansEver: e.scansEver + 1 };
  if (e.freeLeft > 0) {
    return { ...e, freeLeft: e.freeLeft - 1, scansEver: e.scansEver + 1 };
  }
  if (e.credits > 0) {
    return { ...e, credits: e.credits - 1, scansEver: e.scansEver + 1 };
  }
  // Nothing to spend. The caller should have asked `canScan` first; returning
  // the record unchanged means a bug here cannot go negative.
  return e;
}

/**
 * Give a scan back.
 *
 * Used when the app itself was wrong - a read the user removes from the feed
 * because it was never a card. Charging an allowance for the app's own mistake
 * turns a limit into a grievance.
 *
 * It returns to the pot the scan most likely came from. `spend` takes from the
 * free ration first, so a ration below its cap means the last scan came from
 * there; a full ration means it must have come from credits. Undo is
 * last-in-first-out in practice - you remove the card you just scanned - so
 * that inverse is exact for the case this exists to serve, and errs towards
 * the *user* in the case it is not: a credit is worth more than a free scan
 * that expires tonight.
 */
export function refund(e: Entitlement, limits: Limits = LIMITS): Entitlement {
  if (e.pro) return { ...e, scansEver: Math.max(0, e.scansEver - 1) };
  const scansEver = Math.max(0, e.scansEver - 1);
  if (e.freeLeft < limits.freePerDay) {
    return { ...e, freeLeft: e.freeLeft + 1, scansEver };
  }
  return { ...e, credits: e.credits + 1, scansEver };
}

/** Whether another rewarded ad may be watched today. */
export function canWatchAd(e: Entitlement, limits: Limits = LIMITS): boolean {
  return !e.pro && e.adsToday < limits.adsPerDay;
}

/**
 * Credit a rewarded ad.
 *
 * Called only from the ad SDK's *earned-reward* callback - not from "the ad was
 * shown" and not from "the ad was dismissed", which both fire when someone
 * closes a video after two seconds.
 */
export function grantAd(e: Entitlement, limits: Limits = LIMITS): Entitlement {
  if (!canWatchAd(e, limits)) return e;
  return {
    ...e,
    credits: e.credits + limits.perAd,
    creditsEver: e.creditsEver + limits.perAd,
    adsToday: e.adsToday + 1,
  };
}

/** Credit a bought pack. `n` comes from the product, not from the caller's UI. */
export function grantPack(e: Entitlement, n: number): Entitlement {
  if (!(n > 0)) return e;
  return { ...e, credits: e.credits + n, creditsEver: e.creditsEver + n };
}

/**
 * Set the subscription state from the store.
 *
 * Losing Pro must not touch credits. A lapsed subscriber who had also bought a
 * pack still owns that pack, and a renewal failure is not a reason to take it.
 */
export function setPro(e: Entitlement, pro: boolean): Entitlement {
  return e.pro === pro ? e : { ...e, pro };
}

/**
 * What a limit-aware screen should say.
 *
 * Kept here rather than in a component so the wording is one thing, tested
 * once, rather than four screens each inventing their own way to say the same
 * arithmetic.
 */
export function allowanceLabel(e: Entitlement, limits: Limits = LIMITS): string {
  if (e.pro) return 'Pro · unlimited scans';
  const left = e.freeLeft + e.credits;
  if (left === 0) return 'No scans left today';
  const parts: string[] = [];
  if (e.freeLeft > 0) parts.push(`${e.freeLeft} free today`);
  if (e.credits > 0) parts.push(`${e.credits} credit${e.credits === 1 ? '' : 's'}`);
  void limits;
  return parts.join(' · ');
}

/** Repair anything read off disk, so a corrupt file cannot grant or steal. */
export function normalise(raw: unknown, at: number): Entitlement {
  const base = fresh(at);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<Entitlement>;
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  return {
    pro: r.pro === true,
    freeLeft: Math.min(num(r.freeLeft, base.freeLeft), LIMITS.freePerDay),
    freeDay: typeof r.freeDay === 'string' ? r.freeDay : base.freeDay,
    credits: num(r.credits, 0),
    adsToday: Math.min(num(r.adsToday, 0), LIMITS.adsPerDay),
    adsDay: typeof r.adsDay === 'string' ? r.adsDay : base.adsDay,
    scansEver: num(r.scansEver, 0),
    creditsEver: num(r.creditsEver, 0),
  };
}
