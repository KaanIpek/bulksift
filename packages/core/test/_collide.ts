import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CardIndex } from '../src/matcher.ts';
import { baseName } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');
const buf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const NAMES = cards.map((c) => baseName(c.n));

const ONLY = process.env.RARITY ?? '';
let checked = 0, bad = 0;
const rows: number[] = [];
if (ONLY) {
  for (let i = 0; i < cards.length && rows.length < 60; i++) {
    if (cards[i].r === ONLY) rows.push(i);
  }
} else {
  const step = Math.max(1, Math.floor(cards.length / 400));
  for (let i = 0; i < cards.length; i += step) rows.push(i);
}
for (const i of rows) {
  const top = index.topK(index.rowBytes(i), 8);
  const winner = NAMES[top[0].index];
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    const m = top[k].distance - top[0].distance;
    checked++;
    if (m < 24) {
      bad++;
      const a = cards[i], b = cards[top[k].index];
      if (bad <= 12) {
        console.log(`m=${String(m).padStart(3)}  ${a.n} [${a.S}] <-> ${b.n} [${b.S}]`);
      }
    }
    break;
  }
}
console.log(`\n${bad}/${checked} sampled cards sit under the gate`);
