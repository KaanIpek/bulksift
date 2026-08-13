/**
 * The frame is read once now, and only for what is used. This checks that
 * removing the copy changed nothing.
 *
 * The old path copied every frame into a tidy 960x540 RGB image, built the
 * detector's grid from that, and rectified from it. The copy was 1.5 MB written
 * per frame and a frame whose card was already recognised never read it, so it
 * is gone: the grid is built straight from the camera buffer, and rectification
 * samples that buffer directly.
 *
 * Both halves have to be verified, because both feed the descriptor and neither
 * would announce a small error. A grid that differs moves the detected corners;
 * a sampler that differs shifts every Hamming distance. Either would show up
 * only as "it got a bit worse", which is the hardest kind of bug to trace.
 *
 *   node --experimental-strip-types apps/mobile/test/workimage.test.ts
 */

import { toWorkGrid } from '../src/frame.ts';
import { detectCard, rectify, rectifyFrom, sourceOf } from '../src/core/detect.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

/** A frame with structure in it, in the BGRA layout an iPhone delivers. */
function scene(w: number, h: number, bpp: number, stride: number): Uint8Array {
  const buf = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * stride + x * bpp;
      const card = x > w * 0.25 && x < w * 0.75 && y > h * 0.15 && y < h * 0.85;
      const v = card ? 200 + ((x * 7 + y * 13) % 40) : 20 + ((x + y) % 16);
      buf[p] = v >> 2;        // B
      buf[p + 1] = v >> 1;    // G
      buf[p + 2] = v;         // R
      if (bpp === 4) buf[p + 3] = 255;
    }
  }
  return buf;
}

const W = 1920, H = 1080, BPP = 4;
// A padded row, because camera buffers are hardware-aligned and the padding is
// what made the very first device build read diagonally off the image.
const STRIDE = W * BPP + 64;
const src = scene(W, H, BPP, STRIDE);
const info = { pixelFormat: 'rgb-bgra-8-bit', width: W, height: H, bytesPerRow: STRIDE };

const { pixels, grid } = toWorkGrid(src, info, 320);
console.log(`camera ${W}x${H} stride ${STRIDE} -> grid ${grid.w}x${grid.h} at scale ${grid.scale}`);

/*
 * 1. The grid must equal a 3x3 box over every second pixel - which is exactly
 *    what averaging the old subsampled copy came to.
 */
{
  const cell = grid.scale;
  const taps = Math.max(1, Math.floor(cell / 2));
  const inv = 1 / (taps * taps);
  let worst = 0;
  for (let cy = 0; cy < grid.h; cy++) {
    for (let cx = 0; cx < grid.w; cx++) {
      let sum = 0;
      for (let ty = 0; ty < taps; ty++) {
        for (let tx = 0; tx < taps; tx++) {
          const p = (cy * cell + ty * 2) * STRIDE + (cx * cell + tx * 2) * BPP;
          // BGRA: red is at +2, blue at +0.
          sum += (77 * src[p + 2] + 150 * src[p + 1] + 29 * src[p]) >> 8;
        }
      }
      // The grid is a Float32Array, so the reference is rounded to the same
      // precision before comparing. Anything beyond that is a real difference.
      const want = Math.fround(sum * inv);
      worst = Math.max(worst, Math.abs(want - grid.gray[cy * grid.w + cx]));
    }
  }
  check(`${grid.w * grid.h} grid cells match the reference box average`, worst === 0,
    `worst difference ${worst}`);
}

// 2. The grid has to be usable: a card-shaped thing in the frame is found.
const det = detectCard(src, W, H, {
  workWidth: 320, channels: 4,
  work: { gray: grid.gray, w: grid.w, h: grid.h, scale: grid.scale },
  refine: false,
});
check('a card is detected from the grid alone', !!det,
  det ? '' : 'no detection');

/*
 * 3. Sampling the camera buffer must equal sampling a tidy RGB copy of it.
 *    This is the check that catches a wrong stride or a swapped channel - the
 *    two mistakes that cost the first three device builds.
 */
if (det) {
  const tidy = new Uint8Array(W * H * 3);
  for (let y = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * STRIDE + x * BPP;
      tidy[o++] = src[p + 2];
      tidy[o++] = src[p + 1];
      tidy[o++] = src[p];
    }
  }
  const fromCamera = rectifyFrom(pixels, det.quad, 240, 336);
  const fromTidy = rectify(tidy, W, H, det.quad, 240, 336, 3);
  let worst = 0;
  for (let i = 0; i < fromTidy.length; i++) {
    worst = Math.max(worst, Math.abs(fromCamera[i] - fromTidy[i]));
  }
  check('rectifying the camera buffer equals rectifying a tidy copy', worst === 0,
    `worst channel difference ${worst}`);

  // And the convenience wrapper must agree with the explicit source.
  const viaWrapper = rectify(tidy, W, H, det.quad, 240, 336, 3);
  const viaSource = rectifyFrom(sourceOf(tidy, W, H, 3), det.quad, 240, 336);
  let same = true;
  for (let i = 0; i < viaWrapper.length && same; i++) same = viaWrapper[i] === viaSource[i];
  check('rectify() and rectifyFrom(sourceOf()) agree', same);
}

// 4. A truncated buffer must still be caught here rather than read past.
try {
  toWorkGrid(new Uint8Array(1000), info, 320);
  check('a short buffer is rejected', false, 'no error thrown');
} catch (e) {
  check(`a short buffer is rejected: ${(e as Error).message.slice(0, 44)}…`, true);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
