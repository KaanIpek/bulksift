/** Solves the campaign onto its intended difficulty curve and writes the
 *  numbers back into levels.ts.
 *
 *  Run this after changing any level roster or anything in balance.ts, then
 *  run the tests. It tunes two things and nothing else: what level each base
 *  starts at, and how full its garrison is. Positions, kinds and ownership
 *  stay exactly as authored — those are design, not arithmetic.
 *
 *  Two stages. First it solves for the intended difficulty curve using a
 *  model of opening strength. Then it *plays the level* and, if a strong
 *  commander cannot win it often enough, weakens the enemy's opening and
 *  tries again. The model is a good starting guess and a poor referee: a map
 *  can price out fair and still be unwinnable because of where the ground
 *  lies. Only the playtest gate decides what ships. */
import { readFileSync, writeFileSync } from 'node:fs';
import { World } from '../src/game/world';
import { AiCommander } from '../src/game/ai';
import { CAMPAIGN } from '../src/game/levels';
import { BASES, UNITS, baseStats, turretValue } from '../src/game/balance';
import { MATCH_HORIZON, TARGET_EDGE } from './tune';
import type { LevelBase } from '../src/core/types';

const MAX_LEVEL = 3;

const econOf = (b: LevelBase) =>
  baseStats(b.kind, b.level ?? 1).production * MATCH_HORIZON * UNITS[BASES[b.kind].unit].weight +
  turretValue(b.kind, b.level ?? 1) * (MATCH_HORIZON / 60);
const capOf = (b: LevelBase) =>
  baseStats(b.kind, b.level ?? 1).capacity * UNITS[BASES[b.kind].unit].weight;
const troopsOf = (b: LevelBase) => b.garrison * UNITS[BASES[b.kind].unit].weight;

function sides(bases: LevelBase[]) {
  const own = (o: string) => bases.filter((b) => b.owner === o);
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
  return { p, e, pEcon, eEcon, pTroops: sum(p, troopsOf), eTroops: sum(e, troopsOf), eCap: sum(e, capOf) };
}

const edgeOf = (bases: LevelBase[]) => {
  const s = sides(bases);
  return (s.eEcon + s.eTroops) / (s.pEcon + s.pTroops);
};

/** Nudge base levels one step at a time towards the target edge. Upgrades are
 *  the only lever with useful granularity that does not change the map. */
function solveLevels(bases: LevelBase[], target: number): LevelBase[] {
  let best = bases.map((b) => ({ ...b, level: b.level ?? 1 }));
  let bestErr = Math.abs(edgeOf(best) - target);
  for (let step = 0; step < 60; step++) {
    let move: LevelBase[] | null = null;
    let moveErr = bestErr;
    for (let i = 0; i < best.length; i++) {
      if (best[i].owner === 'neutral') continue;
      for (const delta of [-1, 1]) {
        const level = (best[i].level ?? 1) + delta;
        if (level < 1 || level > MAX_LEVEL) continue;
        const trial = best.map((b, j) => (i === j ? { ...b, level } : b));
        const err = Math.abs(edgeOf(trial) - target);
        // Prefer plain level-one bases when two options tie.
        if (err < moveErr - 1e-9 || (Math.abs(err - moveErr) < 1e-9 && delta === -1)) {
          moveErr = err;
          move = trial;
        }
      }
    }
    if (!move) break;
    best = move;
    bestErr = moveErr;
  }
  return best;
}

const STEP = 1 / 60;

/** Wins out of five that each stage of the campaign has to deliver for a
 *  strong commander. Early levels must be comfortable; the last ones only
 *  have to be possible, since a human plays them better than this bot. */
function required(index: number): number {
  if (index <= 3) return 4;
  if (index <= 7) return 3;
  return 2;
}

/** The opening missions also have to survive being played badly. A player
 *  meeting this game for the first time throws half a garrison at whatever
 *  is nearest and hopes; if that loses in a minute they never see mission
 *  three. So the first three are additionally gated on the *weakest*
 *  commander in the game being able to win them. */
function requiredNaive(index: number): number {
  if (index === 0) return 4;
  if (index <= 2) return 2;
  return 0;
}

/** How full an enemy garrison may start. A single intimidating stack on the
 *  tutorial map is technically fair and reads as a wall, so the opening
 *  missions keep their enemies thin however the arithmetic falls out. */
function fillCeiling(index: number): number {
  return index <= 1 ? 0.45 : 0.85;
}

const SEEDS = [3, 77, 512, 901, 1234];

function playtest(
  level: (typeof CAMPAIGN)[number],
  bases: LevelBase[],
  playerTier: 'legend' | 'recruit' = 'legend',
): number {
  let wins = 0;
  for (const seed of SEEDS) {
    const w = new World({ ...level, bases }, seed);
    const enemy = new AiCommander(w, level.difficulty, 'enemy', seed + 1);
    const player = new AiCommander(w, playerTier, 'player', seed + 2);
    for (let i = 0; i < 900 / STEP; i++) {
      enemy.update(STEP);
      player.update(STEP);
      w.update(STEP);
      w.fx.length = 0;
      if (w.outcome !== 'playing') break;
    }
    if (w.outcome === 'victory') wins++;
  }
  return wins;
}

/** Apply a garrison fill to the enemy side. */
function withFill(bases: LevelBase[], fill: number): LevelBase[] {
  return bases.map((b) =>
    b.owner === 'enemy'
      ? { ...b, garrison: Math.max(6, Math.round(baseStats(b.kind, b.level ?? 1).capacity * fill)) }
      : b,
  );
}

/** Take one level off whichever enemy base is most upgraded. */
function demote(bases: LevelBase[]): LevelBase[] | null {
  let pick = -1;
  let best = 1;
  bases.forEach((b, i) => {
    if (b.owner === 'enemy' && (b.level ?? 1) > best) {
      best = b.level ?? 1;
      pick = i;
    }
  });
  if (pick < 0) return null;
  return bases.map((b, i) => (i === pick ? { ...b, level: (b.level ?? 1) - 1 } : b));
}

const path = new URL('../src/game/levels.ts', import.meta.url).pathname;
let source = readFileSync(path, 'utf8');
const blocks = source.split('  level({');
if (blocks.length !== CAMPAIGN.length + 1) throw new Error('level block count changed');

const report: string[] = [];
const rebuilt = blocks.map((block, bi) => {
  if (bi === 0) return block;
  const level = CAMPAIGN[bi - 1];
  const target = TARGET_EDGE[bi - 1];

  const solved = solveLevels(level.bases, target);
  const s = sides(solved);
  // With levels fixed, solve the enemy garrison fill for the intended edge.
  const want = target * (s.pEcon + s.pTroops) - s.eEcon;
  const index = bi - 1;
  let fill = Math.max(0.22, Math.min(fillCeiling(index), want / s.eCap));
  let tuned = withFill(solved, fill);

  // Now stop trusting the model and actually play it.
  const need = required(index);
  const needNaive = requiredNaive(index);
  const passes = () => {
    const strong = playtest(level, tuned);
    const naive = needNaive > 0 ? playtest(level, tuned, 'recruit') : SEEDS.length;
    return { strong, naive, ok: strong >= need && naive >= needNaive };
  };

  let result = passes();
  let handicaps = 0;
  while (!result.ok && handicaps < 8) {
    handicaps++;
    if (handicaps % 2 === 0) {
      const weaker = demote(tuned);
      if (weaker) {
        tuned = withFill(weaker, fill);
        result = passes();
        continue;
      }
    }
    fill = Math.max(0.12, fill * 0.82);
    tuned = withFill(tuned, fill);
    result = passes();
  }

  report.push(
    `${level.name.padEnd(18)} edge ${edgeOf(tuned).toFixed(2)} (target ${target.toFixed(2)})` +
      `  fill ${(fill * 100).toFixed(0)}%  strong ${result.strong}/${SEEDS.length} (need ${need})` +
      (needNaive > 0 ? `  naive ${result.naive}/${SEEDS.length} (need ${needNaive})` : '') +
      (result.ok ? '' : '  <-- STILL UNWINNABLE'),
  );

  let seen = -1;
  return block.replace(/^ {6}\{ x: .*\},$/gm, () => {
    seen++;
    const b = tuned[seen];
    const lvl = (b.level ?? 1) > 1 ? `, level: ${b.level}` : '';
    return `      { x: ${b.x}, y: ${b.y}, kind: '${b.kind}', owner: '${b.owner}', garrison: ${b.garrison}${lvl} },`;
  });
});

source = rebuilt.join('  level({');
writeFileSync(path, source);
report.forEach((r) => console.log(r));
