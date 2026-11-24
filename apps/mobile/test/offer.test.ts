/**
 * Which offer an install is on, and what changing it does to someone's scans.
 *
 * The remote file is the only thing in this app that changes what people get
 * without a new build, so the cases below are the ways it could go wrong: a
 * host that returns nonsense, a phone that loses signal, a switch that takes
 * away something that was bought, or an introductory paywall that ambushes
 * someone who has been using the app for a month.
 *
 *   node --experimental-strip-types apps/mobile/test/offer.test.ts
 */

import {
  CEILING, LIMITS, canWatchAd, fresh, grantAd, grantPack, normalise, refill, retune, setLimits,
  spend, type Entitlement,
} from '../src/entitlement.ts';
import {
  DEFAULT_OFFER, OFFERS, isOfferId, pickOffer, readRemote, shouldWelcome,
} from '../src/offer.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const T0 = Date.parse('2026-11-24T10:00:00');
const DAY = 86400000;

// 1. The default is the launch offer, and the launch offer is the ceiling.
check('default is launch', DEFAULT_OFFER === 'launch');
check('launch is the ceiling', JSON.stringify(OFFERS.launch.limits) === JSON.stringify(CEILING));
for (const o of Object.values(OFFERS)) {
  check(`${o.id}: nothing above the ceiling`,
    o.limits.freePerDay <= CEILING.freePerDay && o.limits.perAd <= CEILING.perAd
    && o.limits.adsPerDay <= CEILING.adsPerDay);
  check(`${o.id}: still lets a new user scan something`, o.limits.freePerDay > 0);
}
check('launch never opens with a paywall', OFFERS.launch.firstOpenPaywall === false);

// 2. The remote file names an offer. It cannot do anything else.
check('reads {"offer":"tight"}', readRemote({ offer: 'tight' }) === 'tight');
check('reads {"offer":"launch"}', readRemote({ offer: 'launch' }) === 'launch');
check('an unknown name is no answer', readRemote({ offer: 'free-for-all' }) === null);
check('numbers in the file are ignored',
  readRemote({ offer: 'tight', freePerDay: 0 }) === 'tight'
  && OFFERS.tight.limits.freePerDay > 0);
check('an error page is no answer', readRemote('<html>404</html>') === null);
check('null is no answer', readRemote(null) === null && readRemote({}) === null);
check('a prototype key is not an offer', !isOfferId('constructor') && !isOfferId('toString'));

// 3. Remote wins; no answer keeps what the phone had; nothing at all is launch.
check('remote wins over stored', pickOffer('tight', 'launch') === 'tight');
check('no answer keeps the stored offer', pickOffer(null, 'tight') === 'tight');
check('no answer and nothing stored is launch', pickOffer(null, undefined) === 'launch');
check('a corrupt stored value is launch', pickOffer(null, 'gibberish') === 'launch');
check('a corrupt remote value falls to stored', pickOffer({ offer: 'tight' }, 'tight') === 'tight'
  && pickOffer(42, 'launch') === 'launch');

// 4. Tightening: the free ration comes down, credits do not move.
{
  setLimits(OFFERS.launch.limits);
  let e: Entitlement = grantPack(fresh(T0), 200);
  check('starts on 30 free + 200 credits', e.freeLeft === 30 && e.credits === 200);
  const changed = setLimits(OFFERS.tight.limits);
  e = retune(e);
  check('setLimits reports the change', changed);
  check('free ration follows the offer down', e.freeLeft === OFFERS.tight.limits.freePerDay,
    `${e.freeLeft}`);
  check('bought credits are untouched', e.credits === 200 && e.creditsEver === 200);
  check('retune is a no-op when already inside', retune(e) === e);

  // The next day refills to the tight ration, not the old one.
  const next = refill(e, T0 + DAY);
  check('tomorrow refills to the tight ration', next.freeLeft === 10, `${next.freeLeft}`);

  // The ad cap follows too.
  let a = next;
  for (let i = 0; i < 10; i++) a = grantAd(a);
  check('ad cap follows the offer', a.adsToday === OFFERS.tight.limits.adsPerDay
    && !canWatchAd(a), `${a.adsToday}`);

  // Loosening again never grants mid-day; the next refill does.
  setLimits(OFFERS.launch.limits);
  const loose = retune(next);
  check('loosening does not hand out scans mid-day', loose.freeLeft === 10);
  check('but the next refill is the full ration', refill(loose, T0 + 2 * DAY).freeLeft === 30);
}

// 5. Nothing can be set above the ceiling, and bad numbers fall back to it.
{
  setLimits({ freePerDay: 9999, perAd: 500, adsPerDay: 99 });
  check('above the ceiling is the ceiling', JSON.stringify(LIMITS) === JSON.stringify(CEILING));
  setLimits({ freePerDay: NaN, perAd: -1, adsPerDay: Infinity });
  check('nonsense is the ceiling', JSON.stringify(LIMITS) === JSON.stringify(CEILING));
  check('same limits report no change', setLimits(CEILING) === false);
}

// 6. A saved file is trusted up to the ceiling whatever offer is in force,
//    because it is read before the offer is known.
{
  setLimits(OFFERS.tight.limits);
  const e = normalise({ freeLeft: 25, freeDay: '2026-11-24', credits: 7 }, T0);
  check('normalise does not clip to the offer', e.freeLeft === 25 && e.credits === 7);
  check('retune then does', retune(e).freeLeft === 10);
  check('a file claiming more than the ceiling is cut to it',
    normalise({ freeLeft: 5000 }, T0).freeLeft === CEILING.freePerDay);
  setLimits(OFFERS.launch.limits);
}

// 7. The introductory paywall: once, before the first scan, never on launch.
{
  const blank = fresh(T0);
  check('launch offer never welcomes', !shouldWelcome(OFFERS.launch, blank, false));
  check('tight offer welcomes a new install', shouldWelcome(OFFERS.tight, blank, false));
  check('only once', !shouldWelcome(OFFERS.tight, blank, true));
  check('not someone who has already scanned',
    !shouldWelcome(OFFERS.tight, spend(blank), false));
  check('not someone who has bought credits',
    !shouldWelcome(OFFERS.tight, grantPack(blank, 200), false));
  check('not a subscriber', !shouldWelcome(OFFERS.tight, { ...blank, pro: true }, false));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
