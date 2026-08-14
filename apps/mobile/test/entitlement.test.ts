/**
 * The arithmetic that decides whether someone gets what they paid for.
 *
 * This is the one part of the app where a bug takes money, so it is written as
 * pure functions over a plain record and tested without a store, an ad network
 * or a device. The cases below are the ones where a naive implementation quietly
 * cheats the user: a clock moved backwards, a lapsed subscription, a scan spent
 * out of the wrong pot.
 *
 *   node --experimental-strip-types apps/mobile/test/entitlement.test.ts
 */

import {
  LIMITS, allowanceLabel, canScan, canWatchAd, dayKey, fresh, grantAd, grantPack,
  normalise, refill, refund, scansLeft, setPro, spend, type Entitlement,
} from '../src/entitlement.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const T0 = Date.parse('2026-08-14T10:00:00');
const DAY = 86400000;

/** Spend n scans in a row, refilling as a real app would on each. */
function scanTimes(e: Entitlement, n: number, at = T0): Entitlement {
  let cur = e;
  for (let i = 0; i < n; i++) {
    cur = refill(cur, at);
    if (canScan(cur) !== 'none') break;
    cur = spend(cur);
  }
  return cur;
}

// 1. A fresh install gets the free ration and nothing else.
{
  const e = fresh(T0);
  check(`a fresh install has ${LIMITS.freePerDay} free scans`, e.freeLeft === LIMITS.freePerDay);
  check('and no credits', e.credits === 0);
  check('and can scan', canScan(e) === 'none');
}

// 2. The ration runs out, and says so rather than going negative.
{
  const e = scanTimes(fresh(T0), LIMITS.freePerDay + 10);
  check('the free ration runs out exactly', e.freeLeft === 0, `left ${e.freeLeft}`);
  check('and never goes negative', e.freeLeft >= 0 && e.credits >= 0);
  check('and scanning is blocked', canScan(e) === 'out-of-scans');
  check(
    `only ${LIMITS.freePerDay} scans were counted`,
    e.scansEver === LIMITS.freePerDay,
    `counted ${e.scansEver}`,
  );
}

// 3. Tomorrow refills the ration.
{
  const spent = scanTimes(fresh(T0), LIMITS.freePerDay);
  const next = refill(spent, T0 + DAY);
  check('a new day refills the free ration', next.freeLeft === LIMITS.freePerDay);
  check('and does not touch credits', next.credits === spent.credits);
}

/*
 * 4. A clock moved backwards must not mint scans. Setting the date back a day
 *    is the oldest trick against a daily allowance, and the naive check -
 *    "is today's string different from the stored one" - hands out a fresh
 *    ration every time it is done.
 */
{
  const spent = scanTimes(fresh(T0), LIMITS.freePerDay);
  const back = refill(spent, T0 - DAY);
  check('a clock moved backwards does not refill', back.freeLeft === 0, `got ${back.freeLeft}`);
  check('and scanning stays blocked', canScan(back) === 'out-of-scans');
  // ...and the day it was set back to must not become the new baseline, or
  // moving forward again to the real date would then refill a second time.
  const forwardAgain = refill(back, T0);
  check('returning to the real date still does not refill', forwardAgain.freeLeft === 0);
  const genuinelyTomorrow = refill(forwardAgain, T0 + DAY);
  check('but a genuine new day does', genuinelyTomorrow.freeLeft === LIMITS.freePerDay);
}

/*
 * 5. The free ration is spent before credits.
 *    The other order destroys paid value every single day: the ration expires
 *    tonight regardless, so burning a bought credit while a free scan is
 *    sitting there unused is taking something the user paid for.
 */
{
  let e = grantPack(fresh(T0), 100);
  e = spend(e);
  check('a scan comes out of the free ration first', e.credits === 100 && e.freeLeft === LIMITS.freePerDay - 1);
  e = scanTimes(e, LIMITS.freePerDay);
  check('credits are only touched once the ration is gone', e.freeLeft === 0 && e.credits < 100);
}

/*
 * 6. Credits survive a new day. The ration resets; the balance does not, or
 *    a pack bought on Monday would be gone by Tuesday.
 */
{
  const e = refill(grantPack(fresh(T0), 40), T0 + DAY * 3);
  check('credits survive three days', e.credits === 40, `got ${e.credits}`);
  check('and the ration is full again', e.freeLeft === LIMITS.freePerDay);
}

// 7. Rewarded ads: capped per day, and the cap resets tomorrow.
{
  let e = fresh(T0);
  for (let i = 0; i < LIMITS.adsPerDay + 3; i++) e = grantAd(e);
  check(
    `at most ${LIMITS.adsPerDay} ads count in a day`,
    e.adsToday === LIMITS.adsPerDay && e.credits === LIMITS.adsPerDay * LIMITS.perAd,
    `${e.adsToday} ads, ${e.credits} credits`,
  );
  check('and no more may be watched', !canWatchAd(e));
  const tomorrow = refill(e, T0 + DAY);
  check('tomorrow allows ads again', canWatchAd(tomorrow));
  check('and keeps the credits earned today', tomorrow.credits === LIMITS.adsPerDay * LIMITS.perAd);
}

// 8. Pro removes the limit without consuming anything.
{
  let e = setPro(grantPack(fresh(T0), 12), true);
  check('Pro has no scan limit', scansLeft(e) === null);
  for (let i = 0; i < 500; i++) e = spend(e);
  check('500 scans on Pro spend no credits', e.credits === 12, `credits ${e.credits}`);
  check('and no free ration', e.freeLeft === LIMITS.freePerDay);
  check('but are counted', e.scansEver === 500);
}

/*
 * 9. Losing Pro must not take credits with it. A renewal that fails is not a
 *    reason to confiscate a pack the user bought separately.
 */
{
  const lapsed = setPro(setPro(grantPack(fresh(T0), 60), true), false);
  check('a lapsed subscription keeps bought credits', lapsed.credits === 60);
  check('and can still scan', canScan(lapsed) === 'none');
}

// 10. A rewarded ad while Pro is active is refused - there is nothing to earn.
{
  check('Pro cannot watch a rewarded ad', !canWatchAd(setPro(fresh(T0), true)));
}

/*
 * 11. A corrupt or hostile file cannot grant or steal. This is read off disk,
 *     which means it is the one input a determined user can edit.
 */
{
  check('garbage becomes a fresh record', normalise('nonsense', T0).freeLeft === LIMITS.freePerDay);
  check('negative credits become zero', normalise({ credits: -50 }, T0).credits === 0);
  check(
    'an inflated ration is capped',
    normalise({ freeLeft: 99999 }, T0).freeLeft === LIMITS.freePerDay,
  );
  check(
    'an inflated ad count is capped',
    normalise({ adsToday: 99999 }, T0).adsToday === LIMITS.adsPerDay,
  );
  check('fractional credits are floored', normalise({ credits: 7.9 }, T0).credits === 7);
  check('a bought balance is preserved', normalise({ credits: 250 }, T0).credits === 250);
  check('pro must be exactly true', normalise({ pro: 'yes' }, T0).pro === false);
}

// 12. A pack of a nonsense size grants nothing rather than NaN.
{
  const e = fresh(T0);
  check('a zero pack grants nothing', grantPack(e, 0).credits === 0);
  check('a negative pack grants nothing', grantPack(e, -10).credits === 0);
  check('a NaN pack grants nothing', grantPack(e, Number.NaN).credits === 0);
}

// 13. What the user is told is what is true.
{
  check(
    'a fresh install reads as free scans',
    allowanceLabel(fresh(T0)) === `${LIMITS.freePerDay} free today`,
    allowanceLabel(fresh(T0)),
  );
  check('Pro says unlimited', allowanceLabel(setPro(fresh(T0), true)).includes('unlimited'));
  const empty = scanTimes(fresh(T0), LIMITS.freePerDay);
  check('an empty allowance says so', allowanceLabel(empty) === 'No scans left today');
  const mixed = grantPack(scanTimes(fresh(T0), LIMITS.freePerDay - 2), 5);
  check(
    'a mixed allowance names both pots',
    mixed.freeLeft === 2 && allowanceLabel(mixed) === '2 free today · 5 credits',
    allowanceLabel(mixed),
  );
}

// 14. The day key is the device's calendar day, not UTC.
{
  const late = Date.parse('2026-08-14T23:30:00');
  const early = Date.parse('2026-08-15T00:30:00');
  check('late tonight and early tomorrow are different days', dayKey(late) !== dayKey(early));
  check('two moments in one evening are the same day',
    dayKey(late) === dayKey(late - 3600000));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
