/**
 * Refreshing prices, and re-pricing what was already scanned.
 *
 * A card's price is stored on the entry when it is scanned, so a collection is
 * a list of prices from every date the user ever scanned on. Left alone, the
 * headline total is meaningless and the value chart records when someone
 * scanned rather than what happened to the market. So a refresh has to walk the
 * collection - and doing that carelessly is how a total silently loses money.
 *
 *   node --experimental-strip-types apps/mobile/test/prices.test.ts
 */

import { addScan, entryValue, reprice, repriceWishlist, totalValue } from '../src/collection.ts';
import { acceptable, freshness, isStale, refreshDue } from '../src/prices.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

// Local time: the freshness label is about the device's own calendar day.
const T = Date.parse('2026-08-14T10:00:00');
const card = (i: string, n: string) => ({
  i, n, u: '4', s: 'base1', S: 'Base', r: 'Rare Holo', d: '1999/01/09', p: 1, t: null,
});

/** Two piles: a Holofoil at $100 and a Normal at $10, both Near Mint. */
function seeded() {
  let e = addScan([], card('base1-4', 'Charizard'), 'Holofoil', 100, 'NM', false);
  e = addScan(e, card('base1-58', 'Pikachu'), 'Normal', 10, 'NM', false);
  return e;
}

// 1. A refresh moves the price and leaves everything else alone.
{
  const before = seeded();
  const after = reprice(before, (id) => (id === 'base1-4' ? 150 : 12));
  check('the price moves', after[0].unitPrice === 150 || after[1].unitPrice === 150);
  check(
    'the total follows',
    Math.abs(totalValue(after) - 162) < 0.001,
    `${totalValue(after)}`,
  );
  const holo = after.find((x) => x.cardId === 'base1-4')!;
  const was = before.find((x) => x.cardId === 'base1-4')!;
  check('the variant is untouched', holo.variant === was.variant);
  check('the condition is untouched', holo.condition === was.condition);
  check('the quantity is untouched', holo.quantity === was.quantity);
  check('the key is untouched', holo.key === was.key);
  /*
   * updatedAt must NOT move. A repricing is not the user handling the card;
   * stamping it would push every pile to the top of a "recent" sort and point
   * the scan feed's undo at the wrong entry.
   */
  check('updatedAt is untouched', holo.updatedAt === was.updatedAt);
}

/*
 * 2. A card the new feed has no price for keeps the one it had. A feed that
 *    drops a card for a day must not take real money off the total.
 */
{
  const before = seeded();
  const after = reprice(before, (id) => (id === 'base1-4' ? null : 12));
  const holo = after.find((x) => x.cardId === 'base1-4')!;
  check('a missing price is kept, not zeroed', holo.unitPrice === 100, `${holo.unitPrice}`);
  check('and the other card still updated', after.find((x) => x.cardId === 'base1-58')!.unitPrice === 12);
}

// 3. Nothing moving returns the very same array, so no render and no disk write.
{
  const before = seeded();
  check('an unchanged refresh is identity', reprice(before, () => null) === before);
  check(
    'and so is one that returns the same numbers',
    reprice(before, (id) => (id === 'base1-4' ? 100 : 10)) === before,
  );
}

// 4. The condition multiplier still applies after a refresh.
{
  let e = addScan([], card('base1-4', 'Charizard'), 'Holofoil', 100, 'LP', false);
  e = reprice(e, () => 200);
  check(
    'a Lightly Played card reprices at 85%',
    Math.abs(entryValue(e[0]) - 170) < 0.001,
    `${entryValue(e[0])}`,
  );
}

// 5. The want list reprices the same way.
{
  const list = [{ cardId: 'base1-4', name: 'Charizard', setName: 'Base', number: '4',
    unitPrice: 100, addedAt: T }];
  check('a want list entry reprices', repriceWishlist(list, () => 250)[0].unitPrice === 250);
  check('and keeps a missing price', repriceWishlist(list, () => null)[0].unitPrice === 100);
}

/*
 * 6. A downloaded file has to be checked before it is trusted. The failure this
 *    prevents is a truncated file replacing a good one, which would come up as
 *    a third of the collection unpriced and thousands of dollars gone, with
 *    nothing on screen to say why.
 */
{
  const good = { updated: '2026-08-14', currency: 'USD', source: 'x', prices: {} as Record<string, unknown> };
  for (let i = 0; i < 20000; i++) good.prices[`c${i}`] = { Normal: { m: 1, l: 1, h: 1 } };

  check('a full file is accepted', acceptable(good, null));
  check('junk is refused', !acceptable('nonsense', null));
  check('an empty file is refused', !acceptable({ ...good, prices: {} }, null));
  check('a file with no date is refused', !acceptable({ ...good, updated: 1 }, null));

  const truncated = { ...good, prices: Object.fromEntries(Object.entries(good.prices).slice(0, 2000)) };
  check(
    'a file that lost 90% of its cards is refused',
    !acceptable(truncated, good as never),
    'this is the one that silently deletes money',
  );
  const slightlySmaller = {
    ...good, prices: Object.fromEntries(Object.entries(good.prices).slice(0, 19500)),
  };
  check('a normal week-to-week wobble is accepted', acceptable(slightlySmaller, good as never));
}

// 7. A daily check is due once the calendar day turns, and not before.
{
  const state = { updated: '2026-08-13', source: 'x', checkedAt: T };
  check('not due again the same day', !refreshDue(state, T + 3600000));
  check('due the next day', refreshDue(state, T + 86400000));
  check('due when never checked', refreshDue({ ...state, checkedAt: 0 }, T));
}

/*
 * 8. The freshness line says something true.
 *
 * Counted in whole days between two dates, not in elapsed hours. The file
 * carries a date and nothing finer, and measuring hours made a file built
 * yesterday morning read as "updated today" - a small lie about the one thing
 * that makes a price trustworthy.
 */
{
  check('today', freshness('2026-08-14', T) === 'updated today', freshness('2026-08-14', T));
  check('yesterday', freshness('2026-08-13', T) === 'updated yesterday', freshness('2026-08-13', T));
  check('a week', freshness('2026-08-07', T) === 'updated 7 days ago', freshness('2026-08-07', T));
  check('months', freshness('2026-05-14', T).includes('month'), freshness('2026-05-14', T));
  /*
   * The hour must not change the answer within one LOCAL day, or the label
   * flickers while nothing happened. Written in local time on purpose: an
   * earlier version of this test used two UTC moments that fall on different
   * local days, and failed for the right reason - the code was correct and the
   * test was comparing yesterday with the day before.
   */
  const early = Date.parse('2026-08-14T00:30:00');
  const late = Date.parse('2026-08-14T23:30:00');
  check(
    'the same local day gives the same answer morning and night',
    freshness('2026-08-13', early) === freshness('2026-08-13', late),
    `${freshness('2026-08-13', early)} vs ${freshness('2026-08-13', late)}`,
  );
  check('a fresh file is not stale', !isStale('2026-08-13', T));
  check('a month-old file is stale', isStale('2026-07-01', T));
  check('an unreadable date counts as stale', isStale('nonsense', T));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
