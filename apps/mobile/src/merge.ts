/**
 * Merging one device's collection with another's.
 *
 * The hard case, and the reason this is its own file with its own tests: a pile
 * has a QUANTITY. Last-write-wins is the standard answer for syncing rows and
 * it is wrong here - scan three Charizards on the phone and two on the tablet
 * while both are offline, and last-write-wins gives you three or two. It should
 * give you five, and nothing about the two records says so, because each one
 * only knows its own total.
 *
 * So quantities are merged by what CHANGED since the two sides last agreed,
 * which needs a third thing: the state at that moment. Each device keeps the
 * last synced snapshot, and the merge is
 *
 *     mine + theirs - base
 *
 * applied per pile. Three Charizards here, two there, none at the last sync
 * gives five. Three here and three there when the last sync already had three
 * gives three, because neither side changed anything.
 *
 * That is a convergent replicated counter, and it is the only rule that gets
 * both of those right. It also means a delete has to be recorded rather than
 * inferred - see `removed` below - because "this pile is absent" and "this pile
 * was deleted" are the same shape and opposite meanings.
 */

import type { Entry, WishEntry } from './collection';
import type { Point } from './history';

export interface Snapshot {
  entries: Entry[];
  wishlist: WishEntry[];
  history: Point[];
  /**
   * Piles deliberately removed, and when.
   *
   * Without this a delete cannot survive a merge: the other side still has the
   * pile, sees it missing here, and treats that as "not yet synced" rather than
   * "gone". Kept as tombstones rather than dropped, which is why they carry a
   * time - they can be swept once both sides are known to have seen them.
   */
  removed: Record<string, number>;
}

export const emptySnapshot = (): Snapshot =>
  ({ entries: [], wishlist: [], history: [], removed: {} });

const byKey = (list: Entry[]) => new Map(list.map((e) => [e.key, e]));

/**
 * Merge two collections that share a common ancestor.
 *
 * `base` is the state both sides last agreed on. Passing an empty snapshot is
 * safe and means "these two have never synced" - quantities then add, which is
 * the right answer for a device joining an account for the first time.
 */
export function mergeEntries(
  mine: Entry[],
  theirs: Entry[],
  base: Entry[],
  removed: Record<string, number> = {},
): Entry[] {
  const m = byKey(mine);
  const t = byKey(theirs);
  const b = byKey(base);

  const keys = new Set([...m.keys(), ...t.keys(), ...b.keys()]);
  const out: Entry[] = [];

  for (const key of keys) {
    const a = m.get(key);
    const c = t.get(key);
    const z = b.get(key);

    const qa = a?.quantity ?? 0;
    const qc = c?.quantity ?? 0;
    const qz = z?.quantity ?? 0;

    /*
     * Both sides' changes, applied to the agreed base. Clamped at zero: two
     * devices that each removed the same two copies would otherwise reach a
     * negative pile, which is not a thing anyone owns.
     */
    const quantity = Math.max(0, qa + qc - qz);

    // An explicit delete beats an arithmetic result. Someone said "remove this".
    const tombstone = removed[key];
    if (tombstone) {
      const touched = Math.max(a?.updatedAt ?? 0, c?.updatedAt ?? 0);
      if (touched <= tombstone) continue;
    }

    if (quantity <= 0) continue;

    /*
     * Everything that is not a quantity is last-write-wins on `updatedAt`,
     * which is correct for those: a condition or a grade is a statement about
     * the card, and the most recent statement is the one that stands.
     */
    const newer = !a ? c : !c ? a : (c.updatedAt > a.updatedAt ? c : a);
    if (!newer) continue;
    out.push({ ...newer, quantity });
  }

  // Most recently touched first, as everywhere else in the app.
  return out.sort((x, y) => y.updatedAt - x.updatedAt);
}

/**
 * The want list is a set, not a counter, so it merges as one.
 *
 * A card is on it or it is not; there is no "two of them wanted". Union, with
 * the newer record winning on price, and a removal recorded the same way a
 * deleted pile is.
 */
export function mergeWishlist(
  mine: WishEntry[],
  theirs: WishEntry[],
  removed: Record<string, number> = {},
): WishEntry[] {
  const out = new Map<string, WishEntry>();
  for (const w of [...mine, ...theirs]) {
    const have = out.get(w.cardId);
    if (!have || w.addedAt > have.addedAt) out.set(w.cardId, w);
  }
  for (const [cardId, at] of Object.entries(removed)) {
    const w = out.get(cardId);
    if (w && w.addedAt <= at) out.delete(cardId);
  }
  return [...out.values()].sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Value history: one point per day, and the two sides may have recorded
 * different days.
 *
 * Where both recorded the same day, the LARGER value wins rather than the more
 * recent. A day's point is meant to be that day's collection, and a device that
 * was only holding half the collection when it recorded would otherwise erase a
 * complete reading with a partial one.
 */
export function mergeHistory(mine: Point[], theirs: Point[]): Point[] {
  const out = new Map<string, Point>();
  for (const p of [...mine, ...theirs]) {
    const have = out.get(p.day);
    if (!have || p.value > have.value) out.set(p.day, p);
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Merge a whole snapshot. */
export function mergeSnapshots(mine: Snapshot, theirs: Snapshot, base: Snapshot): Snapshot {
  const removed = { ...theirs.removed, ...mine.removed };
  return {
    entries: mergeEntries(mine.entries, theirs.entries, base.entries, removed),
    wishlist: mergeWishlist(mine.wishlist, theirs.wishlist, removed),
    history: mergeHistory(mine.history, theirs.history),
    removed,
  };
}

/**
 * Forget tombstones both sides have certainly seen.
 *
 * A delete only needs to outlive one sync round trip. Keeping them forever
 * turns a deleted pile into a permanent record of a card someone chose not to
 * have, which grows without bound and is nobody's business.
 */
export function sweep(removed: Record<string, number>, olderThan: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(removed)) {
    if (at > olderThan) out[key] = at;
  }
  return out;
}

/**
 * Read the agreed bases back off disk, defensively.
 *
 * Pure and tested because getting it wrong is invisible and expensive. The
 * three-way merge computes `mine + theirs - base`, so a base that fails to
 * survive a restart makes the next sync look like a first sync - and a first
 * sync ADDS both sides. Scan three Charizards, close the app, sync, and there
 * are six. Nothing errors, nothing logs, the number is just wrong.
 *
 * Anything that is not a usable snapshot becomes an empty one, which is the
 * safe direction: an empty base double-counts at worst, while a malformed one
 * would subtract quantities that were never agreed.
 */
export function readBases(raw: unknown): Record<string, Snapshot> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, Snapshot> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Partial<Snapshot>;
    out[id] = {
      entries: Array.isArray(v.entries) ? v.entries : [],
      wishlist: Array.isArray(v.wishlist) ? v.wishlist : [],
      history: Array.isArray(v.history) ? v.history : [],
      removed: v.removed && typeof v.removed === 'object' && !Array.isArray(v.removed)
        ? v.removed
        : {},
    };
  }
  return out;
}
