/**
 * Turn whatever the camera actually hands over into tightly packed RGB.
 *
 * The first iOS build crashed here, and the cause was an assumption: asking
 * VisionCamera for `pixelFormat: 'rgb'` does not mean three bytes per pixel in
 * R,G,B order. Its own docs say 'rgb' picks "an RGB format, often 8-bit BGRA" -
 * so on iOS a frame typically arrives as 4-byte BGRA with red and blue swapped,
 * while the engine was reading it as 3-byte RGB.
 *
 * Camera buffers are also usually **row-padded**: `bytesPerRow` is not
 * necessarily `width * bytesPerPixel`, because the hardware aligns each row.
 * Indexing as `(y * width + x) * bpp` therefore walks diagonally off the image
 * and eventually past the end of the buffer.
 *
 * So nothing is assumed here. The frame's declared format decides the stride
 * and the channel order, and the row stride comes from the frame itself.
 */

export interface FrameInfo {
  pixelFormat: string;
  width: number;
  height: number;
  bytesPerRow: number;
}

interface Layout {
  bytesPerPixel: number;
  r: number;
  g: number;
  b: number;
}

/** Byte layout for the interleaved formats a frame output can deliver. */
export function layoutFor(pixelFormat: string): Layout | null {
  switch (pixelFormat) {
    case 'rgb-bgra-8-bit':
      return { bytesPerPixel: 4, r: 2, g: 1, b: 0 };
    case 'rgb-rgba-8-bit':
      return { bytesPerPixel: 4, r: 0, g: 1, b: 2 };
    case 'rgb-rgb-8-bit':
      // RGB or RGBX - 3 or 4 bytes. Resolved from bytesPerRow by the caller.
      return { bytesPerPixel: 3, r: 0, g: 1, b: 2 };
    default:
      return null; // planar YUV and RAW are not handled
  }
}

export interface NormalisedFrame {
  rgb: Uint8Array;
  width: number;
  height: number;
  /**
   * The detector's working image, box-averaged down to `grayW` x `grayH`.
   *
   * Built here because this loop is already reading every pixel it needs. The
   * detector would otherwise walk the whole packed frame a second time to
   * produce exactly this - two passes over half a megapixel, on every frame,
   * for one buffer. The arithmetic is identical to what `downscale` does, so
   * the detection it feeds is unchanged.
   */
  gray: Float32Array;
  grayW: number;
  grayH: number;
  grayScale: number;
}

/**
 * Copy `src` into a tightly packed RGB buffer, optionally subsampling.
 *
 * `targetWidth` caps the output width by taking every Nth pixel and row. The
 * camera hands over whatever its negotiated format is - 1920x1080 on an iPhone,
 * even when asked for less - and the whole recognition suite was measured at
 * 960x540, where a card still arrives ~430 px tall against the 336 px the
 * descriptor needs. Dropping to that here makes every stage downstream cheaper
 * without changing what the engine sees.
 *
 * Throws with a readable message rather than reading out of bounds.
 */
/**
 * Read brightness straight out of the camera's own buffer.
 *
 * Everything else works on the subsampled copy, which is the right trade for
 * cost that scales with pixel count. Edge refinement is the exception: it
 * samples a fixed number of points along four lines, so a sharper source costs
 * it nothing and is worth 26 bits of match quality.
 */
export function lumaSource(src: Uint8Array, info: FrameInfo) {
  const layout = layoutFor(info.pixelFormat);
  if (!layout) return null;
  const { width, height, bytesPerRow } = info;
  let bpp = layout.bytesPerPixel;
  if (info.pixelFormat === 'rgb-rgb-8-bit' && bytesPerRow >= width * 4) bpp = 4;
  const stride = bytesPerRow > 0 ? bytesPerRow : width * bpp;
  if (src.length < stride * height) return null;
  const { r, g, b } = layout;
  return {
    width,
    height,
    lum(x: number, y: number): number {
      const xi = x < 0 ? 0 : x > width - 1 ? width - 1 : x | 0;
      const yi = y < 0 ? 0 : y > height - 1 ? height - 1 : y | 0;
      const p = yi * stride + xi * bpp;
      return 0.299 * src[p + r] + 0.587 * src[p + g] + 0.114 * src[p + b];
    },
  };
}

export function toPackedRgb(
  src: Uint8Array,
  info: FrameInfo,
  targetWidth?: number,
  workWidth = 320,
): NormalisedFrame {
  const { width, height, bytesPerRow } = info;
  if (!width || !height) throw new Error(`frame has no size (${width}x${height})`);

  let layout = layoutFor(info.pixelFormat);
  if (!layout) {
    throw new Error(
      `unsupported pixel format "${info.pixelFormat}" - the frame output must be ` +
      `asked for an interleaved RGB format`,
    );
  }

  // 'rgb-rgb-8-bit' can be RGB or RGBX; the real stride settles it.
  if (info.pixelFormat === 'rgb-rgb-8-bit' && bytesPerRow >= width * 4) {
    layout = { ...layout, bytesPerPixel: 4 };
  }

  const stride = bytesPerRow > 0 ? bytesPerRow : width * layout.bytesPerPixel;
  const needed = stride * height;
  if (src.length < needed) {
    throw new Error(
      `frame buffer is ${src.length} bytes but ${info.pixelFormat} at ` +
      `${width}x${height} with stride ${stride} needs ${needed}`,
    );
  }

  const step =
    targetWidth && targetWidth > 0 ? Math.max(1, Math.floor(width / targetWidth)) : 1;
  const outW = Math.ceil(width / step);
  const outH = Math.ceil(height / step);

  const out = new Uint8Array(outW * outH * 3);
  const { bytesPerPixel: bpp, r, g, b } = layout;
  const rowStep = stride * step;
  const pixStep = bpp * step;

  // The detector's grid, filled as we go. `gStep` must divide the packed size
  // the same way `downscale` would, or the quads it returns scale back wrong.
  const gStep = Math.max(1, Math.floor(outW / workWidth));
  const gW = Math.floor(outW / gStep);
  const gH = Math.floor(outH / gStep);
  const sums = new Int32Array(gW * gH);
  const invCell = 1 / (gStep * gStep);

  let o = 0;
  for (let y = 0, row = 0; y < outH; y++, row += rowStep) {
    let p = row;
    const gy = (y / gStep) | 0;
    const gRow = gy < gH ? gy * gW : -1;
    let gx = 0;
    let inCell = 0;
    for (let x = 0; x < outW; x++, p += pixStep) {
      const rv = src[p + r];
      const gv = src[p + g];
      const bv = src[p + b];
      out[o++] = rv;
      out[o++] = gv;
      out[o++] = bv;
      if (gRow >= 0 && gx < gW) {
        sums[gRow + gx] += (77 * rv + 150 * gv + 29 * bv) >> 8;
      }
      if (++inCell === gStep) {
        inCell = 0;
        gx++;
      }
    }
  }

  const gray = new Float32Array(gW * gH);
  for (let i = 0; i < gray.length; i++) gray[i] = sums[i] * invCell;

  return {
    rgb: out, width: outW, height: outH,
    gray, grayW: gW, grayH: gH, grayScale: gStep,
  };
}

export interface WorkGrid {
  gray: Float32Array;
  w: number;
  h: number;
  /** Camera pixels each grid cell spans, i.e. the coordinate scale. */
  scale: number;
}

export interface CameraPixels {
  data: Uint8Array;
  width: number;
  height: number;
  bytesPerRow: number;
  bytesPerPixel: number;
  rOff: number;
  gOff: number;
  bOff: number;
}

/**
 * Read the frame once, and only for what is actually used.
 *
 * The old path copied every frame into a tidy 960x540 RGB image, then the
 * detector reduced that to a 320-wide grey grid, and the recogniser sampled
 * 240x336 points from it. The middle image was the only thing that cost real
 * work - 1.5 MB written per frame - and on a frame whose card was already
 * recognised nothing ever read it.
 *
 * So it is gone. This builds the grid alone, straight from the camera buffer,
 * with the same arithmetic as before: a 3x3 box over every second pixel, which
 * is exactly what averaging the subsampled copy came to. Rectification reads
 * the camera buffer directly, which is also sharper than the copy was.
 */
export function toWorkGrid(
  src: Uint8Array,
  info: FrameInfo,
  workWidth = 320,
  sampleStep = 2,
): { pixels: CameraPixels; grid: WorkGrid } {
  const { width, height, bytesPerRow } = info;
  if (!width || !height) throw new Error(`frame has no size (${width}x${height})`);

  let layout = layoutFor(info.pixelFormat);
  if (!layout) {
    throw new Error(
      `unsupported pixel format "${info.pixelFormat}" - the frame output must be ` +
      `asked for an interleaved RGB format`,
    );
  }
  if (info.pixelFormat === 'rgb-rgb-8-bit' && bytesPerRow >= width * 4) {
    layout = { ...layout, bytesPerPixel: 4 };
  }
  const bpp = layout.bytesPerPixel;
  const stride = bytesPerRow > 0 ? bytesPerRow : width * bpp;
  if (src.length < stride * height) {
    throw new Error(
      `frame buffer is ${src.length} bytes but ${info.pixelFormat} at ` +
      `${width}x${height} with stride ${stride} needs ${stride * height}`,
    );
  }

  // How many camera pixels one grid cell spans. `sampleStep` is how many of
  // those are actually read - the rest are skipped, as the old subsample did.
  const cell = Math.max(sampleStep, Math.round(width / workWidth / sampleStep) * sampleStep);
  const gW = Math.floor(width / cell);
  const gH = Math.floor(height / cell);
  const taps = Math.max(1, Math.floor(cell / sampleStep));
  const inv = 1 / (taps * taps);

  const gray = new Float32Array(gW * gH);
  const { r, g, b } = layout;
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
          sum += (77 * src[p + r] + 150 * src[p + g] + 29 * src[p + b]) >> 8;
        }
      }
      gray[cy * gW + cx] = sum * inv;
    }
  }

  return {
    pixels: {
      data: src, width, height,
      bytesPerRow: stride, bytesPerPixel: bpp,
      rOff: r, gOff: g, bOff: b,
    },
    grid: { gray, w: gW, h: gH, scale: cell },
  };
}
