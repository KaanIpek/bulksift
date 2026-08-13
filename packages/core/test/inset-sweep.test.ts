/**
 * Sweep the detector's corner inset.
 *
 * The quad is derived from a dilated gradient blob, so it lands slightly
 * outside the card. This finds how far in the corners should be pulled, judged
 * by the thing that actually matters: top-1 accuracy and the Hamming distance
 * of correct matches.
 *
 *   node --experimental-strip-types packages/core/test/inset-sweep.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_W, CANON_H, describe as describeCard } from '../src/descriptor.ts';
import { detectCard, rectify, rotate180 } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);

const frameBytes = meta.width * meta.height * 4;
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
};

console.log(`${meta.count} frames, ${index.rows} cards\n`);
console.log('inset   detected   top-1        correct-dist median');

for (const insetPx of [0, 1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
  let detected = 0;
  let correct = 0;
  const dists: number[] = [];

  for (let i = 0; i < meta.count; i++) {
    const rgba = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    const det = detectCard(rgba, meta.width, meta.height, { insetPx });
    if (!det) continue;
    detected++;
    const upright = rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H);
    const ra = index.search(describeCard(upright));
    const rb = index.search(describeCard(rotate180(upright, CANON_W, CANON_H)));
    const best = ra.best.distance <= rb.best.distance ? ra : rb;
    if (best.best.index === meta.frames[i].row) {
      correct++;
      dists.push(best.best.distance);
    }
  }
  console.log(
    `${String(insetPx).padStart(4)}    ${String(detected).padStart(3)}/${meta.count}    ` +
    `${String(correct).padStart(3)}/${meta.count} (${((correct / meta.count) * 100).toFixed(1)}%)   ` +
    `${median(dists)}`,
  );
}
