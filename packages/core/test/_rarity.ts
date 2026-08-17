/**
 * Which rarities are hard, and is it the index or the camera?
 *
 * The report is that Special Illustration Rares are read with difficulty while
 * ordinary cards are fine. Glare is the obvious suspect - an SIR is a textured
 * full art, the worst possible surface - but there is a second possibility that
 * has to be ruled out first, because the fix is completely different.
 *
 * A card can be hard to read because the PHOTOGRAPH is hard, or because the
 * card is not very distinctive IN THE INDEX: if two SIRs of the same Pokémon
 * differ by fewer bits than the noise a camera adds, no amount of image quality
 * will separate them. That is a data problem and no scanner change touches it.
 *
 * Feeding each card's own index row back as a query separates the two. It is a
 * perfect read by construction, so whatever margin comes back is the ceiling
 * the camera can never exceed. If SIRs have a healthy ceiling, the difficulty
 * is optical and the multi-frame vote is the right lever. If their ceiling is
 * near the acceptance gate, no optics will help.
 *
 *   node --experimental-strip-types packages/core/test/_rarity.ts
 */

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

/** Margin to the nearest differently-named card, for a perfect read. */
function ceiling(row: number): { margin: number; ok: boolean } {
  const top = index.topK(index.rowBytes(row), 16);
  const winner = NAMES[top[0].index];
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    return { margin: top[k].distance - top[0].distance, ok: top[0].index === row };
  }
  return { margin: 742, ok: top[0].index === row };
}

const GROUPS = [
  'Special Illustration Rare',
  'Illustration Rare',
  'Rare Secret',
  'Rare Rainbow',
  'Rare Ultra',
  'Rare Holo',
  'Common',
];

// A spread rather than every card: a full scan is 20,468 rows per query.
const SAMPLE = 60;

console.log('rarity                       n   median  worst  under gate(24)');
for (const rarity of GROUPS) {
  const rows: number[] = [];
  for (let i = 0; i < cards.length && rows.length < SAMPLE; i++) {
    if (cards[i].r === rarity) rows.push(i);
  }
  if (!rows.length) continue;

  const margins = rows.map((r) => ceiling(r).margin).sort((a, b) => a - b);
  const median = margins[margins.length >> 1];
  const under = margins.filter((m) => m < 24).length;
  console.log(
    `${rarity.padEnd(28)} ${String(margins.length).padStart(3)} ` +
    `${String(median).padStart(6)} ${String(margins[0]).padStart(6)} ` +
    `${String(under).padStart(10)}`,
  );
}

console.log(
  '\nA low ceiling means the index cannot separate those cards and no camera ' +
  'work will.\nA high ceiling means the difficulty is optical, which is what ' +
  'the multi-frame vote addresses.',
);
