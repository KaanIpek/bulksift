/**
 * Where the collection is kept: one JSON file in the app's documents folder.
 *
 * No account, no server, no sync. The recognition engine already works with the
 * network off and there is no reason the collection should not. Split from
 * `collection.ts` so the arithmetic there stays testable off-device.
 */

import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

import type { Persisted } from './collection';

const EMPTY: Persisted = { version: 1, entries: [], wishlist: [], history: [] };

/**
 * On web there is no document directory, so the collection lives in
 * localStorage. That exists so the app can be opened in a browser to work on
 * the interface - the shipped product is the phone.
 */
const webStore = {
  read(): string | null {
    try { return globalThis.localStorage?.getItem(FILE) ?? null; } catch { return null; }
  },
  write(value: string): void {
    try { globalThis.localStorage?.setItem(FILE, value); } catch { /* private mode */ }
  },
};

const FILE = 'bulksift-collection.json';

function fileHandle(): File {
  return new File(Paths.document, FILE);
}

export async function loadCollection(): Promise<Persisted> {
  if (Platform.OS === 'web') {
    const raw = webStore.read();
    if (!raw) return EMPTY;
    try {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        version: 1,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch {
      return EMPTY;
    }
  }
  try {
    const f = fileHandle();
    if (!f.exists) return EMPTY;
    const raw = f.textSync();
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      wishlist: Array.isArray(parsed.wishlist) ? parsed.wishlist : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    // A collection that fails to parse must not stop the app from opening.
    // Starting empty loses data, so the broken file is kept for recovery.
    try {
      const f = fileHandle();
      if (f.exists) f.copySync(new File(Paths.document, `${FILE}.broken`));
    } catch { /* nothing more to do */ }
    return EMPTY;
  }
}

export async function saveCollection(data: Persisted): Promise<void> {
  if (Platform.OS === 'web') {
    webStore.write(JSON.stringify(data));
    return;
  }
  const f = fileHandle();
  if (!f.exists) f.create({ intermediates: true });
  f.write(JSON.stringify(data));
}

