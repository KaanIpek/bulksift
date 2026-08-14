/**
 * A picture of every card, on the phone.
 *
 * The catalogue's image host is not a dependable source. Asked for a card from
 * a 2026 set it answers 200 OK with a picture of a card *back* - so the app
 * cannot tell the request failed, and shows the wrong thing with no error to
 * catch. Cards from Chaos Rising, Ascended Heroes and Black Bolt all came back
 * that way on a device, and no amount of `onError` handling can help, because
 * nothing errored.
 *
 * So the pictures ship with the app: 20,444 thumbnails at 96x134, WebP,
 * concatenated into one 57 MB file with a table of offsets. See
 * tools/build_thumbs.py for why one file rather than 20,444 - a React Native
 * bundle needs a static require() per asset and cannot be handed a name
 * computed at runtime.
 *
 * The cost is real: it roughly triples the download. It buys a card's picture
 * appearing instantly, with no network, for every card, always the right one -
 * which is what the app is for. Competitors in this category ship 100 MB and
 * still need a connection to show you a card.
 */

import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

const THUMBS_BIN = require('../../assets/data/thumbs.bin');
const THUMBS_JSON = require('../../assets/data/thumbs.json');

interface ThumbTable {
  w: number;
  h: number;
  /** Byte offset of each card's thumbnail, in cards.json row order. */
  off: number[];
  /** Byte length, zero when there is no picture for that card. */
  len: number[];
}

let table: ThumbTable | null = null;
let rowOf: Map<string, number> | null = null;
/**
 * Where the pack lives, resolved in the background.
 *
 * Nothing waits for this. Blocking the app's first paint on a 57 MB asset
 * makes the pictures - which are decoration - hold up the collection, the
 * prices and the camera, all of which are ready. A row that asks early gets
 * its slot and its picture a moment later.
 */
let binUri: Promise<string> | null = null;

/**
 * Data URIs already built, newest last.
 *
 * A list scrolls back and forth over the same forty cards, and re-reading and
 * re-encoding each time would put a file read on the same thread that has to
 * recognise the next frame. Three hundred entries is about four megabytes of
 * base64 and covers any scroll a person actually performs.
 */
const CACHE_LIMIT = 300;
const cache = new Map<string, string>();

function remember(id: string, uri: string): string {
  cache.set(id, uri);
  if (cache.size > CACHE_LIMIT) {
    // Maps iterate in insertion order, so the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return uri;
}

/**
 * Make the pack readable. Call once, with the catalogue, before anything asks
 * for a picture.
 */
export async function loadThumbs(cardIds: string[]): Promise<void> {
  if (table && binUri) return;

  rowOf = new Map();
  for (let i = 0; i < cardIds.length; i++) rowOf.set(cardIds[i], i);

  // Metro hands back parsed JSON for a .json require; the branch is for a
  // config where it becomes a file asset instead.
  table = (THUMBS_JSON && typeof THUMBS_JSON === 'object' && 'off' in THUMBS_JSON)
    ? (THUMBS_JSON as ThumbTable)
    : JSON.parse(
      await FileSystem.readAsStringAsync(
        (await Asset.fromModule(THUMBS_JSON).downloadAsync()).localUri!,
      ),
    ) as ThumbTable;

  const asset = Asset.fromModule(THUMBS_BIN);
  binUri = asset.downloadAsync().then((a) => a.localUri ?? a.uri);
}

/** Height for a given width, at the thumbnails' own ratio. */
export const thumbRatio = () => (table ? table.h / table.w : 342 / 245);

/**
 * The picture for a card, as a data URI, or null when there is none.
 *
 * Reading a range out of the pack straight to base64 is one call and no
 * intermediate copy - which is also exactly the form an <Image> source wants,
 * so nothing is converted twice.
 */
export async function thumbUri(cardId: string): Promise<string | null> {
  const hit = cache.get(cardId);
  if (hit !== undefined) return hit;
  if (!table || !binUri || !rowOf) return null;

  const row = rowOf.get(cardId);
  if (row == null) return null;
  const len = table.len[row];
  if (!len) return null; // two cards in the catalogue have no picture at all

  try {
    const uri = await binUri;
    const base64 = Platform.OS === 'web'
      ? await readRangeWeb(uri, table.off[row], len)
      : await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: table.off[row],
        length: len,
      });
    return remember(cardId, `data:image/webp;base64,${base64}`);
  } catch {
    return null;
  }
}

/** Whether a card's picture is already decoded, so a row can draw it at once. */
export const cachedThumb = (cardId: string): string | null => cache.get(cardId) ?? null;

/**
 * On web there is no file system, so the pack is fetched once and sliced in
 * memory. Dev only - the shipped product reads a range off the device, which is
 * the whole reason the pictures are one file instead of twenty thousand.
 *
 * Fetched once rather than per picture: Metro's dev server ignores a Range
 * header and answers with the entire 57 MB, so a range request per thumbnail
 * downloaded the pack again for every row in the list.
 */
let webPack: Promise<Uint8Array> | null = null;

async function readRangeWeb(uri: string, off: number, len: number): Promise<string> {
  if (!webPack) {
    webPack = fetch(uri).then(async (r) => new Uint8Array(await r.arrayBuffer()));
  }
  const bytes = (await webPack).subarray(off, off + len);
  let s = '';
  // In chunks, because spreading a few thousand bytes into String.fromCharCode
  // at once overflows the argument list on some engines.
  for (let i = 0; i < bytes.length; i += 4096) {
    s += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return globalThis.btoa(s);
}
