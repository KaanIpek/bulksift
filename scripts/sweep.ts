/** Searches commander settings for the policy that actually wins, instead of
 *  trusting hand-picked numbers. The winner becomes the top difficulty tier
 *  and the lower tiers are degraded from it. */
import { World } from '../src/game/world';
import { AiCommander, type AiProfile } from '../src/game/ai';
import { SKIRMISH } from '../src/game/levels';

const STEP = 1 / 60;


const BASELINE: Partial<AiProfile> = {
  interval: 1.5, safety: 1.6, nerve: 0.95, reserve: 6, upgrades: true, expansion: 1.4,
};

function duel(a: Partial<AiProfile>, b: Partial<AiProfile>, seed: number, seconds = 900) {
  const w = new World(SKIRMISH, seed);
  const pa = new AiCommander(w, 'elite', 'player', seed + 2, a);
  const ea = new AiCommander(w, 'elite', 'enemy', seed + 1, b);
  for (let i = 0; i < seconds / STEP; i++) {
    pa.update(STEP); ea.update(STEP); w.update(STEP); w.fx.length = 0;
    if (w.outcome !== 'playing') break;
  }
  // A draw counts as half: holding the baseline off is worth something.
  return w.outcome === 'victory' ? 1 : w.outcome === 'defeat' ? 0 : 0.5;
}

const seeds = [5, 41, 88, 137, 211, 307];
/** Round-robin every candidate against every other and rank by win rate.
 *  Measuring against one fixed baseline just finds its counter. */
const candidates: { name: string; p: Partial<AiProfile> }[] = [
  { name: 'best?',   p: { interval: 2.0, safety: 2.2, nerve: 1.0, reserve: 2, upgrades: true, expansion: 1.4 } },
  { name: 'best-i1', p: { interval: 1.4, safety: 2.2, nerve: 1.0, reserve: 2, upgrades: true, expansion: 1.4 } },
  { name: 'best-s26',p: { interval: 2.0, safety: 2.6, nerve: 1.0, reserve: 2, upgrades: true, expansion: 1.4 } },
  { name: 'best-s19',p: { interval: 2.0, safety: 1.9, nerve: 1.0, reserve: 2, upgrades: true, expansion: 1.4 } },
  { name: 'noUpg',   p: { interval: 2.0, safety: 2.2, nerve: 1.0, reserve: 2, upgrades: false, expansion: 1.4 } },
  { name: 'tier-el', p: { interval: 2.2, safety: 1.9, nerve: 0.95, reserve: 5, upgrades: true, expansion: 1.4 } },
  { name: 'tier-vet',p: { interval: 2.8, safety: 1.55, nerve: 0.82, reserve: 11, upgrades: true, expansion: 1.3 } },
  { name: 'tier-rec',p: { interval: 3.8, safety: 1.25, nerve: 0.55, reserve: 20, upgrades: false, expansion: 1.2 } },
];

const table = candidates.map((c) => ({ ...c, score: 0, games: 0 }));
for (let i = 0; i < table.length; i++) {
  for (let j = 0; j < table.length; j++) {
    if (i === j) continue;
    for (const seed of seeds) {
      table[i].score += duel(table[i].p, table[j].p, seed);
      table[i].games += 1;
    }
  }
}
table.sort((a, b) => b.score / b.games - a.score / a.games);
console.log('confirmation tournament');
for (const r of table) console.log(`  ${r.name.padEnd(9)} ${(r.score / r.games).toFixed(3)}`);
