/**
 * What the sort rule does to a whole box, by the year the set came out.
 *
 * A measuring tool, not a test (hence the underscore). It runs the shipped
 * functions - `sortable`, `sortPrice`, `pileFor` - over every card in the price
 * book, once with the 1st Edition printing left out (what ships) and once with
 * every printing counted (what shipped until build 139), so the cost and the
 * gain of that exception can be read off the same table.
 *
 *   node --experimental-strip-types apps/mobile/test/_sort_eras.ts
 *
 * Every card counts once. A real box is mostly commons, so the second table
 * - commons and uncommons only - is the closer picture of one.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pileFor, sortable, sortPrice, type Pile, type Printing, type SortRule } from '../src/sort.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const cards = JSON.parse(readFileSync(join(root, 'data', 'cards.json'), 'utf8')) as {
  sets: Array<[string, string, string]>;
  cards: Array<[string, string, string, string, ...unknown[]]>;
};
const book = JSON.parse(readFileSync(join(root, 'data', 'prices.json'), 'utf8')) as {
  updated: string;
  prices: Record<string, Record<string, { m?: number | null }>>;
};

const year = new Map(cards.sets.map(([id, , date]) => [id, Number(date.slice(0, 4))]));
const prices = new Map(Object.entries(book.prices));
const printings = (id: string): Printing[] =>
  Object.entries(prices.get(id) ?? {}).map(([variant, p]) => ({ variant, market: p.m ?? null }));

const ERAS: Array<[string, number, number]> = [
  ['1999-2002', 1999, 2002], ['2003-2010', 2003, 2010], ['2011-2016', 2011, 2016],
  ['2017-2019', 2017, 2019], ['2020-2022', 2020, 2022], ['2023 on', 2023, 9999],
];
const rule: SortRule = { on: true, keepAt: 1, pullAt: 10 };
const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(1)}%` : '-').padStart(6);

function table(title: string, keep: (rarity: string) => boolean) {
  console.log(`\n${title}  (keep $${rule.keepAt}, pull $${rule.pullAt}; price book of ${book.updated})`);
  console.log('era         cards |  ships: bulk   keep   pull |  every printing: bulk   keep   pull');
  for (const [label, from, to] of ERAS) {
    const count = { ships: { bulk: 0, keep: 0, pull: 0 }, all: { bulk: 0, keep: 0, pull: 0 } } as
      Record<'ships' | 'all', Record<Pile, number>>;
    let n = 0;
    for (const [id, , , rarity] of cards.cards) {
      const y = year.get(id.slice(0, id.lastIndexOf('-'))) ?? 0;
      if (y < from || y > to || !keep(rarity)) continue;
      n++;
      const vs = printings(id);
      count.ships[pileFor(sortPrice(sortable(vs).map((v) => v.market)), rule)]++;
      count.all[pileFor(sortPrice(vs.map((v) => v.market)), rule)]++;
    }
    console.log(
      `${label.padEnd(10)} ${String(n).padStart(6)} | ${' '.repeat(6)}${pct(count.ships.bulk, n)} ${pct(count.ships.keep, n)} ${pct(count.ships.pull, n)}`
      + ` | ${' '.repeat(15)}${pct(count.all.bulk, n)} ${pct(count.all.keep, n)} ${pct(count.all.pull, n)}`,
    );
  }
}

table('Every card', () => true);
table('Commons and uncommons', (r) => r === 'Common' || r === 'Uncommon');

// What the exception costs: 1st Edition printings that no longer ring what they are worth.
let stamped = 0;
let lostPull = 0;
let nowBulk = 0;
let nowBulkDear = 0;
for (const id of prices.keys()) {
  const vs = printings(id);
  if (sortable(vs).length === vs.length) continue;
  stamped++;
  const was = sortPrice(vs.map((v) => v.market));
  const is = sortPrice(sortable(vs).map((v) => v.market));
  if (pileFor(was, rule) === 'pull' && pileFor(is, rule) !== 'pull') lostPull++;
  if (pileFor(was, rule) !== 'bulk' && pileFor(is, rule) === 'bulk') {
    nowBulk++;
    if ((was ?? 0) >= rule.pullAt) nowBulkDear++;
  }
}
console.log(`\ncards with a 1st Edition left out: ${stamped}`);
console.log(`  whose 1st Edition would have rung pull and no longer does: ${lostPull}`);
console.log(`  whose 1st Edition is worth $${rule.keepAt}+ and now passes as bulk: ${nowBulk} (${nowBulkDear} of them $${rule.pullAt}+)`);
