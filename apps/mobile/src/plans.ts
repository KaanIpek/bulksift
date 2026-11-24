/**
 * What a subscription plan is, said the way the person paying needs to hear it.
 *
 * Until 2026-11-24 the paywall had one button, "Go Pro", with no price on it,
 * no period, and no way to choose: `subscribe()` bought whichever subscription
 * the store happened to list first. There are two - $4.99 a month and $29.99 a
 * year - so the same tap could have cost either, and the first place the amount
 * appeared was Apple's own sheet. App Review rejects that under guideline 3.1.2
 * (a subscription screen must state the price, the length, that it renews, and
 * link the terms and the privacy policy), and it would have been right to.
 *
 * Everything here is arithmetic over what the store returned, so it can be
 * tested without a sandbox account. Nothing in this file contains a price: the
 * amount and its formatted string both come from the store, in the buyer's own
 * currency, and a plan whose period cannot be read is not offered at all rather
 * than offered with a guess.
 */

export type Period = 'week' | 'month' | 'year';

export interface Plan {
  /** The store's product identifier. What gets bought. */
  id: string;
  /** The store's formatted price, e.g. "$4.99". Shown exactly as given. */
  price: string;
  /** The same price as a number, for comparing plans. Never shown. */
  amount: number;
  period: Period;
  /**
   * Length of a free trial, in days - set only when the store offers one AND
   * says this customer may still take it. Someone who has used their trial is
   * charged at once, so telling them "3 days free" would be a lie about money.
   */
  trialDays?: number;
}

/**
 * Read a billing period.
 *
 * The store gives ISO 8601 ("P1W", "P1M", "P1Y"); RevenueCat's package type is
 * the fallback when it is missing. Only the three lengths this file can
 * describe are accepted - a quarterly plan would otherwise be labelled with
 * whatever it was nearest to.
 */
export function periodOf(iso: string | null | undefined, packageType?: string | null): Period | null {
  switch ((iso ?? '').toUpperCase()) {
    case 'P1W': case 'P7D': return 'week';
    case 'P1M': return 'month';
    case 'P1Y': case 'P12M': return 'year';
    default: break;
  }
  if (iso) return null; // A period was given and it is not one of ours.
  switch ((packageType ?? '').toUpperCase()) {
    case 'WEEKLY': return 'week';
    case 'MONTHLY': return 'month';
    case 'ANNUAL': return 'year';
    default: return null;
  }
}

const UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

/**
 * Days of free trial in an introductory offer, or undefined.
 *
 * Only a FREE introduction counts. A discounted first period (99 cents, then
 * full price) is left undescribed: the label then states the full price, which
 * is more than the buyer will first be charged - wrong in the direction that
 * cannot cost anyone money.
 */
export function trialDaysOf(
  intro: { price: number; periodUnit: string; periodNumberOfUnits: number; cycles?: number } | null | undefined,
  eligible: boolean,
): number | undefined {
  if (!intro || !eligible) return undefined;
  if (intro.price !== 0) return undefined;
  const unit = UNIT_DAYS[(intro.periodUnit ?? '').toUpperCase()];
  const n = intro.periodNumberOfUnits;
  if (!unit || !(n > 0)) return undefined;
  const days = Math.round(unit * n * Math.max(1, intro.cycles ?? 1));
  return days > 0 ? days : undefined;
}

const WEEKS_IN: Record<Period, number> = { week: 1, month: 52 / 12, year: 52 };

/** What a plan costs per week, for comparing plans of different lengths. */
export const perWeek = (p: Plan): number => p.amount / WEEKS_IN[p.period];

/** Cheapest per week first, so the best value is the top row. */
export function orderPlans(plans: Plan[]): Plan[] {
  return [...plans].sort((a, b) => perWeek(a) - perWeek(b));
}

/**
 * How much less this plan costs than the dearest one, as a whole percent.
 *
 * Rounded DOWN, and nothing under 5% is claimed: "Save 50%" on a plan that
 * saves 49.9% is the kind of small lie a reviewer with a calculator finds.
 */
export function savingPercent(plan: Plan, plans: Plan[]): number {
  if (plans.length < 2) return 0;
  const dearest = Math.max(...plans.map(perWeek));
  if (!(dearest > 0)) return 0;
  const pct = Math.floor((1 - perWeek(plan) / dearest) * 100);
  return pct >= 5 ? pct : 0;
}

/** Which plan is selected when the paywall opens. */
export function defaultPlan(plans: Plan[], prefer: Period | null = null): Plan | null {
  if (!plans.length) return null;
  const wanted = prefer ? plans.find((p) => p.period === prefer) : undefined;
  return wanted ?? orderPlans(plans)[0];
}

export const planName = (p: Plan): string =>
  p.period === 'week' ? 'Weekly' : p.period === 'month' ? 'Monthly' : 'Yearly';

/** "$4.99 / month" */
export const planLine = (p: Plan): string => `${p.price} / ${p.period}`;

const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`;

/** The button. It names the price, or the trial, and never just "Go Pro". */
export function ctaLabel(p: Plan): string {
  return p.trialDays ? `Try ${days(p.trialDays)} free` : `Subscribe for ${planLine(p)}`;
}

/**
 * The sentence under the button: what is charged, when, and how it stops.
 *
 * These are the disclosures Apple's guideline 3.1.2 asks for, in one place and
 * tested, so a redesign of the screen cannot quietly drop one.
 */
export function termsLine(p: Plan): string {
  const charge = p.trialDays
    ? `Free for ${days(p.trialDays)}, then ${p.price} every ${p.period}.`
    : `${p.price} every ${p.period}.`;
  return `${charge} Renews automatically until you cancel. `
    + 'Cancel any time in your App Store account settings.';
}
