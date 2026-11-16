/**
 * The rule that decides whether a card goes back in the box.
 *
 * Every case here is one where being wrong costs money in one direction only:
 * a valuable card called bulk. So the tests lean on the doubtful inputs - no
 * price, an unsettled printing, a rule read off a damaged file.
 *
 *   node --experimental-strip-types apps/mobile/test/sort.test.ts
 */

import {
  DEFAULT_RULE, KEEP_STEPS, PULL_STEPS, cycleKeep, cyclePull, emptyTally, normaliseRule,
  pileFor, ruleLabel, sortPrice, tally, type SortRule,
} from '../src/sort.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const rule: SortRule = { on: true, keepAt: 1, pullAt: 10 };

// --- piles ---------------------------------------------------------------
check('below the keep line is bulk', pileFor(0.99, rule) === 'bulk');
check('exactly on the keep line is kept', pileFor(1, rule) === 'keep');
check('just under the pull line is kept', pileFor(9.99, rule) === 'keep');
check('exactly on the pull line is pulled', pileFor(10, rule) === 'pull');
check('a free card is bulk, not unknown', pileFor(0, rule) === 'bulk');
check('an unpriced card is never bulk', pileFor(null, rule) === 'keep');
check('NaN is never bulk', pileFor(Number.NaN, rule) === 'keep');
check(
  'keep and pull on the same line leaves no keep band',
  pileFor(5, { on: true, keepAt: 5, pullAt: 5 }) === 'pull'
    && pileFor(4.99, { on: true, keepAt: 5, pullAt: 5 }) === 'bulk',
);

// --- the price a card is sorted by ----------------------------------------
check('a card sorts at its dearest printing', sortPrice([0.1, 30]) === 30);
check(
  'so the $30 reverse holo that reads as a 10¢ common is pulled',
  pileFor(sortPrice([0.1, 30]), rule) === 'pull',
);
check('a single printing sorts at its own price', sortPrice([0.1]) === 0.1);
check('unpriced printings are skipped, not counted as zero', sortPrice([null, 4, undefined]) === 4);
check('no priced printing stays unknown', sortPrice([null, undefined]) === null);
check('nothing at all is unknown', sortPrice([]) === null);
check('and unknown is kept, not binned', pileFor(sortPrice([]), rule) === 'keep');
check('NaN and Infinity are not prices', sortPrice([Number.NaN, Infinity, 2]) === 2);

// --- the rule off disk ------------------------------------------------------
check('nothing on disk is the default, and the default is off', normaliseRule(null) === DEFAULT_RULE && !DEFAULT_RULE.on);
check('a good rule survives', JSON.stringify(normaliseRule({ on: true, keepAt: 2, pullAt: 20 }))
  === JSON.stringify({ on: true, keepAt: 2, pullAt: 20 }));
check('a value off the ladder is replaced', normaliseRule({ on: true, keepAt: 3, pullAt: 7 }).keepAt === 1
  && normaliseRule({ on: true, keepAt: 3, pullAt: 7 }).pullAt === 10);
check('"on" must be exactly true', normaliseRule({ on: 'yes', keepAt: 1, pullAt: 10 }).on === false);
check('a pull line under the keep line is lifted, not dropped', (() => {
  const r = normaliseRule({ on: true, keepAt: 5, pullAt: 5 });
  return r.pullAt >= r.keepAt;
})());

// --- changing it with a thumb ----------------------------------------------
{
  let r: SortRule = { on: true, keepAt: 1, pullAt: 10 };
  const seen = new Set<number>();
  for (let i = 0; i < KEEP_STEPS.length; i++) { r = cycleKeep(r); seen.add(r.keepAt); }
  check('tapping keep visits every step and comes back', seen.size === KEEP_STEPS.length && r.keepAt === 1);
  let ok = true;
  r = { on: true, keepAt: 5, pullAt: 5 };
  for (let i = 0; i < 12; i++) { r = cyclePull(r); if (r.pullAt < r.keepAt) ok = false; }
  check('tapping pull never lands under the keep line', ok);
  let p: SortRule = { on: true, keepAt: 1, pullAt: 10 };
  const seenPull = new Set<number>();
  for (let i = 0; i < PULL_STEPS.length; i++) { p = cyclePull(p); seenPull.add(p.pullAt); }
  check('tapping pull visits every step', seenPull.size === PULL_STEPS.length);
  check('raising keep past pull drags pull up', cycleKeep({ on: true, keepAt: 2, pullAt: 5 }).pullAt === 5
    && cycleKeep({ on: true, keepAt: 2, pullAt: 5 }).keepAt === 5);
}

// --- the tally ---------------------------------------------------------------
{
  let t = emptyTally();
  t = tally(t, 'bulk', 0.05);
  t = tally(t, 'bulk', 0.1);
  t = tally(t, 'pull', 42);
  t = tally(t, 'keep', null);
  check('counts land on their pile', t.bulk.count === 2 && t.pull.count === 1 && t.keep.count === 1);
  check('values add up', Math.abs(t.bulk.value - 0.15) < 1e-9 && t.pull.value === 42 && t.keep.value === 0);
  t = tally(t, 'pull', 42, -1);
  check('an undo takes the card back off', t.pull.count === 0 && t.pull.value === 0);
  t = tally(t, 'pull', 42, -1);
  check('an undo on an empty pile cannot go negative', t.pull.count === 0 && t.pull.value === 0);
  let d = emptyTally();
  d = tally(d, 'bulk', 0.1); d = tally(d, 'bulk', 0.2); d = tally(d, 'bulk', 0.1, -1);
  check('float drift does not leave a negative value', d.bulk.value >= 0 && d.bulk.count === 1);
}

// --- what it says -------------------------------------------------------------
check('off says Off', ruleLabel(DEFAULT_RULE) === 'Off');
check('cents read as cents', ruleLabel({ on: true, keepAt: 0.25, pullAt: 5 }) === 'Keep 25¢+ · Pull $5+');
check('one line reads as one line', ruleLabel({ on: true, keepAt: 5, pullAt: 5 }) === 'Pull $5+');

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
