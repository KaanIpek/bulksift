import { World } from '../src/game/world';
import { AiCommander } from '../src/game/ai';
import { CAMPAIGN } from '../src/game/levels';

const STEP = 1 / 60;
const idx = Number(process.argv[2] ?? 5);
const level = CAMPAIGN[idx];
const w = new World(level, 3);
const enemy = new AiCommander(w, level.difficulty, 'enemy', 4);
const player = new AiCommander(w, 'legend', 'player', 5);

console.log(level.name, '| start:', level.bases.map((b, i) => `${i}:${b.kind[0]}${b.owner[0]}${b.garrison}`).join(' '));
let next = 0;
for (let i = 0; i < 900 / STEP; i++) {
  enemy.update(STEP); player.update(STEP); w.update(STEP); w.fx.length = 0;
  if (w.stats.elapsed >= next) {
    next += 30;
    const own = (o: 'player' | 'enemy' | 'neutral') => w.basesOf(o).length;
    const troops = (o: 'player' | 'enemy') =>
      Math.round(w.basesOf(o).reduce((s, b) => s + b.garrison, 0)) +
      '+' + Math.round(w.squads.filter((q) => q.owner === o).reduce((s, q) => s + q.count, 0));
    console.log(
      `t=${String(Math.round(w.stats.elapsed)).padStart(3)}s  bases p${own('player')}/e${own('enemy')}/n${own('neutral')}`,
      ` troops p${troops('player').padEnd(9)} e${troops('enemy')}`,
      ` squads p${w.squads.filter(q=>q.owner==='player').length}/e${w.squads.filter(q=>q.owner==='enemy').length}`,
    );
  }
  if (w.outcome !== 'playing') break;
}
console.log('outcome', w.outcome, 'at', Math.round(w.stats.elapsed) + 's');
