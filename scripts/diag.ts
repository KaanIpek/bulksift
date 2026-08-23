import { World } from '../src/game/world';
import { AiCommander, type Difficulty } from '../src/game/ai';
import { CAMPAIGN } from '../src/game/levels';

const STEP = 1 / 60;

function play(levelIdx: number, playerAi: Difficulty, seed: number, seconds = 1500) {
  const level = CAMPAIGN[levelIdx];
  const w = new World(level, seed);
  const a = new AiCommander(w, level.difficulty, 'enemy', seed + 1);
  const b = new AiCommander(w, playerAi, 'player', seed + 2);
  const ticks = Math.round(seconds / STEP);
  for (let i = 0; i < ticks; i++) {
    a.update(STEP);
    b.update(STEP);
    w.update(STEP);
    w.fx.length = 0;
    if (w.outcome !== 'playing') break;
  }
  return {
    outcome: w.outcome,
    t: Math.round(w.stats.elapsed),
    p: w.basesOf('player').length,
    e: w.basesOf('enemy').length,
    n: w.basesOf('neutral').length,
  };
}

for (let i = 0; i < CAMPAIGN.length; i++) {
  const rows = [3, 77, 512].map((s) => play(i, 'legend', s));
  const wins = rows.filter((r) => r.outcome === 'victory').length;
  console.log(
    String(i).padStart(2),
    CAMPAIGN[i].name.padEnd(18),
    CAMPAIGN[i].difficulty.padEnd(8),
    `wins ${wins}/3`,
    rows.map((r) => `${r.outcome[0]}@${r.t}s p${r.p}/e${r.e}/n${r.n}`).join('  '),
  );
}
