/**
 * Asking the host which offer is live. The decisions live in `offer.ts`.
 *
 * Split the same way `prices.ts` is split from `pricesStore.ts`.
 */

import { readRemote, type OfferId } from './offer';

/**
 * Served from `docs/offer.json` by the same Pages deployment as the privacy
 * page and the price book. Null turns the lookup off and leaves every install
 * on the offer it already has.
 */
export const OFFER_URL: string | null = 'https://kaanipek.github.io/bulksift/offer.json';

/**
 * The live offer, or null when it could not be learned.
 *
 * Null is not an answer and must not be treated as "launch": the caller keeps
 * whatever it had. Four seconds is generous for a 20-byte file and short enough
 * that a phone with one bar is not left waiting on it.
 */
export async function fetchOffer(): Promise<OfferId | null> {
  if (!OFFER_URL) return null;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 4000);
  try {
    const res = await fetch(OFFER_URL, { cache: 'no-store', signal: ctl?.signal });
    if (!res.ok) return null;
    return readRemote(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
