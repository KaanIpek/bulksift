/**
 * The frame normaliser, against the layouts a real camera actually delivers.
 *
 * This exists because the first iOS build crashed and there was no log to read.
 * Two assumptions were wrong: that `pixelFormat: 'rgb'` means three bytes per
 * pixel in R,G,B order (on iOS it is usually BGRA), and that rows are tightly
 * packed (they are hardware-aligned, so bytesPerRow > width * bpp). Either one
 * makes the engine read the wrong bytes and eventually past the buffer.
 *
 *   node --experimental-strip-types apps/mobile/test/frame.test.ts
 */

import { toPackedRgb } from '../src/frame.ts';

interface Order { r: number; g: number; b: number }

/** A synthetic frame whose pixel values encode their own x position. */
function build(w: number, h: number, bpp: number, stride: number, order: Order): Uint8Array {
  const buf = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * stride + x * bpp;
      buf[p + order.r] = 10 + x;
      buf[p + order.g] = 100 + x;
      buf[p + order.b] = 200 + x;
    }
  }
  return buf;
}

const RGB: Order = { r: 0, g: 1, b: 2 };
const BGRA: Order = { r: 2, g: 1, b: 0 };

const cases: Array<[string, number, number, number, number, Order, string]> = [
  ['rgb-bgra-8-bit', 8, 4, 4, 8 * 4, BGRA, 'iOS typical, no padding'],
  ['rgb-bgra-8-bit', 8, 4, 4, 8 * 4 + 16, BGRA, 'iOS typical, ROW PADDED'],
  ['rgb-rgba-8-bit', 8, 4, 4, 8 * 4, RGB, 'RGBA'],
  ['rgb-rgb-8-bit', 8, 4, 3, 8 * 3, RGB, 'tight RGB'],
  ['rgb-rgb-8-bit', 8, 4, 4, 8 * 4, RGB, 'RGBX (4-byte "rgb")'],
];

let failed = 0;

for (const [fmt, w, h, bpp, stride, order, label] of cases) {
  const src = build(w, h, bpp, stride, order);
  const { rgb, width, height } = toPackedRgb(src, {
    pixelFormat: fmt, width: w, height: h, bytesPerRow: stride,
  });
  let ok = rgb.length === w * h * 3 && width === w && height === h;
  for (let y = 0; y < h && ok; y++) {
    for (let x = 0; x < w && ok; x++) {
      const o = (y * w + x) * 3;
      if (rgb[o] !== 10 + x || rgb[o + 1] !== 100 + x || rgb[o + 2] !== 200 + x) ok = false;
    }
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${fmt.padEnd(16)} ${label}`);
  if (!ok) failed++;
}

/*
 * Subsampling. The camera negotiates its own resolution - an iPhone hands over
 * 1920x1080 however small a target is asked for - so the frame is stepped down
 * on the way in. Every third pixel of a 12-wide row is x = 0, 3, 6, 9.
 */
{
  const w = 12, h = 8, bpp = 4, stride = w * bpp + 8;
  const src = build(w, h, bpp, stride, BGRA);
  const { rgb, width, height } = toPackedRgb(
    src,
    { pixelFormat: 'rgb-bgra-8-bit', width: w, height: h, bytesPerRow: stride },
    4, // -> step 3
  );
  let ok = width === 4 && height === 3 && rgb.length === 4 * 3 * 3;
  for (let y = 0; y < height && ok; y++) {
    for (let x = 0; x < width && ok; x++) {
      const o = (y * width + x) * 3;
      const sx = x * 3;
      if (rgb[o] !== 10 + sx || rgb[o + 1] !== 100 + sx || rgb[o + 2] !== 200 + sx) ok = false;
    }
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} subsample 12x8 -> ${width}x${height} keeps every 3rd pixel`);
  if (!ok) failed++;
}

// A target wider than the frame must not upscale or change anything.
{
  const src = build(8, 4, 4, 32, BGRA);
  const { width, height } = toPackedRgb(
    src,
    { pixelFormat: 'rgb-bgra-8-bit', width: 8, height: 4, bytesPerRow: 32 },
    960,
  );
  const ok = width === 8 && height === 4;
  console.log(`${ok ? 'OK  ' : 'FAIL'} target wider than the frame leaves it at ${width}x${height}`);
  if (!ok) failed++;
}

// Planar formats are not readable this way and must say so rather than
// producing garbage.
try {
  toPackedRgb(new Uint8Array(100), {
    pixelFormat: 'yuv-420-8-bit-full', width: 8, height: 4, bytesPerRow: 8,
  });
  console.log('FAIL  YUV should have been rejected');
  failed++;
} catch (e) {
  console.log(`OK   YUV rejected: ${(e as Error).message.slice(0, 58)}`);
}

// A truncated buffer must be caught here, not read out of bounds.
try {
  toPackedRgb(new Uint8Array(10), {
    pixelFormat: 'rgb-bgra-8-bit', width: 8, height: 4, bytesPerRow: 32,
  });
  console.log('FAIL  short buffer should have been rejected');
  failed++;
} catch (e) {
  console.log(`OK   short buffer rejected: ${(e as Error).message.slice(0, 50)}`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
