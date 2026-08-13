/**
 * Sweep the detector's working resolution against corner accuracy and cost.
 *
 * Localisation was measured as the bottleneck: a perfect quad matched at a
 * median Hamming distance of 28, the detected quad at 115. The detector runs on
 * a downscaled copy, so at 320 px wide each working pixel covers 4 source
 * pixels of a 1280 px frame - quantisation alone puts a floor under the corner
 * error. This finds where that trade stops paying.
 *
 *   node --experimental-strip-types packages/core/test/workwidth-sweep.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_W, CANON_H, describe as describeCard } from '../src/descriptor.ts';
import { detectCard, rectify, rotate180, orderQuad } from '../src/detect.ts';
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

console.log(`${meta.count} frames at ${meta.width}x${meta.height}, ${index.rows} cards\n`);
console.log('workW  inset   detected  top-1         cornerErr  dist   detect-ms');

for (const workWidth of [320, 426, 640, 1280]) {
  for (const insetPx of [0, 2, 4]) {
    let detected = 0;
    let correct = 0;
    let tDetect = 0;
    const errs: number[] = [];
    const dists: number[] = [];

    for (let i = 0; i < meta.count; i++) {
      const rgba = new Uint8ClampedArray(
        frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
      );
      const t = performance.now();
      const det = detectCard(rgba, meta.width, meta.height, { workWidth, insetPx });
      tDetect += performance.now() - t;
      if (!det) continue;
      detected++;

      const truth = orderQuad(meta.frames[i].quad.map(([x, y]) => ({ x, y })));
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += Math.hypot(det.quad[k].x - truth[k].x, det.quad[k].y - truth[k].y);
      }
      errs.push(sum / 4);

      const up = rectify(rgba, meta.width, meta.height, det.quad, CANON_W, CANON_H);
      const a = index.search(describeCard(up));
      const b = index.search(describeCard(rotate180(up, CANON_W, CANON_H)));
      const best = a.best.distance <= b.best.distance ? a : b;
      if (best.best.index === meta.frames[i].row) {
        correct++;
        dists.push(best.best.distance);
      }
    }
    console.log(
      `${String(workWidth).padStart(5)}  ${String(insetPx).padStart(5)}   ` +
      `${String(detected).padStart(3)}/${meta.count}   ` +
      `${String(correct).padStart(3)}/${meta.count} (${((correct / meta.count) * 100).toFixed(1)}%)  ` +
      `${median(errs).toFixed(1).padStart(7)} px  ${String(median(dists)).padStart(4)}  ` +
      `${(tDetect / meta.count).toFixed(1).padStart(7)}`,
    );
  }
}
