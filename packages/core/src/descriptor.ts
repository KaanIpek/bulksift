/**
 * Card descriptor - must stay bit-for-bit identical to tools/descriptor.py.
 *
 * The index is built in Python and searched here, so any disagreement between
 * the two implementations shows up as silently wrong card matches rather than
 * as an error. Everything is therefore integer box-averaging over grids that
 * divide the canonical size exactly - no canvas downscaling, no DCT, no float
 * resampling kernels whose rounding differs between platforms.
 *
 * Canonical card: 240 x 336. Layout, 742 bits (93 bytes):
 *   full 16x16 grid, horizontal diffs  16*15 = 240
 *   full 16x16 grid, vertical   diffs  15*16 = 240
 *   art  12x14 grid, horizontal diffs  14*11 = 154
 *   colour 6x6 grid, 3 channels vs median   = 108
 */

export const CANON_W = 240;
export const CANON_H = 336;

export const ART_X0 = 30;
export const ART_X1 = 210; // width 180 = 12 * 15
export const ART_Y0 = 42;
export const ART_Y1 = 168; // height 126 = 14 * 9

export const FULL_GRID = 16;
export const ART_GX = 12;
export const ART_GY = 14;
export const COLOR_GRID = 6;

export const N_BITS =
  FULL_GRID * (FULL_GRID - 1) * 2 + ART_GY * (ART_GX - 1) + COLOR_GRID * COLOR_GRID * 3;
/**
 * Rows are padded to a multiple of 4 bytes so the matcher can XOR whole 32-bit
 * words instead of bytes - a 4x cut in the inner loop, which is what the search
 * cost is made of on a phone. The padding bits are zero in both the index and
 * the query, so they never change a Hamming distance.
 */
export const DESC_BYTES = (N_BITS + 7) >> 3;
export const N_BYTES = ((DESC_BYTES + 3) >> 2) << 2;

/**
 * The strip: the bottom 36 rows of the card, full width, on a 30x4 grid.
 *
 * A second, separate descriptor covering only the footer - collector number,
 * set symbol, rarity mark, copyright line. The main descriptor's finest cell is
 * 15x21 px, which smears that whole area into four numbers, so two printings of
 * one illustration land ~50 bits apart, inside camera noise. The footer is the
 * only place they actually differ. Digits are unreadable at this scale and OCR
 * on them was measured at 66% accuracy with the number legible in 8% of frames;
 * the set symbol beside them is a solid graphic several times a digit's size,
 * and that is what these bits keep.
 */
export const STRIP_Y0 = 300;
export const STRIP_Y1 = 336;
export const STRIP_GX = 30;
export const STRIP_GY = 4;
export const STRIP_BITS = STRIP_GY * (STRIP_GX - 1);
export const STRIP_BYTES = (STRIP_BITS + 7) >> 3;

/**
 * BT.601 luma, floored - matches numpy's np.floor in the reference.
 *
 * Int32 rather than Float64: the values are integers 0..255 by construction, so
 * this is exact, and it halves the memory traffic of the grids that read it -
 * which is 645 KB per call at canonical size.
 */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Int32Array {
  const out = new Int32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = Math.floor(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return out;
}

/**
 * Exact box SUM of a plane onto a gx-by-gy grid.
 * Requires exact divisibility, same as the Python reference.
 *
 * Sums rather than means: every cell covers the same integer pixel count, so
 * the comparisons downstream are unchanged, but a sum of integers is exact
 * while a mean's last bit depends on accumulation order. numpy sums pairwise
 * and this loop sums sequentially, which made 4 of 250 test cards disagree by
 * one bit on exact ties. Integer sums make the two implementations identical.
 */
export function boxGrid(
  plane: Int32Array | Float64Array,
  planeW: number,
  planeH: number,
  gx: number,
  gy: number,
  x0 = 0,
  y0 = 0,
  regionW = planeW,
  regionH = planeH,
): Float64Array {
  if (regionW % gx !== 0 || regionH % gy !== 0) {
    throw new Error(`region ${regionW}x${regionH} not divisible by ${gx}x${gy}`);
  }
  const cw = regionW / gx;
  const ch = regionH / gy;
  const out = new Float64Array(gx * gy);
  for (let cy = 0; cy < gy; cy++) {
    for (let cx = 0; cx < gx; cx++) {
      let sum = 0;
      const yStart = y0 + cy * ch;
      const xStart = x0 + cx * cw;
      for (let y = 0; y < ch; y++) {
        const row = (yStart + y) * planeW + xStart;
        for (let x = 0; x < cw; x++) sum += plane[row + x];
      }
      out[cy * gx + cx] = sum;
    }
  }
  return out;
}

function median(values: Float64Array): number {
  const s = Float64Array.from(values).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Compute the descriptor of a rectified card.
 * `rgba` must be exactly CANON_W x CANON_H, 4 bytes per pixel.
 * Returns MSB-first packed bytes, matching numpy packbits(bitorder="big").
 */
export function describe(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const gray = toGray(rgba, CANON_W, CANON_H);
  const bits = new Uint8Array(N_BITS);
  let k = 0;

  const full = boxGrid(gray, CANON_W, CANON_H, FULL_GRID, FULL_GRID);
  for (let y = 0; y < FULL_GRID; y++) {
    for (let x = 1; x < FULL_GRID; x++) {
      bits[k++] = full[y * FULL_GRID + x] > full[y * FULL_GRID + x - 1] ? 1 : 0;
    }
  }
  for (let y = 1; y < FULL_GRID; y++) {
    for (let x = 0; x < FULL_GRID; x++) {
      bits[k++] = full[y * FULL_GRID + x] > full[(y - 1) * FULL_GRID + x] ? 1 : 0;
    }
  }

  const art = boxGrid(
    gray, CANON_W, CANON_H, ART_GX, ART_GY,
    ART_X0, ART_Y0, ART_X1 - ART_X0, ART_Y1 - ART_Y0,
  );
  for (let y = 0; y < ART_GY; y++) {
    for (let x = 1; x < ART_GX; x++) {
      bits[k++] = art[y * ART_GX + x] > art[y * ART_GX + x - 1] ? 1 : 0;
    }
  }

  // Python reads BGR from cv2; channel c here is the matching RGB index.
  // Summed straight out of the frame rather than through an intermediate
  // plane - materialising one cost 645 KB per channel, three times per call.
  const cw = CANON_W / COLOR_GRID;
  const chh = CANON_H / COLOR_GRID;
  const cg = new Float64Array(COLOR_GRID * COLOR_GRID);
  for (const c of [2, 1, 0]) {
    cg.fill(0);
    for (let y = 0; y < CANON_H; y++) {
      const gy = (y / chh) | 0;
      let p = (y * CANON_W) * 4 + c;
      for (let x = 0; x < CANON_W; x++, p += 4) {
        cg[gy * COLOR_GRID + ((x / cw) | 0)] += rgba[p];
      }
    }
    const med = median(cg);
    for (let i = 0; i < cg.length; i++) bits[k++] = cg[i] > med ? 1 : 0;
  }

  if (k !== N_BITS) throw new Error(`descriptor produced ${k} bits, expected ${N_BITS}`);

  const packed = new Uint8Array(N_BYTES);
  for (let i = 0; i < N_BITS; i++) {
    if (bits[i]) packed[i >> 3] |= 0x80 >> (i & 7);
  }
  return packed;
}

/**
 * Compute the footer descriptor of a rectified card.
 * `rgba` must be exactly CANON_W x CANON_H, 4 bytes per pixel.
 * Must stay bit-for-bit identical to `strip_bits` in tools/descriptor.py.
 */
export function describeStrip(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const gray = toGray(rgba, CANON_W, CANON_H);
  const cells = boxGrid(
    gray, CANON_W, CANON_H, STRIP_GX, STRIP_GY,
    0, STRIP_Y0, CANON_W, STRIP_Y1 - STRIP_Y0,
  );

  const packed = new Uint8Array(STRIP_BYTES);
  let k = 0;
  for (let y = 0; y < STRIP_GY; y++) {
    for (let x = 1; x < STRIP_GX; x++) {
      if (cells[y * STRIP_GX + x] > cells[y * STRIP_GX + x - 1]) {
        packed[k >> 3] |= 0x80 >> (k & 7);
      }
      k++;
    }
  }
  if (k !== STRIP_BITS) throw new Error(`strip produced ${k} bits, expected ${STRIP_BITS}`);
  return packed;
}
