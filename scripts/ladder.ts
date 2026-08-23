/** Runs every difficulty tier against every other on a perfectly mirrored
 *  map, so the only thing that can decide a match is the quality of the
 *  commander. A tier that cannot beat the one below it is not a tier. */
import { World } from '../src/game/world';
import { AiCommander, type Difficulty } from '../src/game/ai';
import { SKIRMISH } from '../src/game/levels';

const STEP = 1 / 60;
const TIERS: Difficulty[] = ['recruit', 'veteran', 'elite', 'legend'];


function match(p: Difficulty, e: Difficulty, seed: number, seconds = 1200) {
  const w = new World(SKIRMISH, seed);
  const pa = new AiCommander(w, p, 'player', seed + 2);
  const ea = new AiCommander(w, e, 'enemy', seed + 1);
  for (let i = 0; i < seconds / STEP; i++) {
    pa.update(STEP); ea.update(STEP); w.update(STEP); w.fx.length = 0;
    if (w.outcome !== 'playing') break;
  }
  return w.outcome;
}

const seeds = [5, 19, 41, 63, 88, 104, 137, 199];
console.log('player \\ enemy'.padEnd(16) + TIERS.map((t) => t.padStart(9)).join(''));
for (const p of TIERS) {
  const row = TIERS.map((e) => {
    let wins = 0;
    for (const s of seeds) if (match(p, e, s) === 'victory') wins++;
    return `${wins}/${seeds.length}`.padStart(9);
  });
  console.log(p.padEnd(16) + row.join(''));
}
