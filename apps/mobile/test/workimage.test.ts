/**
 * The work image built during packing must equal the one the detector builds.
 *
 * The camera path walks every pixel of the frame to turn it into packed RGB,
 * and the detector then walks the packed frame again to build the small grey
 * grid it actually works on. Two passes over half a megapixel, every frame,
 * for one buffer - so the packer now produces the grid as it goes.
 *
 * That is only safe if the numbers are identical. They feed corner detection,
 * and a grid that differs even slightly would move quads, change rectification
 * and shift every Hamming distance downstream, in a way no single test result
 * would obviously point at. So this compares them exactly.
 *
 *   node --experimental-strip-types apps/mobile/test/workimage.test.ts
 */

import { toPackedRgb } from '../src/frame.ts';
import { detectCard } from '../src/core/detect.ts';

let failed = 0;

/** A frame with structure in it, so the grid is not uniform. */
function scene(w: number, h: number, bpp: number, stride: number): Uint8Array {
  const buf = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * stride + x * bpp;
      const card = x > w * 0.25 && x < w * 0.75 && y > h * 0.15 && y < h * 0.85;
      const v = card ? 200 + ((x * 7 + y * 13) % 40) : 20 + ((x + y) % 16);
      buf[p] = v;            // B
      buf[p + 1] = v >> 1;   // G
      buf[p + 2] = v >> 2;   // R
    }
  }
  return buf;
}

const W = 1920, H = 1080, BPP = 4;
const src = scene(W, H, BPP, W * BPP);
const info = { pixelFormat: 'rgb-bgra-8-bit', width: W, height: H, bytesPerRow: W * BPP };

const packed = toPackedRgb(src, info, 960, 320);
console.log(
  `packed ${packed.width}x${packed.height}, work grid ${packed.grayW}x${packed.grayH} ` +
  `at scale ${packed.grayScale}`,
);

/*
 * Rebuild the grid the way `downscale` does, straight from the packed RGB.
 * Same integer luma, same box, same divisor.
 */
const step = packed.grayScale;
const ow = Math.floor(packed.width / step);
const oh = Math.floor(packed.height / step);
const want = new Float32Array(ow * oh);
const inv = 1 / (step * step);
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    let sum = 0;
    for (let dy = 0; dy < step; dy++) {
      let p = ((y * step + dy) * packed.width + x * step) * 3;
      for (let dx = 0; dx < step; dx++, p += 3) {
        sum += (77 * packed.rgb[p] + 150 * packed.rgb[p + 1] + 29 * packed.rgb[p + 2]) >> 8;
      }
    }
    want[y * ow + x] = sum * inv;
  }
}

if (packed.grayW !== ow || packed.grayH !== oh) {
  console.log(`FAIL  grid is ${packed.grayW}x${packed.grayH}, downscale makes ${ow}x${oh}`);
  failed++;
} else {
  let worst = 0;
  let at = -1;
  for (let i = 0; i < want.length; i++) {
    const d = Math.abs(want[i] - packed.gray[i]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst > 0) {
    console.log(`FAIL  grids differ by up to ${worst} at cell ${at}`);
    failed++;
  } else {
    console.log(`OK   ${want.length} cells identical to the detector's own downscale`);
  }
}

/*
 * And end to end: the same frame must be detected in the same place whether the
 * detector builds the grid itself or is handed one.
 */
const own = detectCard(packed.rgb, packed.width, packed.height, {
  workWidth: 320, channels: 3,
});
const given = detectCard(packed.rgb, packed.width, packed.height, {
  workWidth: 320,
  channels: 3,
  work: { gray: packed.gray, w: packed.grayW, h: packed.grayH, scale: packed.grayScale },
});

if (!own || !given) {
  console.log(`FAIL  detection disagreed on whether there is a card (${!!own} vs ${!!given})`);
  failed++;
} else {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    worst = Math.max(worst, Math.abs(own.quad[i].x - given.quad[i].x));
    worst = Math.max(worst, Math.abs(own.quad[i].y - given.quad[i].y));
  }
  if (worst > 0) {
    console.log(`FAIL  quads differ by up to ${worst.toFixed(3)} px`);
    failed++;
  } else {
    console.log('OK   the same quad either way');
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
