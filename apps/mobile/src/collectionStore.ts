/**
 * Where the library and the allowance are kept: one JSON file in the app's
 * documents folder.
 *
 * No account, no server. The recognition engine works with the network off and
 * there is no reason the collection should not. Split from `library.ts` and
 * `entitlement.ts` so the arithmetic that decides how many cards you own, and
 * how many scans you have left, can be tested without a device attached.
 *
 * The entitlement rides in the same file rather than a second one. It has to be
 * written on every scan anyway, and two files that must agree with each other
 * is a torn-write problem waiting to happen.
 */

import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

import { normalise, type Entitlement } from './entitlement';
import { readBases } from './merge';
import type { Bases } from './sync';
import { loadLibrary, type Library } from './library';

const FILE = 'bulksift-collection.json';

export interface Saved {
  library: Library;
  entitlement: Entitlement;
  /**
   * The last state each collection was agreed on with the server.
   *
   * Persisted, and it has to be. The three-way merge computes
   * `mine + theirs - base`, so a base that does not survive a restart makes
   * every sync look like a first sync - and a first sync ADDS both sides.
   * Scan three Charizards, close the app, sync, and there are six.
   *
   * Empty for anyone who has never signed in, which is the common case and
   * costs nothing.
   */
  bases: Bases;
}

/**
 * On web the file system does not exist, so this lives in localStorage. That
 * exists so the app can be opened in a browser to work on the interface; the
 * shipped product is the phone.
 */
const webStore = {
  read(): string | null {
    try { return globalThis.localStorage?.getItem(FILE) ?? null; } catch { return null; }
  },
  write(value: string): void {
    try { globalThis.localStorage?.setItem(FILE, value); } catch { /* private mode */ }
  },
};

const fileHandle = () => new File(Paths.document, FILE);

/** Turn whatever was on disk into something the app can run on. */
function parse(raw: string | null, at: number): Saved {
  if (!raw) {
    return { library: loadLibrary(null, at), entitlement: normalise(null, at), bases: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      // A version 1 file has entries at the top level; loadLibrary reads both
      // shapes, so an upgrade keeps every card.
      library: loadLibrary(parsed.library ?? parsed, at),
      entitlement: normalise(parsed.entitlement, at),
      bases: readBases(parsed.bases),
    };
  } catch {
    return { library: loadLibrary(null, at), entitlement: normalise(null, at), bases: {} };
  }
}

export async function load(): Promise<Saved> {
  const at = Date.now();
  if (Platform.OS === 'web') return parse(webStore.read(), at);
  try {
    const f = fileHandle();
    if (!f.exists) return parse(null, at);
    return parse(f.textSync(), at);
  } catch {
    // A file that fails to read must not stop the app from opening. Starting
    // empty loses data, so the broken file is kept for recovery.
    try {
      const f = fileHandle();
      if (f.exists) f.copySync(new File(Paths.document, `${FILE}.broken`));
    } catch { /* nothing more to do */ }
    return parse(null, at);
  }
}

export async function save(data: Saved): Promise<void> {
  const body = JSON.stringify(data);
  if (Platform.OS === 'web') {
    webStore.write(body);
    return;
  }
  const f = fileHandle();
  if (!f.exists) f.create({ intermediates: true });
  f.write(body);
}
