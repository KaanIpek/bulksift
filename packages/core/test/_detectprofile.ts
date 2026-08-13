/**
 * Where detection's time goes, substage by substage.
 *
 * On the phone `detect` is the whole frame budget once recognition is skipped,
 * and "detect is slow" is not something you can act on. This times the pieces
 * on the same input the app gives it: a pre-built work grid, so the downscale
 * that the packer now does is excluded, exactly as on device.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectCard, sourceOf } from '../src/detect.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

/** The packer's job: subsample to 960 wide and build the 320-wide grey grid. */
function pack(src: Uint8ClampedArray, w: number, h: number) {
  const step = 2;
  const outW = Math.ceil(w / step);
  const outH = Math.ceil(h / step);
  const rgb = new Uint8Array(outW * outH * 3);
  const gStep = Math.max(1, Math.floor(outW / 320));
  const gW = Math.floor(outW / gStep);
  const gH = Math.floor(outH / gStep);
  const sums = new Int32Array(gW * gH);
  const inv = 1 / (gStep * gStep);
  let o = 0;
  for (let y = 0; y < outH; y++) {
    const gy = (y / gStep) | 0;
    const gRow = gy < gH ? gy * gW : -1;
    let gx = 0, inCell = 0;
    let p = y * step * w * 4;
    for (let x = 0; x < outW; x++, p += step * 4) {
      const rv = src[p], gv = src[p + 1], bv = src[p + 2];
      rgb[o++] = rv; rgb[o++] = gv; rgb[o++] = bv;
      if (gRow >= 0 && gx < gW) sums[gRow + gx] += (77 * rv + 150 * gv + 29 * bv) >> 8;
      if (++inCell === gStep) { inCell = 0; gx++; }
    }
  }
  const gray = new Float32Array(gW * gH);
  for (let i = 0; i < gray.length; i++) gray[i] = sums[i] * inv;
  return { rgb, width: outW, height: outH, gray, grayW: gW, grayH: gH, grayScale: gStep };
}

/** The new path: build only the grid, straight from the source buffer. */
function grid(src: Uint8ClampedArray, w: number, h: number, workWidth = 320, sampleStep = 2) {
  const bpp = 4;
  const stride = w * bpp;
  const cell = Math.max(sampleStep, Math.round(w / workWidth / sampleStep) * sampleStep);
  const gW = Math.floor(w / cell);
  const gH = Math.floor(h / cell);
  const taps = Math.max(1, Math.floor(cell / sampleStep));
  const inv = 1 / (taps * taps);
  const gray = new Float32Array(gW * gH);
  const rowStep = stride * sampleStep;
  const colStep = bpp * sampleStep;
  for (let cy = 0; cy < gH; cy++) {
    const topRow = cy * cell * stride;
    for (let cx = 0; cx < gW; cx++) {
      let sum = 0;
      let rowBase = topRow;
      const left = cx * cell * bpp;
      for (let ty = 0; ty < taps; ty++, rowBase += rowStep) {
        let p = rowBase + left;
        for (let tx = 0; tx < taps; tx++, p += colStep) {
          sum += (77 * src[p] + 150 * src[p + 1] + 29 * src[p + 2]) >> 8;
        }
      }
      gray[cy * gW + cx] = sum * inv;
    }
  }
  return { gray, w: gW, h: gH, scale: cell };
}

const N = 120;
let tPack = 0, tDetectWithWork = 0, tDetectAlone = 0, n = 0;
let tGrid = 0, tDetectGrid = 0;

for (let i = 0; i < N; i++) {
  const raw = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + (i % meta.count) * frameBytes, frameBytes,
  );

  let t = performance.now();
  const p = pack(raw, meta.width, meta.height);
  tPack += performance.now() - t;

  t = performance.now();
  detectCard(p.rgb, p.width, p.height, {
    workWidth: 320, channels: 3,
    work: { gray: p.gray, w: p.grayW, h: p.grayH, scale: p.grayScale },
  });
  tDetectWithWork += performance.now() - t;

  t = performance.now();
  detectCard(p.rgb, p.width, p.height, { workWidth: 320, channels: 3 });
  tDetectAlone += performance.now() - t;

  t = performance.now();
  const g = grid(raw, meta.width, meta.height, 320);
  tGrid += performance.now() - t;

  t = performance.now();
  detectCard(raw, meta.width, meta.height, {
    workWidth: 320, channels: 4,
    work: { gray: g.gray, w: g.w, h: g.h, scale: g.scale },
  });
  tDetectGrid += performance.now() - t;
  void sourceOf;

  n++;
}

const per = (v: number) => (v / n).toFixed(2).padStart(6);
console.log(`${n} frames, packed to 960x540 with a 320x180 grid\n`);
console.log(`pack (subsample + grid)      ${per(tPack)} ms`);
console.log(`detect, grid handed over     ${per(tDetectWithWork)} ms`);
console.log(`detect, building its own     ${per(tDetectAlone)} ms`);
console.log(`\nfloor for a reused frame     ${per(tPack + tDetectWithWork)} ms`);
console.log(
  '\nThe packer exists to avoid the second walk over the frame. What it cannot\n' +
  'avoid is writing 1.5 MB of RGB that a reused frame never reads.',
);

console.log(`\ngrid only, no RGB copy       ${per(tGrid)} ms`);
console.log(`detect on that grid          ${per(tDetectGrid)} ms`);
console.log(`new floor for a reused frame ${per(tGrid + tDetectGrid)} ms`);
