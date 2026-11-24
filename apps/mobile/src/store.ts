/**
 * The seam between the app and the things that take money.
 *
 * Everything above this file talks to the interface below and never to a store
 * SDK, which is what lets the paywall and the allowance be checked without a
 * sandbox account. The SDK is loaded lazily and only where it exists, so a web
 * build - and the test suite - never touch it.
 *
 * WHY THE APP COUNTS THE CREDITS, NOT REVENUECAT
 *
 * RevenueCat has a Virtual Currency feature that would track a scan-credit
 * balance for us and grant it automatically on a consumable purchase. Its own
 * documentation rules it out here: "RevenueCat is designed to be the single
 * source of truth for virtual currency balances", and spending goes through
 * `POST /virtual_currencies/transactions`, so every spend needs a network round
 * trip to validate the balance before it is deducted.
 *
 * Scanning a card in BulkSift does not touch the network. That is the whole
 * product - the index, the recogniser and the prices are all on the device, and
 * the app is used at card shows and in basements. Putting a server call in front
 * of each scan would make it fail in exactly the places it is meant to work.
 *
 * So the balance lives in `entitlement.ts`, on the phone, and RevenueCat is
 * asked only two things: is the subscription active, and did a pack just get
 * bought. Both are events, not a running total, and both survive being offline.
 */

import { Platform } from 'react-native';

import { purchasesSdk } from './native';
import { orderPlans, periodOf, trialDaysOf, type Plan } from './plans';

export type { Plan } from './plans';

/** RevenueCat's INTRO_ELIGIBILITY_STATUS_ELIGIBLE. The enum lives in the native SDK. */
const INTRO_ELIGIBLE = 2;

/** How many scans each consumable pack grants. Keyed by product identifier. */
export const CREDIT_PACKS: Record<string, number> = {
  'com.rldgames.bulksift.credits.200': 200,
  'com.rldgames.bulksift.credits.1000': 1000,
  'com.rldgames.bulksift.credits.5000': 5000,
};

/** The RevenueCat entitlement that means "Pro". */
export const PRO_ENTITLEMENT = 'pro';

/**
 * The RevenueCat public API key for iOS.
 *
 * Null until the project exists. Everything below then reports itself
 * unavailable rather than throwing, and the paywall says so instead of showing
 * buttons that do nothing - which is the difference between "not finished" and
 * "broken".
 */
export const REVENUECAT_IOS_KEY: string | null = 'appl_kZWgGrhmMquthonPjJoSyxgmJUw';

export type StoreState = 'unavailable' | 'ready';

export interface Product {
  id: string;
  title: string;
  price: string;
  /** Scans granted, for a credit pack. Absent for the subscription. */
  credits?: number;
}

export interface Purchase {
  ok: boolean;
  /** Scans to credit, when a pack was bought. */
  credits?: number;
  /** Whether the subscription is now active. */
  pro?: boolean;
  /** Why it did not happen. Absent on success, and absent when cancelled. */
  reason?: string;
  /** The user backed out. Not an error, and must not raise a message. */
  cancelled?: boolean;
}

const NOT_CONNECTED = 'Purchases are not connected in this build yet.';

/*
 * The SDK is required lazily.
 *
 * A static import would pull a native module into the web bundle and into every
 * Node test that touches this file, and both would fail at import time - before
 * any code could decide it was not needed.
 */
type RC = typeof import('react-native-purchases').default;
let rc: RC | null = null;
let configured = false;

function sdk(): RC | null {
  if (rc) return rc;
  if (Platform.OS === 'web' || !REVENUECAT_IOS_KEY) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    rc = purchasesSdk<RC>();
    if (!rc) return null;
    return rc;
  } catch {
    return null;
  }
}

/** Start the SDK. Safe to call more than once; does nothing without a key. */
export async function configure(): Promise<void> {
  const p = sdk();
  if (!p || configured) return;
  try {
    await p.configure({ apiKey: REVENUECAT_IOS_KEY as string });
    configured = true;
  } catch {
    configured = false;
  }
}

export function storeState(): StoreState {
  return sdk() && configured ? 'ready' : 'unavailable';
}

/** What is on sale. Empty when the store is not connected. */
export async function products(): Promise<Product[]> {
  const p = sdk();
  if (!p || !configured) return [];
  try {
    const offerings = await p.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    return packages.map((pkg) => ({
      id: pkg.product.identifier,
      title: pkg.product.title,
      price: pkg.product.priceString,
      credits: CREDIT_PACKS[pkg.product.identifier],
    }));
  } catch {
    return [];
  }
}

/**
 * The subscription plans on sale, with what each one costs and for how long.
 *
 * Everything in the offering that is not a credit pack and whose period can be
 * read. The trial is reported only when the store says this customer may still
 * take it; when that question cannot be answered the trial is left out, and the
 * screen states the full price - someone who then gets a free week is surprised
 * in the direction nobody complains about.
 */
export async function plans(): Promise<Plan[]> {
  const p = sdk();
  if (!p || !configured) return [];
  try {
    const offerings = await p.getOfferings();
    const subs = (offerings.current?.availablePackages ?? [])
      .filter((pkg) => !CREDIT_PACKS[pkg.product.identifier]);
    let eligible: Record<string, { status: number }> = {};
    try {
      eligible = await p.checkTrialOrIntroductoryPriceEligibility(
        subs.map((pkg) => pkg.product.identifier),
      );
    } catch { /* unknown is treated as not eligible, below */ }
    const out: Plan[] = [];
    for (const pkg of subs) {
      const period = periodOf(pkg.product.subscriptionPeriod, String(pkg.packageType));
      if (!period) continue;
      out.push({
        id: pkg.product.identifier,
        price: pkg.product.priceString,
        amount: pkg.product.price,
        period,
        trialDays: trialDaysOf(
          pkg.product.introPrice,
          eligible[pkg.product.identifier]?.status === INTRO_ELIGIBLE,
        ),
      });
    }
    return orderPlans(out);
  } catch {
    return [];
  }
}

/**
 * Read a customer record into the two facts this app cares about.
 *
 * The credit count deliberately does NOT come from here. A pack is granted once,
 * at the moment of purchase, by `buy`; re-reading it from a customer record
 * would grant it again on every launch, because a consumable stays in the
 * purchase history forever.
 */
function proFrom(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return typeof info.entitlements.active[PRO_ENTITLEMENT] !== 'undefined';
}

/** Buy a pack of scans. Returns how many to credit. */
export async function buy(productId: string): Promise<Purchase> {
  const p = sdk();
  if (!p || !configured) return { ok: false, reason: NOT_CONNECTED };
  const credits = CREDIT_PACKS[productId];
  if (!credits) return { ok: false, reason: 'Unknown pack.' };
  try {
    const offerings = await p.getOfferings();
    const pkg = offerings.current?.availablePackages
      .find((x) => x.product.identifier === productId);
    if (!pkg) return { ok: false, reason: 'That pack is not available right now.' };
    const { customerInfo } = await p.purchasePackage(pkg);
    return { ok: true, credits, pro: proFrom(customerInfo) };
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err.userCancelled) return { ok: false, cancelled: true };
    return { ok: false, reason: err.message ?? 'The purchase did not go through.' };
  }
}

/**
 * Subscribe to Pro, on the plan the buyer chose.
 *
 * The plan is named by the caller and has to be. This used to take no argument
 * and buy "whichever package is not a credit pack" - with a monthly and a
 * yearly both on sale, that was whichever the store listed first, at a price
 * the screen had never shown.
 */
export async function subscribe(productId: string): Promise<Purchase> {
  const p = sdk();
  if (!p || !configured) return { ok: false, reason: NOT_CONNECTED };
  if (!productId || CREDIT_PACKS[productId]) return { ok: false, reason: 'Unknown plan.' };
  try {
    const offerings = await p.getOfferings();
    const pkg = offerings.current?.availablePackages
      .find((x) => x.product.identifier === productId);
    if (!pkg) return { ok: false, reason: 'That plan is not available right now.' };
    const { customerInfo } = await p.purchasePackage(pkg);
    return { ok: true, pro: proFrom(customerInfo) };
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err.userCancelled) return { ok: false, cancelled: true };
    return { ok: false, reason: err.message ?? 'The purchase did not go through.' };
  }
}

/**
 * Restore purchases.
 *
 * This restores the SUBSCRIPTION only, and that is correct rather than a
 * shortcoming: consumables are consumed. Re-granting a pack every time someone
 * pressed Restore would hand out unlimited scans, so the credits already spent
 * stay spent and the balance on the device is the record.
 */
export async function restore(): Promise<Purchase> {
  const p = sdk();
  if (!p || !configured) return { ok: false, reason: NOT_CONNECTED };
  try {
    const info = await p.restorePurchases();
    return { ok: true, pro: proFrom(info) };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'Could not restore.' };
  }
}

/** Whether the subscription is active right now, without buying anything. */
export async function currentPro(): Promise<boolean | null> {
  const p = sdk();
  if (!p || !configured) return null;
  try {
    return proFrom(await p.getCustomerInfo());
  } catch {
    return null;
  }
}

/*
 * Ads live in `ads.ts`. Re-exported here so the app has one place it asks about
 * "things that involve money", and so a screen never imports an ad SDK path
 * directly.
 */
export { adsAvailable, showRewardedAd, configure as configureAds } from './ads';
