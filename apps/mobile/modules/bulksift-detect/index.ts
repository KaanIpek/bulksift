/**
 * The native detection core, with the TypeScript one behind it.
 *
 * Nothing here is required. When the native module is absent - on the web, in
 * a test run, on a build where it failed to link - `accelerator` is null and
 * the engine uses the TypeScript path it always had. That is deliberate: the
 * TypeScript implementation is the reference the C++ is checked against, so it
 * has to stay alive and exercised, not become dead code behind a flag.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';

import type { WorkImage } from '../../src/core/detect';
import type { IndexAccelerator } from '../../src/core/matcher';

interface NativeDetect {
  run(
    src: Uint8Array,
    params: Int32Array,
    outGray: Float32Array,
    outMeta: Int32Array,
    outComps: Int32Array,
  ): number;
  describe(
    src: Uint8Array,
    params: Int32Array,
    quad: Float64Array,
    flipped: boolean,
    outDesc: Uint8Array,
    outStrip: Uint8Array,
  ): number;
  loadIndex(data: Uint8Array): number;
  search(query: Uint8Array, out4: Int32Array): boolean;
  stripDistance(row: number, strip: Uint8Array): number;
  topK(query: Uint8Array, k: number, outPairs: Int32Array): number;
}

const native = requireOptionalNativeModule<NativeDetect>('BulkSiftDetect');

export const isNativeAvailable = native != null;

export interface FrameLayout {
  width: number;
  height: number;
  bytesPerRow: number;
  bytesPerPixel: number;
  rOff: number;
  gOff: number;
  bOff: number;
}

export interface NativeStages {
  grid: WorkImage;
  /** Per blob: its pixel count and the leftmost/rightmost pixel of each row. */
  components: Array<{ size: number; boundary: Array<{ x: number; y: number }> }>;
}

/*
 * Buffers live for the life of the process and are reused every frame.
 *
 * Sized generously once rather than grown: a 320x180 grid is 57,600 cells, and
 * the component list is bounded by how much boundary a thresholded gradient can
 * produce. Running out is handled - the shim fills what it can and reports how
 * much is real - rather than reallocating mid-scan.
 */
const MAX_GRID = 512 * 512;
const MAX_COMP_INTS = 1 << 17;
let gray: Float32Array | null = null;
let meta: Int32Array | null = null;
let comps: Int32Array | null = null;
let params: Int32Array | null = null;

/**
 * Run the per-pixel stages natively.
 *
 * Returns null when the native module is unavailable or declines the frame, and
 * the caller is expected to fall back rather than treat that as an error.
 */
export function nativeStages(
  src: Uint8Array,
  layout: FrameLayout,
  workWidth: number,
  sampleStep: number,
  minSizeFrac: number,
  k: number,
): NativeStages | null {
  if (!native) return null;

  if (!gray) {
    gray = new Float32Array(MAX_GRID);
    meta = new Int32Array(8);
    comps = new Int32Array(MAX_COMP_INTS);
    params = new Int32Array(11);
  }

  // The grid size has to be known before the call, to size minSize the same way
  // the TypeScript does - `Math.floor(w * h * 0.004)`.
  const cell = Math.max(
    sampleStep,
    Math.round(layout.width / workWidth / sampleStep) * sampleStep,
  );
  const gW = Math.floor(layout.width / cell);
  const gH = Math.floor(layout.height / cell);
  if (gW * gH > MAX_GRID) return null;

  const p = params!;
  p[0] = layout.width;
  p[1] = layout.height;
  p[2] = layout.bytesPerRow;
  p[3] = layout.bytesPerPixel;
  p[4] = layout.rOff;
  p[5] = layout.gOff;
  p[6] = layout.bOff;
  p[7] = workWidth;
  p[8] = sampleStep;
  p[9] = Math.floor(gW * gH * minSizeFrac);
  p[10] = Math.round(k * 1000);

  const code = native.run(src, p, gray, meta!, comps!);
  if (code !== 0) return null;

  const m = meta!;
  const outW = m[0];
  const outH = m[1];
  const scale = m[2];
  const count = m[3];

  const components: NativeStages['components'] = [];
  let at = 0;
  for (let c = 0; c < count; c++) {
    const size = comps![at++];
    const n = comps![at++];
    const boundary = new Array<{ x: number; y: number }>(n);
    for (let i = 0; i < n; i++) {
      boundary[i] = { x: comps![at++], y: comps![at++] };
    }
    components.push({ size, boundary });
  }

  return {
    // A view, not a copy: the detector reads it and is done before the next
    // frame overwrites it.
    grid: { gray: gray.subarray(0, outW * outH), w: outW, h: outH, scale },
    components,
  };
}

/**
 * The index lookups, native.
 *
 * Returns null when there is nothing to accelerate with, and the caller leaves
 * `CardIndex` on its own TypeScript path. Scratch buffers are module-level and
 * reused: a search runs several times a frame, and allocating on each would
 * hand back in garbage collection what the C++ saves in arithmetic.
 */
const out4 = new Int32Array(4);
const topPairs = new Int32Array(32);

export function nativeIndex(indexBytes: Uint8Array): IndexAccelerator | null {
  if (!native) return null;
  const rows = native.loadIndex(indexBytes);
  if (rows <= 0) {
    console.log(`[BulkSift] native index refused the file (code ${rows})`);
    return null;
  }
  return {
    search(query) {
      if (!native!.search(query, out4)) return null;
      if (out4[0] < 0) return null;
      return {
        best: { index: out4[0], distance: out4[1] },
        runnerUp: out4[2] >= 0 ? { index: out4[2], distance: out4[3] } : null,
      };
    },
    topK(query, k) {
      const n = native!.topK(query, Math.min(k, topPairs.length >> 1), topPairs);
      if (n <= 0) return null;
      const out = new Array<{ index: number; distance: number }>(n);
      for (let i = 0; i < n; i++) {
        out[i] = { index: topPairs[i * 2], distance: topPairs[i * 2 + 1] };
      }
      return out;
    },
    stripDistance(row, strip) {
      return native!.stripDistance(row, strip);
    },
  };
}

/*
 * Rectify-and-describe, native.
 *
 * Buffers are module-level and reused. A card is described up to four times a
 * frame - three crop calibrations and possibly a flip - so allocating per call
 * would hand back in garbage collection what the C++ saves in arithmetic.
 */
const quadBuf = new Float64Array(8);
const descBuf = new Uint8Array(96);
const stripBuf = new Uint8Array(15);
const descParams = new Int32Array(11);

export function nativeDescriber(
  src: Uint8Array,
  layout: FrameLayout,
): ((quad: Array<{ x: number; y: number }>, flipped: boolean) =>
    { desc: Uint8Array; strip: Uint8Array } | null) | null {
  if (!native) return null;
  descParams[0] = layout.width;
  descParams[1] = layout.height;
  descParams[2] = layout.bytesPerRow;
  descParams[3] = layout.bytesPerPixel;
  descParams[4] = layout.rOff;
  descParams[5] = layout.gOff;
  descParams[6] = layout.bOff;

  return (quad, flipped) => {
    for (let i = 0; i < 4; i++) {
      quadBuf[i * 2] = quad[i].x;
      quadBuf[i * 2 + 1] = quad[i].y;
    }
    const code = native!.describe(src, descParams, quadBuf, flipped, descBuf, stripBuf);
    if (code !== 0) return null;
    // Copied, because the caller keeps the descriptor across frames - the
    // sharpest read of a streak is held until the card is confirmed.
    return { desc: descBuf.slice(), strip: stripBuf.slice() };
  };
}
