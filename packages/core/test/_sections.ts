/**
 * Is the colour part of the descriptor helping or hurting on a real phone?
 *
 * Five device sessions reported the same shape:
 *
 *   d=217 m=7  · gridH 31% gridV 33% art 24% colour 24%
 *   d=212 m=4  · gridH 27% gridV 25% art 17% colour 57%
 *   d=221 m=15 · gridH 27% gridV 37% art 34% colour 15%
 *   d=230 m=5  · gridH 35% gridV 26% art 29% colour 37%
 *   d=203 m=2  · gridH 26% gridV 25% art 23% colour 41%
 *
 * The margin - how far the winner beats the nearest differently-named card - is
 * 2 to 15 where the fixtures give a median of 146. And the colour section, 108
 * of the 742 bits, is disagreeing at up to 57%, which is worse than a coin
 * flip's distance from a match and means those bits carry no information at
 * all on that device. A Basic Fighting Energy being read as a Basic Lightning
 * Energy is exactly what that predicts: colour is the only thing that separates
 * them.
 *
 * Noise added to both the winner and its rivals does not cancel out - it
 * compresses the gap between them, which is precisely the quantity the accept
 * rule depends on. This measures how much of the margin those 108 bits are
 * costing when they go bad.
 *
 *   node --experimental-strip-types packages/core/test/_sections.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { baseName } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const NAMES = cards.map((c) => baseName(c.n));

const BITS = index.bits;
const COLOUR_START = 634;
const COLOUR_LEN = 108;

let seed = 20260815;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/** Flip a fraction of the bits in a range, as a noisy read of it would. */
function corrupt(q: Uint8Array, start: number, len: number, rate: number): Uint8Array {
  const out = q.slice();
  for (let i = start; i < start + len; i++) {
    if (rnd() < rate) out[i >> 3] ^= 0x80 >> (i & 7);
  }
  return out;
}

/** Distance ignoring a range of bits, and the margin that follows from it. */
function marginIgnoring(
  query: Uint8Array, ignoreStart: number, ignoreLen: number,
): { best: number; margin: number; index: number } {
  const scored: Array<{ i: number; d: number }> = [];
  for (let row = 0; row < index.rows; row++) {
    const ref = index.rowBytes(row);
    let d = 0;
    for (let b = 0; b < BITS; b++) {
      if (ignoreLen && b >= ignoreStart && b < ignoreStart + ignoreLen) continue;
      const qb = (query[b >> 3] >> (7 - (b & 7))) & 1;
      const rb = (ref[b >> 3] >> (7 - (b & 7))) & 1;
      if (qb !== rb) d++;
    }
    scored.push({ i: row, d });
  }
  scored.sort((a, b) => a.d - b.d);
  const winner = NAMES[scored[0].i];
  for (let k = 1; k < scored.length; k++) {
    if (NAMES[scored[k].i] === winner) continue;
    return { best: scored[0].d, margin: scored[k].d - scored[0].d, index: scored[0].i };
  }
  return { best: scored[0].d, margin: 9999, index: scored[0].i };
}

/*
 * A full scan of 20,444 rows in JavaScript, twice per sample, is slow, so this
 * takes a spread rather than the whole catalogue. Twelve cards across old and
 * new sets, plus every basic energy, which is the family the device actually
 * failed on.
 */
const sample: number[] = [];
for (let i = 0; i < cards.length; i += Math.floor(cards.length / 12)) sample.push(i);
for (let i = 0; i < cards.length; i++) {
  if (/^Basic .* Energy$/.test(cards[i].n) && sample.length < 22) sample.push(i);
}

const RATES = [0.0, 0.2, 0.4, 0.5];

console.log(`${sample.length} cards, ${BITS} bits, colour is ${COLOUR_LEN} of them\n`);
console.log('colour   with colour        without colour     correct?');
console.log('noise    best  margin       best  margin       with / without');

for (const rate of RATES) {
  let withBest = 0, withMargin = 0, withOk = 0;
  let noBest = 0, noMargin = 0, noOk = 0;

  for (const row of sample) {
    // The clean read of this card, then its colour bits degraded.
    const q = corrupt(index.rowBytes(row), COLOUR_START, COLOUR_LEN, rate);

    const a = marginIgnoring(q, 0, 0);
    withBest += a.best;
    withMargin += Math.min(a.margin, 742);
    if (a.index === row) withOk++;

    const b = marginIgnoring(q, COLOUR_START, COLOUR_LEN);
    noBest += b.best;
    noMargin += Math.min(b.margin, 742);
    if (b.index === row) noOk++;
  }

  const n = sample.length;
  console.log(
    `  ${(rate * 100).toFixed(0).padStart(3)}%   ` +
    `${(withBest / n).toFixed(0).padStart(4)}  ${(withMargin / n).toFixed(0).padStart(6)}       ` +
    `${(noBest / n).toFixed(0).padStart(4)}  ${(noMargin / n).toFixed(0).padStart(6)}       ` +
    `${withOk}/${n} / ${noOk}/${n}`,
  );
}

console.log(
  '\nThe device reported colour disagreeing at 15-57%. Read the 40% and 50% rows.',
);
