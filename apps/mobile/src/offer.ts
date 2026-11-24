/**
 * Which offer this install is on: how many scans are free, and whether the
 * paywall introduces itself.
 *
 * WHY THERE IS MORE THAN ONE
 *
 * The launch offer - 30 free scans a day, a paywall only when they run out -
 * was chosen in August against apps people find by searching. Research on
 * 2026-11-24 found that the scanners which have grown since 2025 do not get
 * their customers from search: they buy installs with Meta ads and meet them
 * with a paywall in onboarding and a weekly plan. An install that cost a few
 * dollars and then scans 900 cards a month for nothing cannot pay for itself.
 *
 * So a paid test needs a tighter offer, and whether to run one - and what it
 * should cost - is the owner's decision, not this file's. What this file does
 * is make the decision cheap to carry out: both offers are in the binary, and a
 * one-line file on the price host says which is live. Changing it needs no
 * build and no review, and changing it back is the same edit.
 *
 * WHAT THE REMOTE FILE CAN AND CANNOT DO
 *
 * It names an offer that is already in this file. It cannot supply numbers.
 * A host that is wrong, hacked, or returns a cached error page can therefore
 * only ever select between two offers that were both reviewed and shipped, and
 * anything it says that is not exactly one of their names is ignored.
 */

import type { Entitlement, Limits } from './entitlement';
import type { Period } from './plans';

export type OfferId = 'launch' | 'tight';

export interface Offer {
  id: OfferId;
  limits: Limits;
  /** Show the Pro paywall once, on a first launch, before anything is scanned. */
  firstOpenPaywall: boolean;
  /** The plan length selected when the paywall opens, if that plan is on sale. */
  prefer: Period | null;
}

export const OFFERS: Record<OfferId, Offer> = {
  launch: {
    id: 'launch',
    limits: { freePerDay: 30, perAd: 10, adsPerDay: 5 },
    firstOpenPaywall: false,
    prefer: null,
  },
  /*
   * A PROPOSAL, not a decision. Nothing selects it until the remote file does.
   *
   * Ten scans is enough to hear all three sort sounds and see a price land,
   * which is the whole demonstration; it is not enough to sort a box, which is
   * the thing being sold. Three videos a day rather than five keeps the ad a
   * top-up. `prefer: 'week'` only matters if a weekly product exists, and none
   * does: creating one and pricing it are also the owner's.
   */
  tight: {
    id: 'tight',
    limits: { freePerDay: 10, perAd: 10, adsPerDay: 3 },
    firstOpenPaywall: true,
    prefer: 'week',
  },
};

export const DEFAULT_OFFER: OfferId = 'launch';

export const isOfferId = (v: unknown): v is OfferId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(OFFERS, v);

/** Read the remote file's body: `{"offer":"launch"}`. Anything else is null. */
export function readRemote(body: unknown): OfferId | null {
  if (!body || typeof body !== 'object') return null;
  const v = (body as { offer?: unknown }).offer;
  return isOfferId(v) ? v : null;
}

/**
 * The offer to run on.
 *
 * The remote answer wins when there is one. Without it - offline, a basement, a
 * card show - the last answer this phone got is kept, so an install does not
 * flip between offers with its signal. A phone that has never had an answer is
 * on the launch offer, which is the generous one: when in doubt, the mistake
 * should be giving too much.
 */
export function pickOffer(remote: unknown, stored: unknown): OfferId {
  if (isOfferId(remote)) return remote;
  if (isOfferId(stored)) return stored;
  return DEFAULT_OFFER;
}

/**
 * Whether to open the introductory paywall now.
 *
 * Once per install, and only before the first scan: someone who is already
 * using the app has seen what it does and meets the paywall when their scans
 * run out, like everyone else. Switching offers must not ambush them.
 */
export function shouldWelcome(offer: Offer, e: Entitlement, welcomed: boolean): boolean {
  return offer.firstOpenPaywall && !welcomed && !e.pro && e.scansEver === 0 && e.credits === 0;
}
