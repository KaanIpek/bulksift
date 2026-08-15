/**
 * Rewarded video, and nothing else.
 *
 * There are no banners and no interstitials in this app, and that is a
 * measurement rather than a preference. The scan screen is a phone propped over
 * a table looking at a glossy card, and glare is the single most damaging thing
 * that can happen to a read - worth 210 bits of match quality against 86 for
 * motion blur and 82 for a warm white balance. A bright advert beside the
 * viewfinder would make the product measurably worse at its one job.
 *
 * A rewarded video is different in kind: the user asks for it, it plays full
 * screen while nothing is being scanned, and it is the free way past a limit.
 * It is only ever offered from the paywall.
 *
 * THE ONE THING THAT MUST NOT BE GOT WRONG
 *
 * `EARNED_REWARD` is the only event that means the video was watched. `CLOSED`
 * fires when someone dismisses it after two seconds, and `LOADED` only means it
 * is ready to play. Crediting on either of those turns a limited free tier into
 * an unlimited one, silently, and nobody reports it as a bug.
 */

import { Platform } from 'react-native';

import { adsSdk } from './native';

/**
 * The AdMob rewarded unit.
 *
 * Null until a real unit exists in an AdMob account. Test units are not shipped
 * as a fallback: a build that quietly serves Google's test creative to real
 * users earns nothing and looks broken, and a build that serves nothing at all
 * can at least say so on the paywall.
 */
export const REWARDED_UNIT_ID: string | null = null;

/** How long to wait for a video before giving up and telling the user. */
const LOAD_TIMEOUT_MS = 12_000;

type AdsModule = typeof import('react-native-google-mobile-ads');

let mod: AdsModule | null = null;
let started = false;

/*
 * Required lazily, like the store. A static import pulls a native module into
 * the web bundle and into every Node test that touches this file, and both fail
 * at import time - before any code could decide it was not needed.
 */
function sdk(): AdsModule | null {
  if (mod) return mod;
  if (Platform.OS === 'web' || !REWARDED_UNIT_ID) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    mod = adsSdk<AdsModule>();
    if (!mod) return null;
    return mod;
  } catch {
    return null;
  }
}

/** Start the ad SDK. Safe to call more than once. */
export async function configure(): Promise<void> {
  const m = sdk();
  if (!m || started) return;
  try {
    await m.default().initialize();
    started = true;
  } catch {
    started = false;
  }
}

export function adsAvailable(): boolean {
  return sdk() != null && started;
}

/**
 * Show a rewarded video, and resolve true only if it was genuinely watched.
 *
 * Loads and shows in one call rather than pre-loading: a video is asked for at
 * most five times a day, from a sheet the user opened deliberately, so holding a
 * loaded ad in memory for hours to save two seconds is the wrong trade in an app
 * whose other thread is doing image recognition.
 */
export async function showRewardedAd(): Promise<boolean> {
  const m = sdk();
  if (!m || !started || !REWARDED_UNIT_ID) return false;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (earned: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe.forEach((off) => { try { off(); } catch { /* already gone */ } });
      resolve(earned);
    };

    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    const unsubscribe: Array<() => void> = [];

    try {
      const ad = m.RewardedAd.createForAdRequest(REWARDED_UNIT_ID, {
        // Nothing about a collection is used to target an advert.
        requestNonPersonalizedAdsOnly: true,
      });

      unsubscribe.push(
        ad.addAdEventListener(m.RewardedAdEventType.LOADED, () => {
          try { ad.show(); } catch { done(false); }
        }),
      );

      /*
       * The only event that means it was watched. Resolving here rather than on
       * close is the whole point of this file: CLOSED fires just as reliably
       * when a video is dismissed after two seconds.
       */
      unsubscribe.push(
        ad.addAdEventListener(m.RewardedAdEventType.EARNED_REWARD, () => done(true)),
      );

      unsubscribe.push(
        ad.addAdEventListener(m.AdEventType.ERROR, () => done(false)),
      );
      /*
       * Closing without having earned resolves false. It is registered after
       * EARNED_REWARD so that when both fire - which is the normal ending for a
       * video watched to the end - the earned one has already settled it.
       */
      unsubscribe.push(
        ad.addAdEventListener(m.AdEventType.CLOSED, () => done(false)),
      );

      ad.load();
    } catch {
      done(false);
    }
  });
}
