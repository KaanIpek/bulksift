/**
 * Does the scanner recover from a systematically wrong crop?
 *
 * The detector finds the physical edge of the card. The reference images were
 * cropped by whoever scanned them, and there is no guarantee the two agree: a
 * lens sees the card's real border, a scan may include or trim a millimetre of
 * it. Measured on clean frames, a 3% disagreement costs about 50 bits on top of
 * a 73-bit baseline, and 6% costs 87 - far more than motion blur (13) or a warm
 * white balance (9), both of which turned out to be nearly free.
 *
 * So the scanner tries three crops every so often and keeps the best. This
 * feeds it frames whose quads are deliberately wrong by a fixed amount - the
 * same way a real lens would be consistently wrong - and checks that it finds
 * its way back.
 *
 *   node --experimental-strip-types packages/core/test/calibrate.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe } from '../src/descriptor.ts';
import { detectCard, rectify, scaleQuad } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { loadCards, type CardRecord, type PriceBook } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards: CardRecord[] = loadCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')),
);
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8')) as PriceBook;

const frameBytes = meta.width * meta.height * 4;
const frameAt = (i: number) =>
  new Uint8ClampedArray(frames.buffer, frames.byteOffset + i * frameBytes, frameBytes);

/**
 * Distance with a fixed crop error and no calibration, for reference.
 * This is what the scanner would have scored before it could correct itself.
 */
function uncorrected(i: number, err: number): number | null {
  const buf = frameAt(i);
  const det = detectCard(buf, meta.width, meta.height);
  if (!det) return null;
  const q = describe(
    rectify(buf, meta.width, meta.height, scaleQuad(det.quad, err), CANON_W, CANON_H),
  );
  return index.search(q).best.distance;
}

/**
 * The calibration decision itself, on frames whose crop is wrong by `err`.
 *
 * This mirrors what `processFrame` does when it calibrates - rectify at three
 * scales around the standing bias, keep whichever matches best, carry that
 * bias forward - rather than driving the whole scanner. Injecting the error
 * through the real detector is not possible without disabling the sub-pixel
 * edge refinement, which would correct the very thing being simulated; so this
 * covers the decision, and the suites either side of it cover the pipeline.
 */
const STEP = 0.02;
const LIMIT = 0.08;

function calibrated(err: number, frameCount: number) {
  let bias = 0;
  const finalDistances: number[] = [];
  let correct = 0;

  for (let i = 0; i < frameCount; i++) {
    const buf = frameAt(i);
    const det = detectCard(buf, meta.width, meta.height);
    if (!det) continue;
    // The lens is wrong by `err`; the scanner may correct with `bias`.
    const trial = (b: number) => {
      const q = describe(
        rectify(
          buf, meta.width, meta.height,
          scaleQuad(det.quad, err + b), CANON_W, CANON_H,
        ),
      );
      return index.search(q);
    };

    let bestBias = bias;
    let best = trial(bias);
    for (const b of [bias - STEP, bias + STEP]) {
      if (Math.abs(b) > LIMIT) continue;
      const r = trial(b);
      if (r.best.distance < best.best.distance) {
        best = r;
        bestBias = b;
      }
    }
    bias = bestBias;
    finalDistances.push(best.best.distance);
    if (best.best.index === meta.frames[i].row) correct++;
  }

  const med = finalDistances.length
    ? [...finalDistances].sort((a, b) => a - b)[finalDistances.length >> 1]
    : NaN;
  return { median: med, correct, n: finalDistances.length, bias };
}

let failed = 0;
console.log('crop error   uncorrected d   calibrated d   settled bias   correct');

for (const err of [0, 0.03, -0.03, 0.06]) {
  const ref: number[] = [];
  for (let i = 0; i < 25; i++) {
    const d = uncorrected(i, err);
    if (d != null) ref.push(d);
  }
  const refMed = [...ref].sort((a, b) => a - b)[ref.length >> 1];
  const got = calibrated(err, 25);
  console.log(
    `${(err * 100).toFixed(0).padStart(6)}%   ${String(refMed).padStart(13)}   ` +
    `${String(got.median).padStart(12)}   ${(got.bias * 100).toFixed(0).padStart(11)}%   ` +
    `${got.correct}/${got.n}`,
  );
  // Calibration must not make a correct crop worse, and must recover most of
  // what a wrong one costs.
  if (got.median > refMed) {
    console.log(`FAIL  calibration made ${err * 100}% worse: ${got.median} vs ${refMed}`);
    failed++;
  }
  if (got.correct / got.n < 0.9) {
    console.log(`FAIL  only ${got.correct}/${got.n} correct at ${err * 100}% crop error`);
    failed++;
  }
}

console.log(
  '\nThe scanner column should stay close to the 0% row even as the crop error\n' +
  'grows, which is the calibration doing its job.',
);
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
