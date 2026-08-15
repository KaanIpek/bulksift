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
export const REVENUECAT_IOS_KEY: string | null = null;

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

/** Subscribe to Pro. */
export async function subscribe(): Promise<Purchase> {
  const p = sdk();
  if (!p || !configured) return { ok: false, reason: NOT_CONNECTED };
  try {
    const offerings = await p.getOfferings();
    // The subscription is whichever package is not a credit pack.
    const pkg = offerings.current?.availablePackages
      .find((x) => !CREDIT_PACKS[x.product.identifier]);
    if (!pkg) return { ok: false, reason: 'Pro is not available right now.' };
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
