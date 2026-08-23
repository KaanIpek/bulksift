import { CAMPAIGN } from '../src/game/levels';
import { BASES, UNITS, baseStats, turretValue } from '../src/game/balance';
import type { LevelBase } from '../src/core/types';

/** The difficulty curve the campaign is meant to walk: how much stronger the
 *  enemy's opening position is than the player's, level by level. */
/** How long a decided match tends to run. Opening strength is compared over
 *  this horizon, not over a single minute: production compounds, so a side
 *  with 20% more output does not "start 20% ahead", it ends up crushingly
 *  ahead. Weighting economy by a real match length is what makes the tuner
 *  demand near-parity in output and treat starting garrisons as the fine
 *  adjustment they actually are. */
export const MATCH_HORIZON = 240;

export const TARGET_EDGE = [0.7, 0.78, 0.85, 0.9, 0.95, 1.0, 1.04, 1.08, 1.12, 1.05, 1.12, 1.2];

/** A base's worth over a match: what it produces, plus what its guns destroy. */
const econOf = (b: LevelBase) =>
  baseStats(b.kind, b.level ?? 1).production * MATCH_HORIZON * UNITS[BASES[b.kind].unit].weight +
  turretValue(b.kind, b.level ?? 1) * (MATCH_HORIZON / 60);
const capOf = (b: LevelBase) =>
  baseStats(b.kind, b.level ?? 1).capacity * UNITS[BASES[b.kind].unit].weight;
const troopsOf = (b: LevelBase) => b.garrison * UNITS[BASES[b.kind].unit].weight;

function analyse(level: (typeof CAMPAIGN)[number]) {
  const own = (o: string) => level.bases.filter((b) => b.owner === o);
  const sum = (bs: LevelBase[], f: (b: LevelBase) => number) => bs.reduce((s, b) => s + f(b), 0);
  const p = own('player');
  const e = own('enemy');
  let pEcon = sum(p, econOf);
  let eEcon = sum(e, econOf);
  for (const n of own('neutral')) {
    const near = (bs: LevelBase[]) => Math.min(...bs.map((x) => Math.hypot(x.x - n.x, x.y - n.y)));
    const share = near(e) / (near(p) + near(e));
    pEcon += econOf(n) * share;
    eEcon += econOf(n) * (1 - share);
  }
  return {
    pEcon,
    eEcon,
    pTroops: sum(p, troopsOf),
    eTroops: sum(e, troopsOf),
    pCap: sum(p, capOf),
    eCap: sum(e, capOf),
  };
}

console.log('lvl name                 edge  target   fix');
CAMPAIGN.forEach((level, i) => {
  const a = analyse(level);
  const target = TARGET_EDGE[i];
  const edge = (a.eEcon + a.eTroops) / (a.pEcon + a.pTroops);
  // What enemy garrison total would hit the target, holding econ fixed?
  const wantETroops = target * (a.pEcon + a.pTroops) - a.eEcon;
  const fill = wantETroops / a.eCap;
  let fix: string;
  if (fill >= 0.2 && fill <= 0.85) {
    fix = `set enemy garrisons to ${(fill * 100).toFixed(0)}% of capacity`;
  } else if (fill < 0.2) {
    // Enemy economy alone already overshoots: it has to lose some.
    const wantEEcon = target * (a.pEcon + a.pTroops) - a.eCap * 0.45;
    fix = `ENEMY ECON TOO HIGH: ${a.eEcon.toFixed(0)} -> ${wantEEcon.toFixed(0)} (drop ${((1 - wantEEcon / a.eEcon) * 100).toFixed(0)}%)`;
  } else {
    const wantEEcon = target * (a.pEcon + a.pTroops) - a.eCap * 0.45;
    fix = `ENEMY ECON TOO LOW: ${a.eEcon.toFixed(0)} -> ${wantEEcon.toFixed(0)} (add ${(wantEEcon - a.eEcon).toFixed(0)})`;
  }
  console.log(
    String(i).padStart(3),
    level.name.padEnd(20),
    edge.toFixed(2).padStart(5),
    target.toFixed(2).padStart(6),
    '  ' + fix,
  );
});
