/**
 * End-to-end test of the TypeScript engine on realistic camera frames.
 *
 * Same simulation that produced the feasibility numbers in Python, so the two
 * are directly comparable: if the TS detector finds fewer cards or matches them
 * worse, that is a porting defect and not a change in difficulty.
 *
 *   node --experimental-strip-types packages/core/test/pipeline.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_W, CANON_H, describe as describeCard } from '../src/descriptor.ts';
import { detectCard, rectify, rotate180 } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number;
  height: number;
  count: number;
  frames: Array<{ id: string; row: number; name: string; set: string }>;
};

const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));

console.log(`index: ${index.rows} cards, ${index.bits} bits`);
console.log(`frames: ${meta.count} at ${meta.width}x${meta.height}\n`);

const frameBytes = meta.width * meta.height * 4;
let detected = 0;
let correct = 0;
let tDetect = 0;
let tHash = 0;
let tSearch = 0;
const correctDist: number[] = [];
const wrongDist: number[] = [];
const misses: Array<{ want: string; got: string; d: number }> = [];

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer,
    frames.byteOffset + i * frameBytes,
    frameBytes,
  );

  let t = performance.now();
  const det = detectCard(rgba, meta.width, meta.height);
  tDetect += performance.now() - t;
  if (!det) continue;
  detected++;

  t = performance.now();
  const upright = rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H);
  const qa = describeCard(upright);
  const qb = describeCard(rotate180(upright, CANON_W, CANON_H));
  tHash += performance.now() - t;

  t = performance.now();
  const ra = index.search(qa);
  const rb = index.search(qb);
  const best = ra.best.distance <= rb.best.distance ? ra : rb;
  tSearch += performance.now() - t;

  const want = meta.frames[i];
  if (best.best.index === want.row) {
    correct++;
    correctDist.push(best.best.distance);
  } else {
    wrongDist.push(best.best.distance);
    misses.push({ want: `${want.name} (${want.set})`, got: cards[best.best.index]
      ? `${cards[best.best.index].n} (${cards[best.best.index].S})` : '?', d: best.best.distance });
  }
}

const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};

const n = meta.count;

// The metric that actually matters is not raw top-1: it is how often the app
// shows a WRONG price with confidence. A match beyond maxDistance is refused
// and the user simply rescans, which costs a second; a confident wrong answer
// costs them money.
const MAX_DISTANCE = 150;
const confidentWrong = wrongDist.filter((d) => d <= MAX_DISTANCE).length;
const rejected = wrongDist.filter((d) => d > MAX_DISTANCE).length;
const correctRejected = correctDist.filter((d) => d > MAX_DISTANCE).length;

console.log(`detected      : ${detected}/${n}  (${((detected / n) * 100).toFixed(1)}%)`);
console.log(
  `top-1 correct : ${correct}/${n}  (${((correct / n) * 100).toFixed(1)}% of frames, ` +
  `${((correct / Math.max(detected, 1)) * 100).toFixed(1)}% of detected)`,
);
console.log(`\nlatency per frame:`);
console.log(`  detect  ${(tDetect / n).toFixed(1)} ms`);
console.log(`  hash    ${(tHash / Math.max(detected, 1)).toFixed(1)} ms`);
console.log(`  search  ${(tSearch / Math.max(detected, 1)).toFixed(1)} ms  (${index.rows} cards)`);
const total = tDetect / n + (tHash + tSearch) / Math.max(detected, 1);
console.log(`  TOTAL   ${total.toFixed(1)} ms  ->  ${(1000 / total).toFixed(0)} fps`);
console.log(
  `\ncorrect distance median ${median(correctDist)}, ` +
  `wrong distance median ${median(wrongDist)} (of ${index.bits} bits)`,
);

console.log(`\nwith the confidence gate at distance <= ${MAX_DISTANCE}:`);
console.log(`  priced correctly     ${correct - correctRejected}/${n}  ` +
  `(${(((correct - correctRejected) / n) * 100).toFixed(1)}%)`);
console.log(`  refused, ask rescan  ${rejected + correctRejected}/${n}  ` +
  `(${(((rejected + correctRejected) / n) * 100).toFixed(1)}%)`);
console.log(`  CONFIDENTLY WRONG    ${confidentWrong}/${n}  ` +
  `(${((confidentWrong / n) * 100).toFixed(1)}%)   <- the number that costs money`);
if (misses.length) {
  console.log(`\n${misses.length} misidentifications:`);
  for (const m of misses.slice(0, 10)) {
    console.log(`  ${m.want}  ->  ${m.got}  d=${m.d}`);
  }
}
