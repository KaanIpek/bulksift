/**
 * Loads the bundled recognition data and builds a Scanner.
 *
 * index.bin, cards.json and prices.json ship as assets: recognition is entirely
 * on-device, so scanning works with no network and with no per-scan latency.
 * Only prices need refreshing, and they are a separate, small file so they can
 * be updated without shipping a new build.
 */

import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import { nativeIndex } from '../modules/bulksift-detect';
import {
  CardIndex,
  Scanner,
  loadCards,
  type CardRecord,
  type CompactCatalogue,
  type PriceBook,
} from '@bulksift/core';

const INDEX_ASSET = require('../assets/data/index.bin');
const CARDS_ASSET = require('../assets/data/cards.json');
const PRICES_ASSET = require('../assets/data/prices.json');

/** Where a fresher price file can be fetched from, if one is configured. */
export const PRICE_FEED_URL: string | null = null;

function base64ToBytes(b64: string): Uint8Array {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < table.length; i++) lookup[table.charCodeAt(i)] = i;

  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const out = new Uint8Array((len * 3) >> 2);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    buffer = (buffer << 6) | lookup[b64.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

async function readAssetBytes(mod: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(mod);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('asset has no uri after download');

  // On web an asset is a URL, not a file, and there is no file system to read
  // it through. Fetching it is also the faster path there - no base64 round
  // trip - so it is not merely a fallback.
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`could not fetch ${uri}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(b64);
}

async function readAssetJson<T>(mod: unknown): Promise<T> {
  // Metro bundles .json as a module, so require() usually hands back the parsed
  // object directly and there is no asset to read. Asset.fromModule would throw
  // on that, so the common path is checked first; the branch below only runs if
  // a config change ever turns .json into a file asset.
  if (mod && typeof mod === 'object') return mod as T;

  const asset = Asset.fromModule(mod as number);
  if (!asset.downloaded) await asset.downloadAsync();
  if (!asset.localUri) throw new Error('json asset has no local uri');
  return JSON.parse(await FileSystem.readAsStringAsync(asset.localUri)) as T;
}

export interface SetInfo {
  id: string;
  name: string;
  /** How many cards the catalogue holds for this set - the completion target. */
  total: number;
  released: string | null;
}

export interface LoadedEngine {
  /** Whether the index searches are going through the C++ matcher. */
  nativeIndex: boolean;
  scanner: Scanner;
  /** Every card, for browsing and for resolving a collection entry by id. */
  cards: CardRecord[];
  /** Card id -> row, so a collection entry finds its card without a scan. */
  byId: Map<string, CardRecord>;
  /** Every set with its card count, sorted newest first. */
  sets: SetInfo[];
  cardCount: number;
  indexBytes: number;
  priceUpdated: string;
  priceSource: string;
  pricedCount: number;
}

export async function loadEngine(): Promise<LoadedEngine> {
  const [indexBytes, compactCards, book] = await Promise.all([
    readAssetBytes(INDEX_ASSET),
    readAssetJson<CompactCatalogue>(CARDS_ASSET),
    readAssetJson<PriceBook>(PRICES_ASSET),
  ]);

  let priceBook = book;
  if (PRICE_FEED_URL) {
    try {
      const fresh = (await (await fetch(PRICE_FEED_URL)).json()) as PriceBook;
      // Only take the newer file if it actually parses and carries prices; a
      // half-written feed must never replace a good bundled snapshot.
      if (fresh?.prices && Object.keys(fresh.prices).length > 1000) priceBook = fresh;
    } catch {
      // stay on the bundled snapshot
    }
  }

  const buf = indexBytes.buffer.slice(
    indexBytes.byteOffset,
    indexBytes.byteOffset + indexBytes.byteLength,
  ) as ArrayBuffer;
  const index = CardIndex.parse(buf);
  /*
   * Hand the index to the C++ matcher if there is one.
   *
   * The TypeScript scan stays in place and is what runs on the web, in the
   * tests, and on any build where the module did not link. Both are compared
   * on the queries the app actually produces - see check-parity.mjs.
   */
  const accel = nativeIndex(indexBytes);
  if (accel) index.useAccelerator(accel);
  const cards: CardRecord[] = loadCards(compactCards);
  const scanner = new Scanner(index, cards, priceBook);

  let priced = 0;
  const byId = new Map<string, CardRecord>();
  const setMap = new Map<string, SetInfo>();
  for (const c of cards) {
    if (priceBook.prices[c.i]) priced++;
    byId.set(c.i, c);
    const found = setMap.get(c.s);
    if (found) found.total++;
    else setMap.set(c.s, { id: c.s, name: c.S, total: 1, released: c.d ?? null });
  }
  const sets = [...setMap.values()].sort((a, b) =>
    (b.released ?? '').localeCompare(a.released ?? ''),
  );

  return {
    nativeIndex: accel != null,
    scanner,
    cards,
    byId,
    sets,
    cardCount: cards.length,
    indexBytes: indexBytes.byteLength,
    priceUpdated: priceBook.updated,
    priceSource: priceBook.source,
    pricedCount: priced,
  };
}
