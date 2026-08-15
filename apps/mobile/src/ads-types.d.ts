/**
 * Enough of react-native-google-mobile-ads to compile against before it is
 * installed.
 *
 * The package is added in its own build cycle - every native module this
 * project has taken on needed one to get linking on iOS, and adding two at once
 * means not knowing which of them broke. This declaration lets `ads.ts` be
 * written, reviewed and type-checked in the meantime, and is deleted the moment
 * the real types arrive.
 */
declare module 'react-native-google-mobile-ads' {
  export interface RewardedAdReward { type: string; amount: number }

  export const RewardedAdEventType: {
    readonly LOADED: 'rewarded_loaded';
    readonly EARNED_REWARD: 'rewarded_earned_reward';
  };
  export const AdEventType: {
    readonly ERROR: 'error';
    readonly CLOSED: 'closed';
  };
  export const TestIds: { readonly REWARDED: string };

  export interface RewardedAdInstance {
    addAdEventListener(type: string, handler: (arg?: unknown) => void): () => void;
    load(): void;
    show(): void;
  }
  export const RewardedAd: {
    createForAdRequest(
      unitId: string,
      options?: { requestNonPersonalizedAdsOnly?: boolean },
    ): RewardedAdInstance;
  };

  export default function mobileAds(): { initialize(): Promise<unknown> };
}
