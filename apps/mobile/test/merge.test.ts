/**
 * Two devices, one collection, and nothing lost.
 *
 * Every case here is one where last-write-wins - the standard answer for
 * syncing rows - gives the wrong number. They are written as the situations
 * that actually happen at a card show: a phone and a tablet both offline, both
 * scanning, meeting later.
 *
 *   node --experimental-strip-types apps/mobile/test/merge.test.ts
 */

import { addScan, setQuantity, totalCards, type Entry } from '../src/collection.ts';
import {
  emptySnapshot, mergeEntries, mergeHistory, mergeSnapshots, mergeWishlist, readBases, sweep,
} from '../src/merge.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const T = Date.parse('2026-08-14T10:00:00');
const card = (i: string, n: string) => ({
  i, n, u: '4', s: 'base1', S: 'Base', r: 'Rare Holo', d: '1999/01/09', p: 1, t: null,
});
const CHAR = card('base1-4', 'Charizard');
const PIKA = card('base1-58', 'Pikachu');

/** `n` copies of one card. */
function pile(c: typeof CHAR, n: number, at = T): Entry[] {
  let e: Entry[] = [];
  for (let i = 0; i < n; i++) e = addScan(e, c, 'Holofoil', 100, 'NM', false);
  return e.map((x) => ({ ...x, addedAt: at, updatedAt: at }));
}

/*
 * 1. THE CASE THAT RULES OUT LAST-WRITE-WINS.
 *    Three scanned on the phone, two on the tablet, neither aware of the other.
 *    Last-write-wins gives three or two. The answer is five.
 */
{
  const phone = pile(CHAR, 3);
  const tablet = pile(CHAR, 2, T + 1000);
  const merged = mergeEntries(phone, tablet, []);
  check(
    'three here and two there makes five',
    totalCards(merged) === 5,
    `${totalCards(merged)}`,
  );
  check('as one pile, not two', merged.length === 1);
}

/*
 * 2. And the inverse, which a naive "just add them" gets wrong: both devices
 *    already knew about the same three. Adding gives six.
 */
{
  const base = pile(CHAR, 3);
  const merged = mergeEntries(base, base, base);
  check(
    'three already agreed on stays three',
    totalCards(merged) === 3,
    `${totalCards(merged)}`,
  );
}

// 3. One side adds while the other does nothing.
{
  const base = pile(CHAR, 2);
  const phone = pile(CHAR, 5, T + 1000);
  const merged = mergeEntries(phone, base, base);
  check('two agreed, five here, still two there gives five', totalCards(merged) === 5,
    `${totalCards(merged)}`);
}

// 4. One side removes copies while the other adds.
{
  const base = pile(CHAR, 4);
  const phone = setQuantity(pile(CHAR, 4, T + 1000), pile(CHAR, 4)[0].key, 1);
  const tablet = pile(CHAR, 6, T + 2000);
  const merged = mergeEntries(phone, tablet, base);
  check(
    'minus three here and plus two there, from four, gives three',
    totalCards(merged) === 3,
    `${totalCards(merged)}`,
  );
}

// 5. Both sides remove the same copies. The pile must not go negative.
{
  const base = pile(CHAR, 2);
  const key = base[0].key;
  const gone = setQuantity(base, key, 0);
  const merged = mergeEntries(gone, gone, base);
  check('both removing the same two leaves none, not minus two', totalCards(merged) === 0,
    `${totalCards(merged)}`);
}

/*
 * 6. A delete that both sides can see in the base needs no tombstone.
 *
 *    This was written the other way round first, asserting that a deleted pile
 *    comes back without one - and it does not. With a shared base the
 *    arithmetic already says so: nothing here, three there, three agreed, gives
 *    3 - 3 = 0. Worth keeping as a test because it is the common case and it
 *    would be easy to "fix" the tombstone logic into breaking it.
 */
{
  const base = pile(CHAR, 3);
  const merged = mergeEntries([], base, base);
  check('a delete against a shared base needs no tombstone', totalCards(merged) === 0,
    `${totalCards(merged)}`);
}

/*
 * 7. THE CASE THE TOMBSTONE IS ACTUALLY FOR: no shared base.
 *
 *    A device syncing for the first time, or one whose base has been swept, has
 *    nothing to subtract from. "Absent here, present there" then reads as "not
 *    yet synced" rather than "deleted", and the pile comes back - every sync,
 *    forever, which is the classic way a deleted row refuses to die.
 */
{
  const theirs = pile(CHAR, 3);
  const key = theirs[0].key;

  const withoutTombstone = mergeEntries([], theirs, []);
  check(
    'with no shared base, a deleted pile does come back',
    totalCards(withoutTombstone) === 3,
    'this is the behaviour the tombstone exists to prevent',
  );

  const withTombstone = mergeEntries([], theirs, [], { [key]: T + 5000 });
  check('and a tombstone is what stops it', totalCards(withTombstone) === 0);

  // ...but a pile touched after the delete was re-added on purpose.
  const readded = pile(CHAR, 1, T + 9000);
  const afterReadd = mergeEntries(readded, [], [], { [key]: T + 5000 });
  check('re-adding after a delete wins', totalCards(afterReadd) === 1,
    `${totalCards(afterReadd)}`);
}

/*
 * 8. Everything that is not a quantity is last-write-wins, which IS right for
 *    those: a condition is a statement about the card, and the most recent
 *    statement stands.
 */
{
  const base = pile(CHAR, 1);
  const key = base[0].key;
  const phone = base.map((e) => ({ ...e, condition: 'LP' as const, updatedAt: T + 1000 }));
  const tablet = base.map((e) => ({ ...e, condition: 'MP' as const, updatedAt: T + 2000 }));
  const merged = mergeEntries(phone, tablet, base);
  check('the newer condition wins', merged[0].condition === 'MP', merged[0].condition);
  check('and the quantity is still one', totalCards(merged) === 1);
  void key;
}

// 9. Two different cards on two devices both survive.
{
  const merged = mergeEntries(pile(CHAR, 1), pile(PIKA, 1, T + 10), []);
  check('two different cards both survive', merged.length === 2);
}

// 10. A device joining for the first time has no base, and quantities add.
{
  const merged = mergeEntries(pile(CHAR, 4), pile(CHAR, 3, T + 10), emptySnapshot().entries);
  check('a first sync adds both sides', totalCards(merged) === 7, `${totalCards(merged)}`);
}

// 11. The want list is a set: union, newest record wins, deletes stick.
{
  const w = (id: string, at: number, price: number) =>
    ({ cardId: id, name: id, setName: 'Base', number: '4', unitPrice: price, addedAt: at });
  const merged = mergeWishlist([w('a', T, 10)], [w('a', T + 5, 20), w('b', T, 5)]);
  check('the want list unions', merged.length === 2);
  check('and the newer record wins', merged.find((x) => x.cardId === 'a')!.unitPrice === 20);
  const afterDelete = mergeWishlist([w('a', T, 10)], [w('a', T, 10)], { a: T + 1 });
  check('a removed want stays removed', afterDelete.length === 0);
}

/*
 * 12. History: one point per day, and where both recorded a day the LARGER
 *     value wins. A device holding half the collection must not erase a
 *     complete reading with a partial one.
 */
{
  const merged = mergeHistory(
    [{ day: '2026-08-13', value: 100, cards: 10 }, { day: '2026-08-14', value: 120, cards: 12 }],
    [{ day: '2026-08-13', value: 400, cards: 40 }],
  );
  check('history keeps one point per day', merged.length === 2);
  check(
    'and the fuller reading wins the shared day',
    merged.find((p) => p.day === '2026-08-13')!.value === 400,
  );
  check('sorted by day', merged[0].day < merged[1].day);
}

// 13. A whole snapshot merges, and tombstones from both sides are kept.
{
  const base = { ...emptySnapshot(), entries: pile(CHAR, 2) };
  const mine = { ...emptySnapshot(), entries: pile(CHAR, 3, T + 10), removed: { x: T } };
  const theirs = { ...emptySnapshot(), entries: pile(CHAR, 2), removed: { y: T } };
  const merged = mergeSnapshots(mine, theirs, base);
  check('the snapshot merges quantities', totalCards(merged.entries) === 3,
    `${totalCards(merged.entries)}`);
  check('and keeps both sides\' tombstones', !!merged.removed.x && !!merged.removed.y);
}

// 14. Tombstones are swept once they are old enough to have been seen.
{
  const swept = sweep({ old: T - 86400000 * 40, recent: T }, T - 86400000 * 30);
  check('an old tombstone is swept', swept.old === undefined);
  check('a recent one is kept', swept.recent === T);
}

/*
 * 15. The merge must be commutative: which device happens to sync first cannot
 *     change the answer, or two phones would disagree forever.
 */
{
  const base = pile(CHAR, 2);
  const a = pile(CHAR, 5, T + 100);
  const b = pile(CHAR, 3, T + 200);
  const ab = totalCards(mergeEntries(a, b, base));
  const ba = totalCards(mergeEntries(b, a, base));
  check(`merging either way round gives the same total (${ab})`, ab === ba, `${ab} vs ${ba}`);
}

// 16. And idempotent: syncing twice with nothing new must change nothing.
{
  const base = pile(CHAR, 2);
  const once = mergeEntries(pile(CHAR, 5, T + 100), base, base);
  const twice = mergeEntries(once, once, once);
  check('merging an already-merged state changes nothing',
    totalCards(twice) === totalCards(once), `${totalCards(twice)} vs ${totalCards(once)}`);
}

/*
 * 17. THE BASE HAS TO SURVIVE A RESTART.
 *
 *     This is the one that produced a real bug. The merge was written, tested
 *     and correct, and the base it depends on was never written to disk. Every
 *     sync after a relaunch then looked like a first sync - and a first sync
 *     adds both sides, so a collection doubles each time the app is reopened.
 *     Nothing errors and nothing logs; the number is simply wrong.
 */
{
  const base = { ...emptySnapshot(), entries: pile(CHAR, 3) };
  const saved = JSON.parse(JSON.stringify({ 'col-1': base })) as unknown;
  const back = readBases(saved);
  check('a base survives being written and read', back['col-1'] !== undefined);
  check(
    'with its quantities intact',
    totalCards(back['col-1'].entries) === 3,
    String(totalCards(back['col-1'].entries)),
  );

  // What it protects against: sync, restart, sync again, still three.
  const afterFirst = mergeEntries(pile(CHAR, 3), [], []);
  const afterRestart = mergeEntries(afterFirst, afterFirst, back['col-1'].entries);
  check(
    'syncing again after a restart does not double the pile',
    totalCards(afterRestart) === 3,
    String(totalCards(afterRestart)),
  );

  check('a missing file gives an empty base', Object.keys(readBases(null)).length === 0);
  check('and so does a hostile one', Object.keys(readBases('nope')).length === 0);
  const junk = readBases({ 'col-1': { entries: 'not an array', removed: [] } });
  check(
    'a malformed snapshot degrades to empty rather than throwing',
    junk['col-1'].entries.length === 0 && !Array.isArray(junk['col-1'].removed),
  );
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
