/**
 * Is corner localisation the ceiling?
 *
 * The device reports every section of the descriptor disagreeing by about the
 * same amount - gridH 31%, gridV 33%, art 24%, colour 24% - and that shape is
 * evidence in itself. Glare lands on the art and the colour far harder than on
 * the layout grid, so it cannot be the whole story. Something that shifts the
 * WHOLE image degrades all four alike, and there is only one such thing between
 * the camera and the descriptor: the quad the card is rectified from.
 *
 * This perturbs a known-good quad by a known amount and reads off what it
 * costs, so the size of the effect is measured rather than argued about.
 *
 *   node --experimental-strip-types packages/core/test/_align.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe } from '../src/descriptor.ts';
import { detectCard, rectifyFrom, sourceOf } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';
import { baseName } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');
const fixtures = join(here, 'fixtures');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const NAMES = cards.map((c) => baseName(c.n));

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number; frames: Array<{ row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

let seed = 31337;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function score(q: Uint8Array, want: number) {
  const top = index.topK(q, 16);
  const winner = NAMES[top[0].index];
  let margin = 742;
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    margin = top[k].distance - top[0].distance;
    break;
  }
  return { d: top[0].distance, margin, ok: top[0].index === want };
}

const N = 40;

console.log('corner error   distance   margin   correct');
for (const pct of [0, 0.005, 0.01, 0.02, 0.03, 0.05]) {
  let dSum = 0, mSum = 0, ok = 0, n = 0;

  for (let i = 0; i < Math.min(N, meta.count); i++) {
    const raw = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
    if (!det) continue;

    // Move each corner independently, as a detector that is slightly wrong
    // about the edge does - not a clean translation of the whole quad, which
    // would understate it.
    const span = Math.hypot(
      det.quad[1].x - det.quad[0].x, det.quad[1].y - det.quad[0].y,
    );
    const quad = det.quad.map((p) => ({
      x: p.x + (rnd() - 0.5) * 2 * pct * span,
      y: p.y + (rnd() - 0.5) * 2 * pct * span,
    })) as typeof det.quad;

    const img = rectifyFrom(
      sourceOf(raw, meta.width, meta.height, 4), quad, CANON_W, CANON_H,
    );
    const s = score(describe(img), meta.frames[i].row);
    dSum += s.d; mSum += Math.min(s.margin, 742); if (s.ok) ok++;
    n++;
  }

  console.log(
    `${(pct * 100).toFixed(1).padStart(9)}%   ` +
    `${(dSum / n).toFixed(0).padStart(8)}   ` +
    `${(mSum / n).toFixed(0).padStart(6)}   ${ok}/${n}`,
  );
}
