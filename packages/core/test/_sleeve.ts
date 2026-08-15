/**
 * A card in a sleeve, which is how most of them are handed over.
 *
 * The detector finds a physical boundary. When that boundary is a sleeve rather
 * than the card, every crop is systematically wrong - a few percent too large,
 * and off-centre by however the card sits inside it. `_align.ts` measured what
 * that costs: 3% of corner error is 42 bits of distance and 39 of margin, more
 * than the heaviest glare.
 *
 * The scanner is supposed to learn its way out of that, because the error is a
 * property of the setup rather than the card and so survives from one card to
 * the next. This checks whether it actually does, end to end, through
 * `processFrame` - not through a harness that reimplements the idea.
 *
 *   node --experimental-strip-types packages/core/test/_sleeve.ts
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
 * Lay a canonical card inside a sleeve on a dark mat.
 *
 * The sleeve is a lighter rectangle around the card, wider on the left and top
 * than on the right and bottom - a card does not sit centred in its sleeve, and
 * a symmetric border would only exercise the scale axis, which was already
 * being searched before this work.
 */
function sleeved(card: Uint8ClampedArray, pad: number, skew: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = 38; out[i * 4 + 1] = 40; out[i * 4 + 2] = 46; out[i * 4 + 3] = 255;
  }
  // The card, as large as fits with room for the sleeve.
  const ch = Math.floor(H * 0.72);
  const cw = Math.floor(ch * (CANON_W / CANON_H));
  const px = Math.round(cw * pad);
  const left = Math.floor((W - cw) / 2);
  const top = Math.floor((H - ch) / 2);

  // Sleeve first, so the card draws over it.
  const sl = left - px - Math.round(px * skew);
  const st = top - px - Math.round(px * skew);
  const sw = cw + px * 2, sh = ch + px * 2;
  for (let y = st; y < st + sh; y++) {
    if (y < 0 || y >= H) continue;
    for (let x = sl; x < sl + sw; x++) {
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

const N = 40;
const HOLD = 10;
const GAP = 4;
const blank = new Uint8ClampedArray(frameBytes).fill(40);

const bases: Array<{ img: Uint8ClampedArray; row: number }> = [];
for (let i = 0; i < N && i < meta.count; i++) {
  const c = canonical(i);
  if (c) bases.push({ img: c, row: meta.frames[i].row });
}

console.log(`${bases.length} cards, held ${HOLD} frames each\n`);
console.log('sleeve            correct   margin   crop learned (dx/dy/scale)');

for (const [pad, skew] of [[0.0, 0], [0.03, 0.6], [0.05, 0.6], [0.08, 0.6]] as const) {
  const scanner = new Scanner(index, cards, book);
  let correct = 0, wrong = 0;
  const margins: number[] = [];
  let crop = '-';

  for (const b of bases) {
    const frame = pad === 0
      ? sleeved(b.img, 0.0001, 0)
      : sleeved(b.img, pad, skew);
    for (let f = 0; f < HOLD; f++) {
      const r = scanner.processFrame(frame, W, H, 4);
      if (r.nameMargin != null && Number.isFinite(r.nameMargin)) margins.push(r.nameMargin);
      if (r.crop) {
        crop = `${r.crop.dx.toFixed(2)}/${r.crop.dy.toFixed(2)}/${r.crop.scale.toFixed(2)}`;
      }
      if (r.hit) {
        if (r.hit.card === cards[b.row]) correct++;
        else wrong++;
      }
    }
    for (let f = 0; f < GAP; f++) scanner.processFrame(blank, W, H, 4);
  }

  const mm = margins.length
    ? (margins.reduce((a, b2) => a + b2, 0) / margins.length).toFixed(0) : '-';
  console.log(
    `pad ${(pad * 100).toFixed(0).padStart(2)}% skew ${skew}   ` +
    `${String(correct).padStart(2)}/${bases.length}  ${wrong} wrong   ` +
    `${String(mm).padStart(5)}   ${crop}`,
  );
}
