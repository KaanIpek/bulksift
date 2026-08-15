/**
 * Getting one collection onto two devices without losing a card.
 *
 * The merge itself is in `merge.ts`, pure and tested, and it is where all the
 * difficulty lives - a pile has a quantity, so last-write-wins is wrong. This
 * file only moves bytes: pull what the server has, merge, push the result, and
 * remember what was agreed so the next merge has a base to work from.
 *
 * Three properties this is built around, and each one is a data-loss bug if it
 * is missing:
 *
 *  - It never runs unless someone is signed in, and the app is fully usable
 *    when nobody is. Recognition and prices are on the device; the account is a
 *    convenience laid on top.
 *  - A failed sync changes nothing locally. The device's own collection is the
 *    thing that must survive, so it is only replaced once a merge has actually
 *    produced something.
 *  - The agreed base is written only after the push succeeds. Recording it
 *    early would tell the next merge that changes had been shared when they had
 *    not, and those changes would be subtracted away as if the other side had
 *    deleted them.
 */

import type { Library } from './library';
import { emptySnapshot, mergeSnapshots, sweep, type Snapshot } from './merge';
import { authed, currentAccount } from './auth';

/**
 * One row per collection, keyed by the collection's own id.
 *
 * The whole collection travels as one JSON document rather than a row per card.
 * A row per card is the textbook answer and the wrong one here: a bulk session
 * touches hundreds of piles, and the merge needs the entire before-and-after
 * anyway, so per-row writes would be hundreds of round trips to compute
 * something that needs all of it at once.
 *
 *   create table collections (
 *     id           text primary key,
 *     user_id      uuid not null references auth.users on delete cascade,
 *     name         text not null,
 *     body         jsonb not null,
 *     updated_at   timestamptz not null default now()
 *   );
 *   alter table collections enable row level security;
 *   create policy "own rows" on collections
 *     for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */
const TABLE = 'collections';

export type SyncOutcome =
  | { status: 'synced'; library: Library; at: number }
  | { status: 'signed-out' }
  | { status: 'unavailable'; reason: string };

/** The last state both sides agreed on, per collection. */
export type Bases = Record<string, Snapshot>;

const asSnapshot = (body: unknown): Snapshot => {
  const b = (body ?? {}) as Partial<Snapshot>;
  return {
    entries: Array.isArray(b.entries) ? b.entries : [],
    wishlist: Array.isArray(b.wishlist) ? b.wishlist : [],
    history: Array.isArray(b.history) ? b.history : [],
    removed: b.removed && typeof b.removed === 'object' ? b.removed : {},
  };
};

/**
 * Sync every collection once.
 *
 * Returns the merged library and the bases to remember, or says why not. It
 * does not write anything to disk - the caller owns that, so a sync and a save
 * cannot half-happen independently.
 */
export async function syncOnce(
  library: Library,
  bases: Bases,
  at: number,
): Promise<SyncOutcome & { bases?: Bases }> {
  const c = authed();
  const me = currentAccount();
  if (!c || !me) return { status: 'signed-out' };

  try {
    const { data, error } = await c.from(TABLE).select('id,name,body').eq('user_id', me.id);
    if (error) return { status: 'unavailable', reason: error.message };

    const remote = new Map<string, { name: string; snap: Snapshot }>();
    for (const row of (data ?? []) as Array<{ id: string; name: string; body: unknown }>) {
      remote.set(row.id, { name: row.name, snap: asSnapshot(row.body) });
    }

    const nextBases: Bases = {};
    const collections = library.collections.map((col) => {
      const theirs = remote.get(col.id);
      const base = bases[col.id] ?? emptySnapshot();
      const mine: Snapshot = {
        entries: col.entries,
        wishlist: col.wishlist,
        history: col.history,
        removed: base.removed,
      };
      const merged = theirs ? mergeSnapshots(mine, theirs.snap, base) : mine;
      // Tombstones only need to outlive one round trip; a month is generous.
      merged.removed = sweep(merged.removed, at - 30 * 86400000);
      nextBases[col.id] = merged;
      return {
        ...col,
        entries: merged.entries,
        wishlist: merged.wishlist,
        history: merged.history,
      };
    });

    /*
     * Collections that exist only on the server belong to this account too -
     * made on another device - so they come down whole.
     */
    for (const [id, row] of remote) {
      if (collections.some((x) => x.id === id)) continue;
      collections.push({
        id,
        name: row.name,
        entries: row.snap.entries,
        wishlist: row.snap.wishlist,
        history: row.snap.history,
        createdAt: at,
        updatedAt: at,
      });
      nextBases[id] = row.snap;
    }

    const rows = collections.map((col) => ({
      id: col.id,
      user_id: me.id,
      name: col.name,
      body: {
        entries: col.entries,
        wishlist: col.wishlist,
        history: col.history,
        removed: nextBases[col.id]?.removed ?? {},
      },
      updated_at: new Date(at).toISOString(),
    }));

    const { error: pushError } = await c.from(TABLE).upsert(rows, { onConflict: 'id' });
    // The base is recorded only now. Recording it before the push would tell
    // the next merge that these changes had been shared when they had not, and
    // they would be subtracted away as if the other side had deleted them.
    if (pushError) return { status: 'unavailable', reason: pushError.message };

    const merged: Library = {
      ...library,
      collections,
      activeId: collections.some((x) => x.id === library.activeId)
        ? library.activeId
        : collections[0]?.id ?? library.activeId,
    };
    return { status: 'synced', library: merged, at, bases: nextBases };
  } catch (e) {
    return { status: 'unavailable', reason: String((e as Error)?.message ?? e) };
  }
}
