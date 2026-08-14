/**
 * Several collections instead of one.
 *
 * A collector does not have "a collection". They have the box they are selling,
 * the binder they are keeping, and the pile going off for grading, and the whole
 * point of separating them is that the three numbers must not be added together.
 *
 * Pure functions over a plain record, like `collection.ts` - the file writing
 * lives in `collectionStore.ts`. Every operation returns a new library and none
 * of them can lose a collection: `remove` refuses the last one, and `moveCard`
 * either moves the card or does nothing.
 *
 * The free tier holds one collection. That limit lives in the caller rather
 * than here, because this file must stay able to *read* a library of six when
 * a subscription lapses - taking five collections away from someone because
 * they stopped paying would be indefensible, and code that cannot represent
 * them cannot show them either.
 */

import type { Entry, Persisted, WishEntry } from './collection.ts';
import { entryKey, setQuantity } from './collection.ts';
import type { Point } from './history.ts';

export interface Collection {
  id: string;
  name: string;
  entries: Entry[];
  wishlist: WishEntry[];
  /** Daily value points for this collection alone. */
  history: Point[];
  createdAt: number;
  updatedAt: number;
}

export interface Library {
  version: 2;
  collections: Collection[];
  /** Which collection the app is currently showing. */
  activeId: string;
}

/**
 * Identifiers are made here rather than by a counter.
 *
 * They have to survive being merged with a library from another device, where
 * "collection 2" would collide with a different "collection 2". A timestamp
 * with a random tail is enough for that and needs no dependency.
 */
export function newId(at: number, rand: () => number = Math.random): string {
  return `c${at.toString(36)}${Math.floor(rand() * 1e6).toString(36)}`;
}

export function emptyCollection(name: string, at: number, id = newId(at)): Collection {
  return { id, name, entries: [], wishlist: [], history: [], createdAt: at, updatedAt: at };
}

export function freshLibrary(at: number): Library {
  const first = emptyCollection('My collection', at);
  return { version: 2, collections: [first], activeId: first.id };
}

/** The collection currently being shown. Never null: a library always has one. */
export function active(lib: Library): Collection {
  return lib.collections.find((c) => c.id === lib.activeId) ?? lib.collections[0];
}

export function byId(lib: Library, id: string): Collection | null {
  return lib.collections.find((c) => c.id === id) ?? null;
}

/** Replace one collection, stamping it as touched. */
export function update(
  lib: Library,
  id: string,
  change: (c: Collection) => Collection,
  at: number,
): Library {
  const at_ = lib.collections.findIndex((c) => c.id === id);
  if (at_ < 0) return lib;
  const next = lib.collections.slice();
  const changed = change(next[at_]);
  if (changed === next[at_]) return lib;
  next[at_] = { ...changed, updatedAt: at };
  return { ...lib, collections: next };
}

export function add(lib: Library, name: string, at: number): Library {
  const made = emptyCollection(cleanName(name) || 'Untitled', at);
  return { ...lib, collections: [...lib.collections, made], activeId: made.id };
}

export function rename(lib: Library, id: string, name: string, at: number): Library {
  const clean = cleanName(name);
  if (!clean) return lib;
  return update(lib, id, (c) => ({ ...c, name: clean }), at);
}

/**
 * Delete a collection, and everything in it.
 *
 * Refuses the last one. An app with no collection has nowhere to put the next
 * scan, and "deleted my only collection" is not a state worth writing recovery
 * code for when it can simply be prevented.
 */
export function remove(lib: Library, id: string): Library {
  if (lib.collections.length <= 1) return lib;
  const rest = lib.collections.filter((c) => c.id !== id);
  if (rest.length === lib.collections.length) return lib;
  return {
    ...lib,
    collections: rest,
    activeId: lib.activeId === id ? rest[0].id : lib.activeId,
  };
}

export function setActive(lib: Library, id: string): Library {
  return lib.collections.some((c) => c.id === id) ? { ...lib, activeId: id } : lib;
}

/**
 * Move `count` copies of one pile to another collection.
 *
 * Merges into a matching pile there rather than making a second one - the same
 * card in the same variant and condition is the same pile wherever it lives.
 * The whole move happens or none of it does, so a card cannot be taken from one
 * side without arriving at the other.
 */
export function moveCard(
  lib: Library,
  fromId: string,
  toId: string,
  key: string,
  count: number,
  at: number,
): Library {
  if (fromId === toId || count <= 0) return lib;
  const from = byId(lib, fromId);
  const to = byId(lib, toId);
  if (!from || !to) return lib;
  const pile = from.entries.find((e) => e.key === key);
  if (!pile) return lib;

  const moved = Math.min(count, pile.quantity);
  if (moved <= 0) return lib;

  const afterTake = update(
    lib, fromId, (c) => ({ ...c, entries: setQuantity(c.entries, key, pile.quantity - moved) }), at,
  );

  const destKey = entryKey(pile.cardId, pile.variant, pile.condition, pile.grade);
  return update(afterTake, toId, (c) => {
    const at_ = c.entries.findIndex((e) => e.key === destKey);
    if (at_ >= 0) {
      const next = c.entries.slice();
      next[at_] = {
        ...next[at_], quantity: next[at_].quantity + moved, updatedAt: at,
      };
      const [head] = next.splice(at_, 1);
      return { ...c, entries: [head, ...next] };
    }
    return {
      ...c,
      entries: [{ ...pile, key: destKey, quantity: moved, addedAt: at, updatedAt: at }, ...c.entries],
    };
  }, at);
}

/** Trim and bound a name typed by a person. */
export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 40);
}

/**
 * Read whatever is on disk.
 *
 * Accepts the single-collection file the app shipped with and turns it into a
 * library of one, so an upgrade keeps every card. A file that cannot be
 * understood at all becomes an empty library rather than throwing - the app
 * opening with nothing is bad, the app not opening is worse, and the unreadable
 * file is kept beside it for recovery by the caller.
 */
export function loadLibrary(raw: unknown, at: number): Library {
  if (!raw || typeof raw !== 'object') return freshLibrary(at);

  const r = raw as Partial<Library> & Partial<Persisted>;

  if (r.version === 2 && Array.isArray(r.collections) && r.collections.length) {
    const collections = r.collections
      .filter((c): c is Collection => !!c && typeof c === 'object' && typeof c.id === 'string')
      .map((c) => ({
        id: c.id,
        name: cleanName(String(c.name ?? '')) || 'Untitled',
        entries: Array.isArray(c.entries) ? c.entries : [],
        wishlist: Array.isArray(c.wishlist) ? c.wishlist : [],
        history: Array.isArray(c.history) ? c.history : [],
        createdAt: typeof c.createdAt === 'number' ? c.createdAt : at,
        updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : at,
      }));
    if (!collections.length) return freshLibrary(at);
    const activeId = collections.some((c) => c.id === r.activeId)
      ? (r.activeId as string)
      : collections[0].id;
    return { version: 2, collections, activeId };
  }

  // The version 1 file: one collection, unnamed.
  if (Array.isArray(r.entries)) {
    const only: Collection = {
      id: newId(at),
      name: 'My collection',
      entries: r.entries,
      wishlist: Array.isArray(r.wishlist) ? r.wishlist : [],
      history: Array.isArray(r.history) ? r.history : [],
      createdAt: at,
      updatedAt: at,
    };
    return { version: 2, collections: [only], activeId: only.id };
  }

  return freshLibrary(at);
}

/** Cards and value across every collection, for a paywall or a header. */
export function libraryTotals(lib: Library): { collections: number; cards: number } {
  let cards = 0;
  for (const c of lib.collections) for (const e of c.entries) cards += e.quantity;
  return { collections: lib.collections.length, cards };
}
