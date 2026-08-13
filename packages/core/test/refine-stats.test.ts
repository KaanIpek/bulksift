/**
 * How often does the sub-pixel edge refinement actually fire, and when it bails,
 * why? Refinement silently falls back to the coarse quad, so a high failure rate
 * looks like "the refinement did not help" rather than "the refinement did not
 * run".
 *
 *   node --experimental-strip-types packages/core/test/refine-stats.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCard, detectStats } from '../src/detect.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

detectStats.reset();
let detected = 0;
for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  if (detectCard(rgba, meta.width, meta.height)) detected++;
}

const pct = (n: number) => `${((n / meta.count) * 100).toFixed(0)}%`;
console.log(`${meta.count} frames, ${detected} cards detected\n`);
console.log(`refine succeeded : ${detectStats.refineOk}  (${pct(detectStats.refineOk)})`);
console.log(`  short edge     : ${detectStats.refineShortEdge}`);
console.log(`  too few points : ${detectStats.refineFewPoints}`);
console.log(`  angle rejected : ${detectStats.refineAngle}`);
console.log(`  corner moved   : ${detectStats.refineCorner}`);
