/**
 * Can the engine read a card that is lying on its side?
 *
 * It could not, and that is why the first working iOS build recognised nothing.
 * Phone cameras deliver frames in the sensor's native landscape orientation
 * however the device is held - the preview gets rotated for display, the pixel
 * buffer does not. So a card held normally arrives sideways, with an aspect of
 * 1.4 where the detector demanded 0.714, and every candidate scored zero.
 *
 * The synthetic fixtures never caught it because they compose the card upright.
 * This rotates each frame 90 degrees before feeding it in - which is exactly
 * what the phone was doing.
 *
 *   node --experimental-strip-types packages/core/test/rotated.test.ts
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
  frames: Array<{ id: string; row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);

/** Rotate an RGBA frame 90 degrees clockwise, as the sensor would present it. */
function rotate90(src: Uint8ClampedArray, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      // (x,y) -> (h-1-y, x) in the rotated image, whose width is h
      const d = (x * h + (h - 1 - y)) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = 255;
    }
  }
  return { buf: out, w: h, h: w };
}

const frameBytes = meta.width * meta.height * 4;
const results: Record<string, { detected: number; correct: number }> = {
  upright: { detected: 0, correct: 0 },
  sideways: { detected: 0, correct: 0 },
};

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const want = meta.frames[i].row;

  const variants: Array<[string, Uint8ClampedArray, number, number]> = [
    ['upright', rgba, meta.width, meta.height],
  ];
  const r = rotate90(rgba, meta.width, meta.height);
  variants.push(['sideways', r.buf, r.w, r.h]);

  for (const [label, buf, w, h] of variants) {
    const det = detectCard(buf, w, h);
    if (!det) continue;
    results[label].detected++;
    const up = rectify(buf, w, h, det.quad, CANON_W, CANON_H);
    const a = index.search(describeCard(up));
    const b = index.search(describeCard(rotate180(up, CANON_W, CANON_H)));
    const best = a.best.distance <= b.best.distance ? a : b;
    if (best.best.index === want) results[label].correct++;
  }
}

const n = meta.count;
console.log(`${n} frames, each fed upright and rotated 90 degrees\n`);
let failed = false;
for (const [label, r] of Object.entries(results)) {
  const pct = ((r.correct / n) * 100).toFixed(0);
  console.log(
    `${label.padEnd(9)} detected ${String(r.detected).padStart(3)}/${n}   ` +
    `correct ${String(r.correct).padStart(3)}/${n} (${pct}%)`,
  );
  if (r.correct / n < 0.8) failed = true;
}
console.log(
  failed
    ? '\nFAILED - a sideways card must read as well as an upright one'
    : '\nboth orientations read correctly',
);
process.exit(failed ? 1 : 0);
