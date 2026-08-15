/**
 * Does the multi-frame vote survive contact with the real Scanner?
 *
 * `_glare.ts` measured the idea in isolation and it was worth 31 bits of
 * distance and 21 of margin. That is not the same claim as "the shipped code
 * recovers the card", and the difference bit immediately: the first version
 * kept its ring keyed on `lastDetection`, which a refused frame clears - and on
 * the device nine frames in ten are refused, which is the entire problem. The
 * vote never reached three descriptors on the one device it was written for.
 *
 * So this one runs glared frames through `Scanner.processFrame` and counts the
 * cards that actually come out, which is the number the user sees.
 *
 *   node --experimental-strip-types packages/core/test/_glarescan.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');
const fixtures = join(here, 'fixtures');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number; frames: Array<{ row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8'));

let seed = 987654321;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/**
 * A specular band laid over the frame, in a different place on every frame.
 *
 * Placed across the middle two thirds so it lands on the card rather than the
 * table - a highlight on the tablecloth is not what stops a full art being
 * recognised, and brightening the background would flatter the detector by
 * raising contrast at the card's edge.
 */
function glared(src: Uint8ClampedArray, strength: number): Uint8ClampedArray {
  const out = src.slice();
  const W = meta.width, H = meta.height;
  const cx = W * (0.25 + rnd() * 0.5);
  const cy = H * (0.25 + rnd() * 0.5);
  const angle = rnd() * Math.PI;
  const rx = W * 0.42, ry = H * 0.10;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++, o += 4) {
      const dx = x - cx, dy = y - cy;
      const u = (dx * ca + dy * sa) / rx;
      const v = (-dx * sa + dy * ca) / ry;
      const t = u * u + v * v;
      if (t >= 1) continue;
      const k = (1 - t) ** 2 * strength;
      out[o] += (255 - out[o]) * k;
      out[o + 1] += (255 - out[o + 1]) * k;
      out[o + 2] += (255 - out[o + 2]) * k;
    }
  }
  return out;
}

const frameAt = (i: number) =>
  new Uint8ClampedArray(frames.buffer, frames.byteOffset + i * frameBytes, frameBytes);

const PROBE = process.env.PROBE === '1';
const HOLD = 12;   // frames a card is held under the lens
const GAP = 6;     // blank frames between cards, as a hand moves the next one in
const blank = new Uint8ClampedArray(frameBytes).fill(140);

for (const strength of [0, 0.5, 0.75, 0.9]) {
  const scanner = new Scanner(index, cards, book);
  let correct = 0, wrong = 0, deepest = 0;
  const depths: number[] = [];
  const margins: number[] = [];
  let refused = 0, seen = 0;
  let lastSeenCrop = '-';

  for (let c = 0; c < meta.count; c++) {
    const want = meta.frames[c].row;
    const src = frameAt(c);
    for (let f = 0; f < HOLD; f++) {
      const img = strength === 0 ? src : glared(src, strength);
      const r = scanner.processFrame(img, meta.width, meta.height, 4);
      if (r.voteFrames != null) {
        depths.push(r.voteFrames);
        if (r.voteFrames > deepest) deepest = r.voteFrames;
      }
      if (PROBE && c === 0) {
        console.log(`  f${f} det=${r.detection ? 'y' : 'n'} vote=${r.voteFrames ?? '-'} ` +
          `reused=${r.timings.reused} prev=${r.preview ? 'y' : 'n'} m=${r.nameMargin ?? '-'}`);
      }
      if (r.detection) {
        seen++;
        if (!r.preview) refused++;
      }
      if (r.nameMargin != null && Number.isFinite(r.nameMargin)) margins.push(r.nameMargin);
      if (r.crop) lastSeenCrop = `${r.crop.dx.toFixed(2)}/${r.crop.dy.toFixed(2)}/${r.crop.scale.toFixed(2)}`;
      if (r.hit) {
        if (r.hit.card === cards[want]) correct++;
        else wrong++;
      }
    }
    for (let f = 0; f < GAP; f++) scanner.processFrame(blank, meta.width, meta.height, 4);
  }

  const mean = depths.length
    ? (depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(1) : '0';
  const lastCrop = lastSeenCrop;
  const mm = margins.length
    ? (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(0) : '-';
  console.log(
    `glare ${(strength * 100).toFixed(0).padStart(3)}%  ` +
    `${String(correct).padStart(2)}/${meta.count} correct  ` +
    `${wrong} wrong  ·  margin mean ${String(mm).padStart(3)}  ` +
    `refused ${String(Math.round((refused / Math.max(seen, 1)) * 100)).padStart(2)}%  ` +
    `·  vote ${mean}/${deepest}  ·  crop ${lastCrop}`,
  );
}
