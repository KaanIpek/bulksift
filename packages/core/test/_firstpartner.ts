/**
 * Are the First Partner Pack cards actually distinguishable now?
 *
 * They were never a recognition failure. The primary catalogue - 174 sets from
 * pokemon-tcg-data - has never contained them, so the app had nothing to match
 * against and reported nothing, forever. Being able to see a card and still say
 * nothing looks identical to a hard read from the outside, which is why the
 * complaint arrived as "it cannot read these" rather than "these are missing".
 *
 * Adding a catalogue entry is not the same as being able to tell them apart,
 * though: 24 jumbo promos of starter Pokémon share a house style, and several
 * are the same species. This feeds each card's own index row back as a query -
 * the perfect-read ceiling - and reports the margin to the nearest card with a
 * different name. Anything at or under the acceptance gate could never be
 * committed no matter how good the photograph.
 *
 *   node --experimental-strip-types packages/core/test/_firstpartner.ts
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

const fp = cards.map((c, i) => ({ c, i })).filter((x) => x.c.s === 'fpp');
console.log(`${fp.length} First Partner cards in the index\n`);

let worst = 9999;
let worstName = '';
for (const { c, i } of fp) {
  const top = index.topK(index.rowBytes(i), 16);
  const winner = NAMES[top[0].index];
  let margin = 742;
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    margin = top[k].distance - top[0].distance;
    break;
  }
  const ok = top[0].index === i;
  if (margin < worst) { worst = margin; worstName = c.n; }
  if (!ok || margin < 60) {
    console.log(`  ${ok ? 'ok   ' : 'WRONG'} ${c.n.padEnd(12)} margin ${margin}`);
  }
}

console.log(`\nworst margin: ${worst} (${worstName})`);
console.log(`acceptance gate is 24 - ${worst >= 24 ? 'all reachable' : 'SOME UNREACHABLE'}`);
