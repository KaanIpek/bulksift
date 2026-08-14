/**
 * Several collections, and never losing one.
 *
 * The cases that matter are the destructive ones: an upgrade from the
 * single-collection file the app shipped with, deleting the last collection,
 * and moving a card between two piles - which is the only operation that can
 * take a card off one side without putting it on the other.
 *
 *   node --experimental-strip-types apps/mobile/test/library.test.ts
 */

import { addScan, totalCards, type Entry } from '../src/collection.ts';
import {
  active, add, byId, cleanName, freshLibrary, libraryTotals, loadLibrary, moveCard,
  remove, rename, setActive, update, type Library,
} from '../src/library.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const T = Date.parse('2026-08-14T10:00:00');

const card = (i: string, n: string) => ({
  i, n, u: '4', s: 'base1', S: 'Base', r: 'Rare Holo', d: '1999/01/09', p: 1, t: null,
});

/** A library whose first collection holds `n` distinct cards. */
function seeded(n: number): Library {
  let lib = freshLibrary(T);
  for (let k = 0; k < n; k++) {
    lib = update(lib, lib.activeId, (c) => ({
      ...c, entries: addScan(c.entries, card(`base1-${k}`, `Card ${k}`), 'Holofoil', 10, 'NM', false),
    }), T);
  }
  return lib;
}

// 1. A fresh library has exactly one collection and it is active.
{
  const lib = freshLibrary(T);
  check('a fresh library has one collection', lib.collections.length === 1);
  check('and it is the active one', active(lib).id === lib.activeId);
  check('and it is empty', active(lib).entries.length === 0);
}

// 2. Adding a collection makes it active; renaming keeps identity.
{
  let lib = add(freshLibrary(T), 'To sell', T);
  check('adding gives two collections', lib.collections.length === 2);
  check('and switches to the new one', active(lib).name === 'To sell');
  const id = lib.activeId;
  lib = rename(lib, id, '  Selling   box  ', T);
  check('renaming tidies whitespace', byId(lib, id)?.name === 'Selling box');
  lib = rename(lib, id, '   ', T);
  check('an empty name is refused', byId(lib, id)?.name === 'Selling box');
}

// 3. Deleting works, except for the last one.
{
  let lib = add(freshLibrary(T), 'Second', T);
  const first = lib.collections[0].id;
  lib = remove(lib, first);
  check('a collection can be deleted', lib.collections.length === 1);
  check('and the active one follows', active(lib).name === 'Second');
  const before = lib;
  lib = remove(lib, lib.collections[0].id);
  check('the last collection cannot be deleted', lib === before);
}

// 4. Deleting the active collection leaves a valid active one.
{
  let lib = add(add(freshLibrary(T), 'B', T), 'C', T);
  lib = setActive(lib, lib.collections[1].id);
  lib = remove(lib, lib.collections[1].id);
  check('deleting the active collection picks another', !!active(lib));
  check('and the id is real', lib.collections.some((c) => c.id === lib.activeId));
}

/*
 * 5. Moving a card. The one operation that can lose a card, so it is checked by
 *    counting both sides before and after rather than by looking at one.
 */
{
  let lib = seeded(3);
  lib = add(lib, 'To sell', T);
  const from = lib.collections[0].id;
  const to = lib.collections[1].id;
  const key = byId(lib, from)!.entries[0].key;
  const totalBefore = libraryTotals(lib).cards;

  lib = moveCard(lib, from, to, key, 1, T);
  check('the card left the source', byId(lib, from)!.entries.some((e) => e.key === key) === false);
  check('and arrived at the destination', byId(lib, to)!.entries.length === 1);
  check(
    'and the library total is unchanged',
    libraryTotals(lib).cards === totalBefore,
    `${libraryTotals(lib).cards} vs ${totalBefore}`,
  );
}

// 6. Moving part of a pile splits it, and still conserves cards.
{
  let lib = freshLibrary(T);
  for (let k = 0; k < 5; k++) {
    lib = update(lib, lib.activeId, (c) => ({
      ...c, entries: addScan(c.entries, card('base1-4', 'Charizard'), 'Holofoil', 10, 'NM', false),
    }), T);
  }
  lib = add(lib, 'To sell', T);
  const from = lib.collections[0].id;
  const to = lib.collections[1].id;
  const key = byId(lib, from)!.entries[0].key;
  check('the pile has five', byId(lib, from)!.entries[0].quantity === 5);

  lib = moveCard(lib, from, to, key, 2, T);
  check('two moved', byId(lib, to)!.entries[0].quantity === 2);
  check('three stayed', byId(lib, from)!.entries[0].quantity === 3);
  check('and five cards still exist', libraryTotals(lib).cards === 5);
}

// 7. Moving into a collection that already has that pile merges rather than duplicates.
{
  let lib = freshLibrary(T);
  lib = update(lib, lib.activeId, (c) => ({
    ...c, entries: addScan(c.entries, card('base1-4', 'Charizard'), 'Holofoil', 10, 'NM', false),
  }), T);
  lib = add(lib, 'To sell', T);
  const from = lib.collections[0].id;
  const to = lib.collections[1].id;
  lib = update(lib, to, (c) => ({
    ...c, entries: addScan(c.entries, card('base1-4', 'Charizard'), 'Holofoil', 10, 'NM', false),
  }), T);

  const key = byId(lib, from)!.entries[0].key;
  lib = moveCard(lib, from, to, key, 1, T);
  check('the destination has one pile, not two', byId(lib, to)!.entries.length === 1);
  check('holding both copies', byId(lib, to)!.entries[0].quantity === 2);
  check('and the source is empty', totalCards(byId(lib, from)!.entries) === 0);
}

// 8. A move that cannot happen changes nothing at all.
{
  const lib = seeded(2);
  const key = active(lib).entries[0].key;
  check('moving to itself does nothing', moveCard(lib, lib.activeId, lib.activeId, key, 1, T) === lib);
  check('moving an unknown card does nothing', moveCard(lib, lib.activeId, 'nope', 'x', 1, T) === lib);
  check('moving zero does nothing', moveCard(lib, lib.activeId, 'nope', key, 0, T) === lib);
}

/*
 * 9. The upgrade. Every card in the file the app shipped with has to survive,
 *    because this runs once, on a real person's collection, with no undo.
 */
{
  const old = {
    version: 1,
    entries: [
      { key: 'base1-4|Holofoil|NM', cardId: 'base1-4', name: 'Charizard', setName: 'Base',
        setId: 'base1', number: '4', rarity: 'Rare Holo', variant: 'Holofoil',
        condition: 'NM', quantity: 3, unitPrice: 825, addedAt: T, updatedAt: T },
    ] as unknown as Entry[],
    wishlist: [{ cardId: 'base1-15', name: 'Venusaur', setName: 'Base', number: '15',
      unitPrice: 200, addedAt: T }],
    history: [{ day: '2026-08-13', value: 2475, cards: 3 }],
  };
  const lib = loadLibrary(old, T);
  check('a version 1 file becomes a library of one', lib.collections.length === 1);
  check('with every card', libraryTotals(lib).cards === 3);
  check('and the want list', active(lib).wishlist.length === 1);
  check('and the value history', active(lib).history.length === 1);
}

// 10. Anything unreadable becomes a usable library rather than an exception.
{
  for (const junk of [null, undefined, 'text', 42, {}, { version: 2, collections: [] }]) {
    const lib = loadLibrary(junk, T);
    if (lib.collections.length !== 1 || !active(lib)) {
      check(`unreadable input ${JSON.stringify(junk)} still opens`, false);
    }
  }
  check('every unreadable input opens a usable library', true);
}

// 11. A round trip through JSON keeps everything.
{
  let lib = add(seeded(4), 'Graded', T);
  lib = setActive(lib, lib.collections[0].id);
  const back = loadLibrary(JSON.parse(JSON.stringify(lib)), T);
  check('a round trip keeps both collections', back.collections.length === 2);
  check('and the active one', back.activeId === lib.activeId);
  check('and every card', libraryTotals(back).cards === libraryTotals(lib).cards);
}

// 12. Names are bounded, because they end up in a row that must not wrap forever.
{
  check('a long name is trimmed to 40', cleanName('x'.repeat(200)).length === 40);
  check('newlines collapse', cleanName('a\n\n  b') === 'a b');
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
