/**
 * A card in a sleeve still reads.
 *
 * Most cards worth scanning are in one, and a sleeve moves the boundary the
 * detector locks onto: the crop comes out a few percent too large and off
 * centre, because a card does not sit centred in its sleeve. That is the most
 * expensive thing that can happen to a read - worse than the heaviest glare -
 * and it used to take the fixture set from 35 of 40 down to 5.
 *
 * The scanner corrects for it by searching the crop, which works because the
 * error belongs to the setup rather than the card and so survives from one card
 * to the next. This is the regression guard on that: it is easy to make the
 * search cautious enough to stop chasing an empty desk and, in the same change,
 * cautious enough to stop correcting a sleeve.
 *
 *   node --experimental-strip-types packages/core/test/sleeve.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W } from '../src/descriptor.ts';
import { detectCard, rectifyFrom, sourceOf } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');
const fixtures = join(here, 'fixtures');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8'));

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number; frames: Array<{ row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;
const W = meta.width, H = meta.height;

function canonical(i: number): Uint8ClampedArray | null {
  const raw = new Uint8ClampedArray(frames.buffer, frames.byteOffset + i * frameBytes, frameBytes);
  const det = detectCard(raw, W, H, { workWidth: 320, channels: 4 });
  if (!det) return null;
  return rectifyFrom(sourceOf(raw, W, H, 4), det.quad, CANON_W, CANON_H);
}

/**
 * A canonical card inside a sleeve on a dark mat.
 *
 * The border is wider on the left and top - a symmetric one would only exercise
 * the scale axis, which was searched long before translation was, and the point
 * of the test is the axis that was missing.
 */
function sleeved(card: Uint8ClampedArray, pad: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = 38; out[i * 4 + 1] = 40; out[i * 4 + 2] = 46; out[i * 4 + 3] = 255;
  }
  const ch = Math.floor(H * 0.72);
  const cw = Math.floor(ch * (CANON_W / CANON_H));
  const px = Math.max(1, Math.round(cw * pad));
  const left = Math.floor((W - cw) / 2);
  const top = Math.floor((H - ch) / 2);
  const sl = left - px - Math.round(px * 0.6);
  const st = top - px - Math.round(px * 0.6);
  for (let y = st; y < st + ch + px * 2; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = sl; x < sl + cw + px * 2; x++) {
      if (x < 0 || x >= W) continue;
      const o = (y * W + x) * 4;
      out[o] = 205; out[o + 1] = 208; out[o + 2] = 214;
    }
  }
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(CANON_H - 1, Math.floor((y / ch) * CANON_H));
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(CANON_W - 1, Math.floor((x / cw) * CANON_W));
      const s = (sy * CANON_W + sx) * 4;
      const o = ((top + y) * W + (left + x)) * 4;
      out[o] = card[s]; out[o + 1] = card[s + 1]; out[o + 2] = card[s + 2];
    }
  }
  return out;
}

const N = 30;
const HOLD = 10;
const GAP = 4;
const blank = new Uint8ClampedArray(frameBytes).fill(40);

const bases: Array<{ img: Uint8ClampedArray; row: number }> = [];
for (let i = 0; i < N && i < meta.count; i++) {
  const c = canonical(i);
  if (c) bases.push({ img: c, row: meta.frames[i].row });
}

/** Read every card through a sleeve of `pad`, and say how many came back. */
function run(pad: number): { correct: number; crop: string } {
  const scanner = new Scanner(index, cards, book);
  let correct = 0;
  let crop = '-';
  for (const b of bases) {
    const frame = sleeved(b.img, pad);
    for (let f = 0; f < HOLD; f++) {
      const r = scanner.processFrame(frame, W, H, 4);
      if (r.crop) {
        crop = `${r.crop.dx.toFixed(2)}/${r.crop.dy.toFixed(2)}/${r.crop.scale.toFixed(2)}`;
      }
      if (r.hit && r.hit.card === cards[b.row]) correct++;
    }
    for (let f = 0; f < GAP; f++) scanner.processFrame(blank, W, H, 4);
  }
  return { correct, crop };
}

for (const [pad, floor] of [[0.03, 0.7], [0.05, 0.6], [0.08, 0.55]] as const) {
  const { correct, crop } = run(pad);
  const want = Math.ceil(bases.length * floor);
  check(
    `a ${(pad * 100).toFixed(0)}% sleeve still reads (${correct}/${bases.length}, crop ${crop})`,
    correct >= want,
    `wanted at least ${want}`,
  );
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
