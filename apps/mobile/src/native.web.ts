/**
 * The web half of `native.ts`: there are no native SDKs in a browser.
 *
 * Metro picks this file over `native.ts` for `platform=web`, which is the whole
 * point - the literal requires next door are never parsed here, so the ads SDK
 * cannot drag the web bundle down with it.
 *
 * Returning null is not a stub in the apologetic sense. Ads, purchases and
 * Sign in with Apple genuinely do not exist on this platform, and every caller
 * already renders a truthful sentence for that case because a build with no
 * keys configured needs the same one.
 */

export function adsSdk<T>(): T | null {
  return null;
}

export function purchasesSdk<T>(): T | null {
  return null;
}

export function appleAuthSdk<T>(): T | null {
  return null;
}

export function trackingSdk<T>(): T | null {
  return null;
}
