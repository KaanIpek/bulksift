/**
 * The seam between the app and the things that take money.
 *
 * Purchases and rewarded ads both need native SDKs - RevenueCat and AdMob -
 * and both are the kind of dependency this project has been bitten by before.
 * So the app talks to this interface instead, and the interface is honest about
 * not being connected yet: every screen above it is complete and testable now,
 * and when the SDKs land only this file changes.
 *
 * The important consequence is that the paywall cannot lie. A button that
 * cannot do anything says so, rather than failing silently when pressed - which
 * is the failure mode of stubbing these out with an empty function.
 */

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
  /** Why it did not happen, for the UI to show. Absent on success. */
  reason?: string;
}

const NOT_CONNECTED =
  'Purchases are not connected in this build yet.';

/**
 * Whether the store can be used at all.
 *
 * Checked by the UI before offering anything, so a build without the SDK shows
 * a disabled control with a reason rather than a button that does nothing.
 */
export function storeState(): StoreState {
  return 'unavailable';
}

export function adsAvailable(): boolean {
  return false;
}

export async function products(): Promise<Product[]> {
  return [];
}

export async function buy(_productId: string): Promise<Purchase> {
  return { ok: false, reason: NOT_CONNECTED };
}

export async function subscribe(): Promise<Purchase> {
  return { ok: false, reason: NOT_CONNECTED };
}

export async function restore(): Promise<Purchase> {
  return { ok: false, reason: NOT_CONNECTED };
}

/**
 * Show a rewarded video.
 *
 * Resolves true ONLY on the SDK's earned-reward callback - not on "shown" and
 * not on "dismissed", both of which fire when someone closes a video after two
 * seconds. Getting that distinction wrong is how an ad-funded free tier becomes
 * a free tier.
 */
export async function showRewardedAd(): Promise<boolean> {
  return false;
}
