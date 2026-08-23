/** Does the difficulty target actually move a given level's outcome? Scales
 *  the enemy's opening down by hand and replays, so a level that resists
 *  tuning shows up as flat instead of being quietly shipped unwinnable. */
import { World } from '../src/game/world';
import { AiCommander } from '../src/game/ai';
import { CAMPAIGN } from '../src/game/levels';
import type { LevelDef } from '../src/core/types';

const STEP = 1 / 60;

function weaken(level: (typeof CAMPAIGN)[number], scale: number): LevelDef {
  return {
    ...level,
    bases: level.bases.map((b) =>
      b.owner === 'enemy'
        ? { ...b, garrison: Math.max(6, Math.round(b.garrison * scale)), level: scale < 0.7 ? 1 : b.level }
        : b,
    ),
  };
}

function run(level: LevelDef, difficulty: (typeof CAMPAIGN)[number]['difficulty'], seed: number) {
  const w = new World(level, seed);
  const ea = new AiCommander(w, difficulty, 'enemy', seed + 1);
  const pa = new AiCommander(w, 'legend', 'player', seed + 2);
  for (let i = 0; i < 1500 / STEP; i++) {
    ea.update(STEP); pa.update(STEP); w.update(STEP); w.fx.length = 0;
    if (w.outcome !== 'playing') break;
  }
  return w.outcome;
}

const seeds = [3, 77, 512, 901, 1234];
for (const idx of [9, 10]) {
  const level = CAMPAIGN[idx];
  console.log(level.name);
  for (const scale of [1, 0.8, 0.6, 0.4]) {
    const weak = weaken(level, scale);
    const wins = seeds.filter((s) => run(weak, level.difficulty, s) === 'victory').length;
    console.log(`  enemy opening x${scale}  wins ${wins}/${seeds.length}`);
  }
  const wins = seeds.filter((s) => run(level, 'elite', s) === 'victory').length;
  console.log(`  enemy tier -> elite   wins ${wins}/${seeds.length}`);
}
