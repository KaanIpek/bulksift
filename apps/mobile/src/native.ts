/**
 * The native-only SDKs, behind one door.
 *
 * Three of these have no web implementation - ads, purchases, Sign in with
 * Apple - and this app runs on the web. react-native-web is how every screen in
 * the project gets looked at, and it is the only way to check a layout without
 * a twenty-minute cloud build, so breaking it is expensive.
 *
 * Wrapping each import in `try` does not work. Metro reads `require('literal')`
 * statically and pulls the package into the graph whether the branch runs or
 * not, so a lazy require of the ads SDK still failed the entire web bundle with
 * "Importing native-only module ... on web". Passing the name through a
 * variable does not work either - Metro rejects that outright, at build time.
 *
 * What does work is the resolver's own mechanism: `native.web.ts` sits beside
 * this file and is chosen on web, so the literal requires below are never even
 * parsed there. Every getter returns null on web, and every caller already has
 * to handle null because a build with no RevenueCat key is in the same position
 * as a browser. One path, not two.
 */

/* eslint-disable @typescript-eslint/no-var-requires, global-require */

/** The AdMob SDK, or null if it is not linked into this build. */
export function adsSdk<T>(): T | null {
  try {
    return require('react-native-google-mobile-ads') as T;
  } catch {
    return null;
  }
}

/** RevenueCat's client, already unwrapped from its default export. */
export function purchasesSdk<T>(): T | null {
  try {
    return require('react-native-purchases').default as T;
  } catch {
    return null;
  }
}

/** Sign in with Apple. iOS only, and absent from a simulator without an Apple ID. */
export function appleAuthSdk<T>(): T | null {
  try {
    return require('expo-apple-authentication') as T;
  } catch {
    return null;
  }
}
