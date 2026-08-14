/**
 * Fetching and caching the price file. The decisions live in `prices.ts`.
 *
 * Split the same way `collection.ts` is split from `collectionStore.ts`: the
 * part that decides whether a file is trustworthy has to be testable in Node,
 * and it cannot be while it imports expo-file-system.
 */

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import type { PriceBook } from '@bulksift/core';
import { acceptable, type RefreshOutcome } from './prices';

/**
 * Where the published price file lives.
 *
 * Null until it is hosted, and everything below degrades to "the snapshot that
 * shipped with the app is what you have" - a working app rather than a broken
 * one, and the reason recognition and pricing never needed a network.
 */
export const PRICE_HOST: string | null = null;

/** The tiny file checked before deciding to download the big one. */
interface Manifest {
  updated: string;
  cards: number;
}

const CACHE = 'bulksift-prices.json';
const cachePath = () => `${FileSystem.documentDirectory ?? ''}${CACHE}`;

/**
 * Fetch a newer price book, or say why not.
 *
 * Reads the manifest first, so a device that is already current transfers about
 * a hundred bytes rather than a quarter of a megabyte.
 */
export async function refresh(
  current: PriceBook | null,
  opts: { force?: boolean } = {},
): Promise<RefreshOutcome> {
  if (!PRICE_HOST) {
    return { status: 'unavailable', reason: 'No price feed is configured in this build.' };
  }
  try {
    const res = await fetch(`${PRICE_HOST}/prices-meta.json`, { cache: 'no-store' });
    if (!res.ok) return { status: 'unavailable', reason: `Price feed returned ${res.status}.` };
    const manifest = (await res.json()) as Manifest;

    if (!opts.force && current && manifest.updated === current.updated) {
      return { status: 'current' };
    }

    const full = await fetch(`${PRICE_HOST}/prices.json`, { cache: 'no-store' });
    if (!full.ok) return { status: 'unavailable', reason: `Price file returned ${full.status}.` };
    const parsed = (await full.json()) as PriceBook;

    if (!acceptable(parsed, current)) {
      return { status: 'unavailable', reason: 'The price file looked incomplete.' };
    }
    await cache(parsed);
    return { status: 'updated', book: parsed };
  } catch (e) {
    return { status: 'unavailable', reason: String((e as Error)?.message ?? e) };
  }
}

/** Keep the newest book on disk so the next launch starts from it. */
async function cache(book: PriceBook): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await FileSystem.writeAsStringAsync(cachePath(), JSON.stringify(book));
  } catch { /* a cache that cannot be written is not worth failing over */ }
}

/**
 * The newest book on disk, if there is one.
 *
 * Read at launch and preferred over the bundled snapshot, so prices downloaded
 * yesterday survive the app being closed.
 */
export async function cached(): Promise<PriceBook | null> {
  if (Platform.OS === 'web') return null;
  try {
    const info = await FileSystem.getInfoAsync(cachePath());
    if (!info.exists) return null;
    const parsed = JSON.parse(await FileSystem.readAsStringAsync(cachePath())) as PriceBook;
    return acceptable(parsed, null) ? parsed : null;
  } catch {
    return null;
  }
}
