/**
 * What the paywall says a plan costs.
 *
 * The screen may only state what the store returned: the price string, the
 * period, a trial the buyer can actually have. Each case below is a way of
 * saying something about money that is not true - a trial offered to someone
 * who has used theirs, a quarterly plan labelled monthly, a saving rounded up.
 *
 *   node --experimental-strip-types apps/mobile/test/plans.test.ts
 */

import {
  ctaLabel, defaultPlan, orderPlans, periodOf, perWeek, planLine, planName, savingPercent,
  termsLine, trialDaysOf, type Plan,
} from '../src/plans.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const monthly: Plan = { id: 'pro.monthly', price: '$4.99', amount: 4.99, period: 'month' };
const yearly: Plan = { id: 'pro.yearly', price: '$29.99', amount: 29.99, period: 'year' };
const weekly: Plan = { id: 'pro.weekly', price: '$4.99', amount: 4.99, period: 'week', trialDays: 3 };

// 1. Periods: the three this app can describe, and nothing else.
check('P1W is a week', periodOf('P1W') === 'week');
check('P7D is a week', periodOf('P7D') === 'week');
check('P1M is a month', periodOf('P1M') === 'month');
check('P1Y is a year', periodOf('P1Y') === 'year');
check('a quarterly plan is not offered as something else', periodOf('P3M') === null);
check('a quarterly plan is not rescued by its package type', periodOf('P3M', 'MONTHLY') === null);
check('no period falls back to the package type', periodOf(null, 'ANNUAL') === 'year');
check('nothing known is nothing', periodOf(null, 'CUSTOM') === null && periodOf(undefined) === null);

// 2. Trials: free, and only for someone who can still take one.
const freeTrial = { price: 0, periodUnit: 'DAY', periodNumberOfUnits: 3, cycles: 1 };
check('a 3-day free trial is 3 days', trialDaysOf(freeTrial, true) === 3);
check('a 1-week free trial is 7 days',
  trialDaysOf({ price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 }, true) === 7);
check('someone who used their trial is not promised another',
  trialDaysOf(freeTrial, false) === undefined);
check('a discounted first period is not called free',
  trialDaysOf({ price: 0.99, periodUnit: 'WEEK', periodNumberOfUnits: 1 }, true) === undefined);
check('no introductory offer is no trial', trialDaysOf(null, true) === undefined);
check('an unreadable unit is no trial',
  trialDaysOf({ price: 0, periodUnit: 'FORTNIGHT', periodNumberOfUnits: 1 }, true) === undefined);

// 3. Comparing plans of different lengths.
check('a year costs less per week than a month here', perWeek(yearly) < perWeek(monthly));
{
  const ordered = orderPlans([monthly, weekly, yearly]).map((p) => p.period).join(',');
  check('best value first', ordered === 'year,month,week', ordered);
}
{
  // $29.99/yr against $4.99/mo: 29.99 / 59.88 = 0.5008, so 49.9% less.
  const pct = savingPercent(yearly, [monthly, yearly]);
  check('a 49.9% saving is "49", never "50"', pct === 49, `${pct}`);
  check('the dearest plan saves nothing', savingPercent(monthly, [monthly, yearly]) === 0);
  check('one plan has nothing to be compared with', savingPercent(yearly, [yearly]) === 0);
  const near = { ...monthly, id: 'x', amount: 4.9 };
  check('a saving under 5% is not claimed', savingPercent(near, [monthly, near]) === 0);
}

// 4. Which plan is selected first.
check('no plans, no selection', defaultPlan([]) === null);
check('best value by default', defaultPlan([monthly, yearly])?.id === 'pro.yearly');
check('a preferred length wins when it is on sale',
  defaultPlan([monthly, yearly, weekly], 'week')?.id === 'pro.weekly');
check('a preferred length that is not on sale changes nothing',
  defaultPlan([monthly, yearly], 'week')?.id === 'pro.yearly');

// 5. The words. Each one must carry the price and the period.
check('plan line', planLine(monthly) === '$4.99 / month', planLine(monthly));
check('plan names', planName(weekly) === 'Weekly' && planName(monthly) === 'Monthly'
  && planName(yearly) === 'Yearly');
check('the button names the price', ctaLabel(yearly) === 'Subscribe for $29.99 / year', ctaLabel(yearly));
check('the button names the trial when there is one', ctaLabel(weekly) === 'Try 3 days free');
check('one day is singular',
  ctaLabel({ ...weekly, trialDays: 1 }) === 'Try 1 day free');
for (const p of [monthly, yearly, weekly]) {
  const line = termsLine(p);
  check(`terms for ${p.period}: price, period, renewal, cancellation`,
    line.includes(p.price) && line.includes(`every ${p.period}`)
    && /renews automatically/i.test(line) && /cancel/i.test(line), line);
}
check('trial terms say what is charged afterwards',
  termsLine(weekly).startsWith('Free for 3 days, then $4.99 every week.'), termsLine(weekly));
check('no trial, no mention of one', !/free/i.test(termsLine(monthly)));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
