/**
 * The collection's arithmetic.
 *
 * These are the operations that quietly lose or duplicate cards: merging a
 * repeat scan into an existing pile, moving a card to a different condition
 * when a pile already exists there, and resolving an ambiguous printing onto a
 * card the collection already holds. Each of those can collide, and a collision
 * handled wrongly either drops a card or counts it twice - neither of which
 * announces itself, because the list still looks plausible afterwards.
 *
 *   node --experimental-strip-types apps/mobile/test/collection.test.ts
 */

import {
  addScan, bySet, conditionOf, entryValue, reclassify, repoint, setQuantity,
  toCsv, totalCards, totalValue, type Entry,
} from '../src/collection.ts';
import type { CardRecord } from '../src/core/types.ts';

const card = (i: string, n: string, s = 'sv1', S = 'Scarlet & Violet'): CardRecord => ({
  i, n, u: '1', s, S, r: 'Common', d: null, p: 0,
} as CardRecord);

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// Scanning the same card twice is one pile of two, not two piles.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 2, 'NM', false);
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 2, 'NM', false);
  check('a repeat scan merges', e.length === 1 && e[0].quantity === 2,
    `${e.length} entries, qty ${e[0]?.quantity}`);
}

// The same card in a different condition is a different pile.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 10, 'NM', false);
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 10, 'LP', false);
  check('different conditions stay apart', e.length === 2, `${e.length} entries`);
  const want = 10 + 10 * conditionOf('LP').multiplier;
  check('played condition is discounted', Math.abs(totalValue(e) - want) < 1e-9,
    `${totalValue(e)} vs ${want}`);
}

// Moving a pile onto an existing pile adds up rather than replacing.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 10, 'NM', false);
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 10, 'NM', false); // qty 2
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 10, 'LP', false); // qty 1
  const lp = e.find((x) => x.condition === 'LP')!;
  e = reclassify(e, lp.key, { condition: 'NM' });
  check('reclassify merges into the pile it lands on',
    e.length === 1 && e[0].quantity === 3, `${e.length} entries, qty ${e[0]?.quantity}`);
  check('nothing is lost in the merge', totalCards(e) === 3, `${totalCards(e)} cards`);
}

// Resolving a printing onto a card already held merges too.
{
  let e: Entry[] = [];
  e = addScan(e, card('real', 'Skrelp', 'sv4', 'Paradox Rift'), 'Normal', 3, 'NM', false);
  e = addScan(e, card('guess', 'Skrelp', 'sv1', 'Scarlet & Violet'), 'Normal', 1, 'NM', true);
  check('an ambiguous scan is flagged', e.some((x) => x.needsPrinting));
  const wrong = e.find((x) => x.cardId === 'guess')!;
  e = repoint(e, wrong.key, card('real', 'Skrelp', 'sv4', 'Paradox Rift'), 'Normal', 3);
  check('resolving a printing merges onto the right card',
    e.length === 1 && e[0].quantity === 2 && e[0].cardId === 'real',
    `${e.length} entries, qty ${e[0]?.quantity}, id ${e[0]?.cardId}`);
  check('the flag clears once resolved', !e[0].needsPrinting);
}

// Quantity down to zero removes the row.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Pikachu'), 'Normal', 1, 'NM', false);
  e = setQuantity(e, e[0].key, 0);
  check('quantity zero removes the entry', e.length === 0, `${e.length} entries`);
}

// An unpriced card counts as a card but not as money.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Unpriced'), 'Normal', null, 'NM', false);
  check('unpriced cards are counted, not valued',
    totalCards(e) === 1 && totalValue(e) === 0, `${totalCards(e)} / ${totalValue(e)}`);
}

// Sets group by set, with their own totals.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'One', 'sv1', 'Set One'), 'Normal', 5, 'NM', false);
  e = addScan(e, card('b', 'Two', 'sv1', 'Set One'), 'Normal', 5, 'NM', false);
  e = addScan(e, card('c', 'Three', 'sv2', 'Set Two'), 'Normal', 1, 'NM', false);
  const groups = bySet(e);
  check('sets group and sort by value',
    groups.length === 2 && groups[0].setId === 'sv1' && groups[0].distinct.size === 2,
    JSON.stringify(groups.map((g) => [g.setId, g.distinct.size, g.value])));
}

// The CSV has to survive a card with a comma in its name.
{
  let e: Entry[] = [];
  e = addScan(e, card('a', 'Hisuian Growlithe, Radiant'), 'Reverse Holofoil', 4.5, 'LP', false);
  const csv = toCsv(e);
  const lines = csv.split('\n');
  check('csv has a header and a row', lines.length === 2, `${lines.length} lines`);
  check('a comma in a name is quoted', lines[1].includes('"Hisuian Growlithe, Radiant"'), lines[1]);
  check('csv line value uses the condition price',
    lines[1].endsWith(entryValue(e[0]).toFixed(2)), lines[1]);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
