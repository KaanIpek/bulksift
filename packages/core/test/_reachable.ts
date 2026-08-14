/**
 * Which cards can be scanned at all?
 *
 * The acceptance rule asks the winner to beat the nearest differently-named
 * card by a margin. That is measured against a query, and the cleanest query
 * that will ever exist for a card is the card's own index row - a read with no
 * lens, no blur, no white balance and no perspective in it.
 *
 * So a card whose *perfect* read cannot clear the threshold can never be
 * scanned by anything. That is an upper bound with no experiment in it, it
 * costs one pass over the index per card, and it says exactly which cards a
 * threshold makes unreachable.
 *
 * The reason to ask: a device build refused 3,222 of 3,421 frames and could not
 * read a basic energy at all.
 *
 *   node --experimental-strip-types packages/core/test/_reachable.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const NAMES = cards.map((c) => c.n);

const K = 16;
const margins = new Int32Array(cards.length);

for (let row = 0; row < cards.length; row++) {
  const q = index.rowBytes(row);
  const top = index.topK(q, K);
  const winner = NAMES[top[0].index];
  let margin = 9999;
  for (let i = 1; i < top.length; i++) {
    if (NAMES[top[i].index] === winner) continue;
    margin = top[i].distance - top[0].distance;
    break;
  }
  margins[row] = margin;
  if ((row + 1) % 4000 === 0) console.log(`  ${row + 1}/${cards.length}`);
}

const sorted = Int32Array.from(margins).sort();
const pct = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
console.log(
  `\nperfect-read margin: min ${sorted[0]}  p1 ${pct(0.01)}  p5 ${pct(0.05)}` +
  `  p25 ${pct(0.25)}  median ${pct(0.5)}`,
);

console.log('\n threshold   cards that can NEVER be scanned');
for (const t of [12, 20, 24, 32, 40, 60, 80]) {
  const n = margins.reduce((acc, m) => acc + (m < t ? 1 : 0), 0);
  console.log(`   ${String(t).padStart(3)}        ${n} (${((n / cards.length) * 100).toFixed(2)}%)`);
}

console.log('\nthe 20 hardest cards in the catalogue:');
const order = [...margins.keys()].sort((a, b) => margins[a] - margins[b]).slice(0, 20);
for (const row of order) {
  console.log(`  margin ${String(margins[row]).padStart(4)}  ${cards[row].n} (${cards[row].S})`);
}

const energies = [...margins.keys()].filter((i) => /^Basic .* Energy$/.test(cards[i].n));
const em = energies.map((i) => margins[i]).sort((a, b) => a - b);
console.log(
  `\nbasic energies (${energies.length}): min ${em[0]}  median ${em[em.length >> 1]}` +
  `  max ${em[em.length - 1]}`,
);
