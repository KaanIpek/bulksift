import { World } from '../src/game/world';
import { AiCommander, type Difficulty } from '../src/game/ai';
import { CAMPAIGN } from '../src/game/levels';

const STEP = 1 / 60;

function play(levelIdx: number, p: Difficulty, e: Difficulty, seed: number, seconds = 1200) {
  const w = new World(CAMPAIGN[levelIdx], seed);
  const ea = new AiCommander(w, e, 'enemy', seed + 1);
  const pa = new AiCommander(w, p, 'player', seed + 2);
  let minPlayerGarrison = Infinity;
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) {
    ea.update(STEP);
    pa.update(STEP);
    w.update(STEP);
    w.fx.length = 0;
    const g = w.basesOf('player').reduce((s, b) => s + b.garrison, 0);
    if (w.basesOf('player').length) minPlayerGarrison = Math.min(minPlayerGarrison, g);
    if (w.outcome !== 'playing') break;
  }
  return { o: w.outcome, t: Math.round(w.stats.elapsed), lowG: Math.round(minPlayerGarrison) };
}

const idx = Number(process.argv[2] ?? 10);
console.log('level', CAMPAIGN[idx].name);
for (const [p, e] of [['legend','recruit'],['legend','legend'],['recruit','legend']] as [Difficulty,Difficulty][]) {
  const rows = [3, 77, 512].map((s) => play(idx, p, e, s));
  console.log(` player=${p.padEnd(7)} enemy=${e.padEnd(7)}`, rows.map(r => `${r.o[0]}@${r.t}s low${r.lowG}`).join('  '));
}
