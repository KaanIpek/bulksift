/**
 * How accurately does the detector place the card's corners?
 *
 * Match quality is downstream of localisation: if the quad is off, every grid
 * cell in the descriptor samples slightly the wrong pixels. Rather than guess
 * why Hamming distances are higher here than in the Python reference, this
 * compares the detected corners against the ground-truth quad the fixture
 * generator used to composite the card.
 *
 *   node --experimental-strip-types packages/core/test/localise.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_W, CANON_H, describe as describeCard } from '../src/descriptor.ts';
import { detectCard, rectify, rotate180, orderQuad, type Quad } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; quad: number[][] }>;
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

const errors: number[] = [];
const distWithDetected: number[] = [];
const distWithTruth: number[] = [];
let correctDetected = 0;
let correctTruth = 0;

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const truthQuad = orderQuad(meta.frames[i].quad.map(([x, y]) => ({ x, y })));

  const det = detectCard(rgba, meta.width, meta.height, { insetPx: 2 });
  if (det) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      sum += Math.hypot(det.quad[k].x - truthQuad[k].x, det.quad[k].y - truthQuad[k].y);
    }
    errors.push(sum / 4);

    const up = rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H);
    const a = index.search(describeCard(up));
    const b = index.search(describeCard(rotate180(up, CANON_W, CANON_H)));
    const best = a.best.distance <= b.best.distance ? a : b;
    distWithDetected.push(best.best.distance);
    if (best.best.index === meta.frames[i].row) correctDetected++;
  }

  // the same pipeline given a perfect quad, to separate localisation error
  // from everything downstream of it
  const upT = rectify(rgba, meta.width, meta.height, truthQuad as Quad, CANON_W, CANON_H);
  const at = index.search(describeCard(upT));
  const bt = index.search(describeCard(rotate180(upT, CANON_W, CANON_H)));
  const bestT = at.best.distance <= bt.best.distance ? at : bt;
  distWithTruth.push(bestT.best.distance);
  if (bestT.best.index === meta.frames[i].row) correctTruth++;
}

const cardH = Math.hypot(
  meta.frames[0].quad[3][0] - meta.frames[0].quad[0][0],
  meta.frames[0].quad[3][1] - meta.frames[0].quad[0][1],
);

console.log(`${meta.count} frames at ${meta.width}x${meta.height}\n`);
console.log(`corner error: median ${median(errors).toFixed(1)} px, ` +
  `p90 ${errors.slice().sort((a, b) => a - b)[Math.floor(errors.length * 0.9)]?.toFixed(1)} px ` +
  `(card is ~${cardH.toFixed(0)} px tall, so ~${(median(errors) / cardH * 100).toFixed(1)}%)\n`);
console.log(`with the DETECTED quad : ${correctDetected}/${meta.count} correct, ` +
  `distance median ${median(distWithDetected)}`);
console.log(`with the TRUE quad     : ${correctTruth}/${meta.count} correct, ` +
  `distance median ${median(distWithTruth)}`);
console.log(
  `\n-> ${median(distWithDetected) > median(distWithTruth) * 1.2
    ? 'localisation is the bottleneck; a perfect quad would match far better'
    : 'localisation is close to optimal; the remaining loss is elsewhere'}`,
);
