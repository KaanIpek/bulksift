/**
 * Is the detector's working resolution the thing holding reads back?
 *
 * Five device sessions came back with the crop correction pinned at its own
 * limits - +15, -15, -10, where the bounds are 0.15 and 0.10. A search that
 * saturates at its bound is saying the correction it wants is bigger than it is
 * allowed to make. But raising the bounds changed nothing in the sleeve
 * harness, which means the synthetic error there is not the device's error.
 *
 * What the device screenshots all share is the other clue: "Move closer - fill
 * the brackets". The card occupies well under a third of the frame. Detection
 * runs on a 320px-wide copy of a 1920px frame, so a card filling 40% of the
 * width is about 130px across in the image the corners are found in - and one
 * pixel of corner error there is 0.8% of the card. `_align.ts` measured 1% of
 * corner error at 16 bits of distance and 11 of margin, and unlike glare it
 * degrades every section of the descriptor equally, which is exactly the shape
 * the device reports: gridH 36%, gridV 28%, art 31%, colour 26%.
 *
 * If that is right, detecting at a higher resolution buys margin directly, and
 * the crop search stops fighting a quad that is simply imprecise. This measures
 * it, including the frame cost, because the budget at 30fps is 33ms.
 *
 *   node --experimental-strip-types packages/core/test/_workwidth.ts
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
const W = meta.width, H = meta.height;

/**
 * The rectified card out of a fixture frame.
 *
 * Detect, then unwarp. Scaling the raw frame instead - which the first draft of
 * this did, and the first drafts of two earlier harnesses before it - shrinks
 * the whole scene into the card's rectangle, so what gets described is the
 * table with a tiny card in the middle. It reads as a total failure at every
 * setting, which is the tell that the harness rather than the idea is broken.
 */
function canonical(i: number): Uint8ClampedArray | null {
  const raw = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const det = detectCard(raw, W, H, { workWidth: 320, channels: 4 });
  if (!det) return null;
  return rectifyFrom(sourceOf(raw, W, H, 4), det.quad, CANON_W, CANON_H);
}

/**
 * Lay a canonical card on a mat at a given share of the frame height.
 *
 * This is the one variable that matters: how many pixels of card the detector
 * gets to find corners in. Everything else about the frame is held still.
 */
function atFill(card: Uint8ClampedArray, fill: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = 32; out[i * 4 + 1] = 34; out[i * 4 + 2] = 40; out[i * 4 + 3] = 255;
  }
  const ch = Math.max(8, Math.floor(H * fill));
  const cw = Math.floor(ch * (CANON_W / CANON_H));
  const left = Math.floor((W - cw) / 2);
  const top = Math.floor((H - ch) / 2);
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

const N = 30;
const WIDTHS = [320, 480, 640, 800];
const FILLS = [0.9, 0.6, 0.45];

console.log('fill  workWidth   distance  margin  correct   detect ms/frame');
for (const fill of FILLS) {
  for (const workWidth of WIDTHS) {
    let dSum = 0, mSum = 0, ok = 0, n = 0, ms = 0;
    for (let i = 0; i < Math.min(N, meta.count); i++) {
      const base = canonical(i);
      if (!base) continue;
      const img = atFill(base, fill);
      const t0 = performance.now();
      const det = detectCard(img, W, H, { workWidth, channels: 4 });
      ms += performance.now() - t0;
      if (!det) continue;
      const card = rectifyFrom(sourceOf(img, W, H, 4), det.quad, CANON_W, CANON_H);
      const s = score(describe(card), meta.frames[i].row);
      dSum += s.d; mSum += Math.min(s.margin, 742); if (s.ok) ok++;
      n++;
    }
    if (!n) { console.log(`${fill}  ${workWidth}: no detections`); continue; }
    console.log(
      `${fill.toFixed(2)}  ${String(workWidth).padStart(9)}   ` +
      `${(dSum / n).toFixed(0).padStart(8)}  ${(mSum / n).toFixed(0).padStart(6)}  ` +
      `${String(ok).padStart(2)}/${n}     ${(ms / Math.min(N, meta.count)).toFixed(2)}`,
    );
  }
  console.log();
}
