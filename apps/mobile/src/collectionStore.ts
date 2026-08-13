/**
 * Where the collection is kept: one JSON file in the app's documents folder.
 *
 * No account, no server, no sync. The recognition engine already works with the
 * network off and there is no reason the collection should not. Split from
 * `collection.ts` so the arithmetic there stays testable off-device.
 */

import { File, Paths } from 'expo-file-system';

import type { Persisted } from './collection';

const FILE = 'bulksift-collection.json';

function fileHandle(): File {
  return new File(Paths.document, FILE);
}

export async function loadCollection(): Promise<Persisted> {
  try {
    const f = fileHandle();
    if (!f.exists) return { version: 1, entries: [], wishlist: [] };
    const raw = f.textSync();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
    };
  } catch {
    // A collection that fails to parse must not stop the app from opening.
    // Starting empty loses data, so the broken file is kept for recovery.
    try {
      const f = fileHandle();
      if (f.exists) f.copySync(new File(Paths.document, `${FILE}.broken`));
    } catch { /* nothing more to do */ }
    return { version: 1, entries: [], wishlist: [] };
  }
}

export async function saveCollection(data: Persisted): Promise<void> {
  const f = fileHandle();
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(data));
}

