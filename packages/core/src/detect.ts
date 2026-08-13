/**
 * Card detection and rectification, in plain TypeScript.
 *
 * No OpenCV: the web build would need a ~9 MB WASM payload and React Native
 * would need a native module, which is a lot of weight for what is ultimately
 * "find the big quadrilateral". The pipeline below runs on a downscaled copy of
 * the frame, so per-frame cost stays in single-digit milliseconds.
 *
 * gradient magnitude -> threshold -> dilate -> connected components ->
 * convex hull -> reduce hull to 4 corners -> validate shape -> homography
 */

export interface Point {
  x: number;
  y: number;
}

/** Corners ordered top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/**
 * A pre-built working image, when the caller already walked the frame.
 *
 * The camera path packs the frame from its native layout before the detector
 * ever sees it, and that pass touches exactly the pixels this grid is made of.
 * Letting it hand the grid over turns two passes over the frame into one.
 */
export interface WorkImage {
  gray: Float32Array;
  w: number;
  h: number;
  /** How many packed pixels each grid cell spans, i.e. the coordinate scale. */
  scale: number;
}

export interface DetectOptions {
  /** Width the detector works at. Smaller is faster, 320 is plenty. */
  workWidth?: number;
  /** Skip the downscale and use this grid instead. */
  work?: WorkImage;
  /**
   * Skip gradient, threshold and component labelling too, because a native
   * core already did them.
   *
   * The TypeScript stays the reference implementation and still runs whenever
   * this is absent - on the web, in the test suite, and on any build where the
   * native module did not link. `packages/core/native/check-parity.mjs` is what
   * makes trusting these safe: it compares both implementations over 100 real
   * frames and demands every boundary point match.
   */
  blobs?: Component[];
  /**
   * A sharper image to measure the card's edges against, and how much bigger
   * it is than the frame passed in. The app subsamples the camera's 1920x1080
   * to 960x540 for speed; pointing refinement back at the original costs
   * nothing extra per sample and is where the accuracy is.
   */
  refineSource?: LumaSource & { scale: number };
  /** Minimum share of the frame the card must cover. */
  minAreaFrac?: number;
  /** Maximum share, guards against detecting the whole frame border. */
  maxAreaFrac?: number;
  /**
   * Pixels (at working scale) to pull each corner inward.
   *
   * The quad comes from the convex hull of a *thresholded and dilated* gradient
   * blob, so it sits slightly outside the card: Sobel spreads the edge over a
   * pixel and the dilation adds another. Left uncorrected the rectified card
   * carries a rim of background, which shifts every grid cell and roughly
   * doubled the Hamming distance of correct matches in testing.
   */
  insetPx?: number;
  /**
   * Bytes per pixel in the source buffer: 4 for RGBA (canvas), 3 for RGB.
   *
   * Phone cameras hand over tightly packed RGB. Converting a 1280x720 frame to
   * RGBA just to read it would copy ~3.7 MB per frame for nothing, so the
   * readers take a stride instead. Everything downstream of rectify() is still
   * RGBA, which keeps the descriptor bit-identical to the Python reference.
   */
  channels?: 3 | 4;
  /**
   * Refine the quad against the full-resolution image after finding it on the
   * downscaled copy. Measured against ground-truth quads this is what actually
   * limits match quality, so it is on by default; turn it off only to compare.
   */
  refine?: boolean;
}

export interface Detection {
  quad: Quad;
  /** 0..1, how card-shaped the winning quad is. */
  score: number;
  areaFrac: number;
  /**
   * A 6x6 grid of block brightnesses over the detected card, taken from the
   * downscaled image the detector already built. Far too coarse to identify
   * anything - its job is only to answer "is this the same card as last
   * frame?" cheaply enough to skip recognising it again.
   */
  signature: Float32Array;
}

/** Block brightnesses over `quad`'s bounding box in the work image. */
function regionSignature(gray: Float32Array, w: number, h: number, quad: Quad): Float32Array {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of quad) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(w, Math.ceil(x1));
  y1 = Math.min(h, Math.ceil(y1));

  const G = 6;
  const sig = new Float32Array(G * G);
  const bw = (x1 - x0) / G;
  const bh = (y1 - y0) / G;
  if (bw < 1 || bh < 1) return sig;

  for (let by = 0; by < G; by++) {
    const ys = y0 + Math.floor(by * bh);
    const ye = y0 + Math.floor((by + 1) * bh);
    for (let bx = 0; bx < G; bx++) {
      const xs = x0 + Math.floor(bx * bw);
      const xe = x0 + Math.floor((bx + 1) * bw);
      let sum = 0;
      let n = 0;
      for (let y = ys; y < ye; y++) {
        const row = y * w;
        for (let x = xs; x < xe; x++, n++) sum += gray[row + x];
      }
      sig[by * G + bx] = n ? sum / n : 0;
    }
  }
  return sig;
}

/**
 * Do two detections show the same card?
 *
 * Deliberately not "in the same place". The first version required the corners
 * to have barely moved, and on a phone held over a spread of cards it fired on
 * 0% of frames - the whole point of the workflow is that cards move past the
 * lens. What identifies a card is how it looks, so the test is the signature,
 * plus a size check to catch one card being replaced by another at a different
 * distance. Position is ignored entirely.
 *
 * The signature is 36 block brightnesses over the card itself, so it travels
 * with the card. Two different illustrations disagree in several blocks by far
 * more than `level`; the same card sliding across the frame stays inside it.
 */
export function sameView(a: Detection, b: Detection, sizeTol: number, level: number): boolean {
  const areaA = Math.abs(polygonArea(a.quad));
  const areaB = Math.abs(polygonArea(b.quad));
  if (areaA <= 0 || areaB <= 0) return false;
  const ratio = areaA > areaB ? areaA / areaB : areaB / areaA;
  if (ratio > 1 + sizeTol) return false;

  const n = Math.min(a.signature.length, b.signature.length);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) {
    if (Math.abs(a.signature[i] - b.signature[i]) > level) return false;
  }
  return true;
}

const CARD_ASPECT = 2.5 / 3.5; // 0.714, a standard TCG card

/** Diagnostics for the test suite; not used by the app. */
export const detectStats = {
  refineOk: 0,
  refineShortEdge: 0,
  refineFewPoints: 0,
  refineAngle: 0,
  refineCorner: 0,
  reset() {
    this.refineOk = 0;
    this.refineShortEdge = 0;
    this.refineFewPoints = 0;
    this.refineAngle = 0;
    this.refineCorner = 0;
  },
};

/** Box-average downscale to the requested width, preserving aspect. */
function downscale(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  targetW: number,
  ch: number,
): { gray: Float32Array; w: number; h: number; scale: number } {
  const step = Math.max(1, Math.floor(w / targetW));
  const ow = Math.floor(w / step);
  const oh = Math.floor(h / step);
  const gray = new Float32Array(ow * oh);
  const inv = 1 / (step * step);
  // Integer luma: (77 R + 150 G + 29 B) / 256, the usual 8-bit approximation of
  // the 0.299/0.587/0.114 weights. This loop touches every pixel of the frame
  // and is the single most expensive thing the scanner does, so it is written
  // to stay inside 32-bit integer arithmetic - on an interpreter with no JIT
  // that is worth considerably more than the fractional accuracy it gives up.
  // Measured against ground-truth quads it costs nothing: corner error stays at
  // 1.5 px median.
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let sum = 0;
      for (let dy = 0; dy < step; dy++) {
        let p = ((y * step + dy) * w + x * step) * ch;
        for (let dx = 0; dx < step; dx++, p += ch) {
          sum += (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
        }
      }
      gray[y * ow + x] = sum * inv;
    }
  }
  return { gray, w: ow, h: oh, scale: step };
}

function sobelMagnitude(gray: Float32Array, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
      const l = gray[i - 1], r = gray[i + 1];
      const bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
      const gx = tr + 2 * r + br - tl - 2 * l - bl;
      const gy = bl + 2 * b + br - tl - 2 * t - tr;
      mag[i] = Math.abs(gx) + Math.abs(gy);
    }
  }
  return mag;
}

/** Threshold at mean + k*sd, then dilate by one 3x3 step to close gaps. */
function binarize(mag: Float32Array, w: number, h: number, k = 1.1): Uint8Array {
  let sum = 0;
  for (let i = 0; i < mag.length; i++) sum += mag[i];
  const mean = sum / mag.length;
  let varSum = 0;
  for (let i = 0; i < mag.length; i++) {
    const d = mag[i] - mean;
    varSum += d * d;
  }
  const sd = Math.sqrt(varSum / mag.length);
  const thr = mean + k * sd;

  const bin = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) bin[i] = mag[i] > thr ? 1 : 0;

  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (
        bin[i] || bin[i - 1] || bin[i + 1] || bin[i - w] || bin[i + w] ||
        bin[i - w - 1] || bin[i - w + 1] || bin[i + w - 1] || bin[i + w + 1]
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

export interface Component {
  size: number;
  /** Leftmost and rightmost pixel of each occupied row. */
  boundary: Point[];
}

/**
 * Label connected components, keeping only each one's per-row extremes.
 *
 * The convex hull is the only thing downstream, and a hull is determined
 * entirely by the leftmost and rightmost pixel of each row - every interior
 * pixel is inside it by definition. Materialising all of them cost thousands of
 * object allocations and a comparator sort over them; this keeps ~2 points per
 * row instead, so a card outline arrives as ~350 points rather than ~3000.
 */
function components(bin: Uint8Array, w: number, h: number, minSize: number): Component[] {
  const seen = new Uint8Array(w * h);
  const found: Component[] = [];
  const stack = new Int32Array(w * h);
  const minX = new Int32Array(h);
  const maxX = new Int32Array(h);
  // Which component last wrote each row, so "first pixel on this row" is a
  // real test rather than a sentinel value that breaks when x is legitimately 0.
  const rowMark = new Int32Array(h).fill(-1);
  let compId = -1;

  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || seen[start]) continue;
    compId++;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let size = 0;
    let y0 = h;
    let y1 = -1;

    while (sp > 0) {
      const i = stack[--sp];
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (rowMark[y] !== compId) {
        rowMark[y] = compId;
        minX[y] = x;
        maxX[y] = x;
      } else {
        if (x < minX[y]) minX[y] = x;
        if (x > maxX[y]) maxX[y] = x;
      }

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (bin[j] && !seen[j]) {
            seen[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }

    if (size >= minSize && y1 >= y0) {
      const boundary: Point[] = [];
      for (let y = y0; y <= y1; y++) {
        if (rowMark[y] !== compId) continue;
        boundary.push({ x: minX[y], y });
        if (maxX[y] !== minX[y]) boundary.push({ x: maxX[y], y });
      }
      found.push({ size, boundary });
    }
  }
  return found;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain. */
function convexHull(pts: Point[]): Point[] {
  if (pts.length < 3) return pts;
  const p = pts.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) {
      lower.pop();
    }
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) {
      upper.pop();
    }
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function polygonArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a) / 2;
}

/**
 * Reduce a convex hull to 4 corners by repeatedly dropping the vertex whose
 * removal costs the least area. Robust to the ragged hulls that come out of a
 * thresholded gradient, where approxPolyDP-style epsilon tuning is brittle.
 */
function hullToQuad(hull: Point[]): Quad | null {
  if (hull.length < 4) return null;
  let poly = hull.slice();
  while (poly.length > 4) {
    let bestIdx = -1;
    let bestLoss = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const next = poly[(i + 1) % poly.length];
      const loss = Math.abs(cross(prev, poly[i], next)) / 2;
      if (loss < bestLoss) {
        bestLoss = loss;
        bestIdx = i;
      }
    }
    poly.splice(bestIdx, 1);
  }
  return orderQuad(poly as Point[]);
}

/** Order 4 points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts: Point[]): Quad {
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const sorted = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // rotate so the point closest to the top-left of the bounding box comes first
  let start = 0;
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    const d = sorted[i].x + sorted[i].y;
    if (d < best) {
      best = d;
      start = i;
    }
  }
  return [
    sorted[start],
    sorted[(start + 1) % 4],
    sorted[(start + 2) % 4],
    sorted[(start + 3) % 4],
  ];
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Refine a quad by fitting a line to each of its four edges and intersecting
 * adjacent lines.
 *
 * Taking hull vertices as corners is systematically wrong for a card: the
 * corners are rounded, so the hull follows the arc and the resulting quad edges
 * are chords of the true edges rather than tangents - every side bows inward.
 * Fitting the straight middle portion of each side and extrapolating to the
 * intersection recovers the real corner, including the part cut off by the
 * radius.
 */
function refineQuadByEdges(hull: Point[], quad: Quad): Quad | null {
  const lines: Array<{ p: Point; d: Point }> = [];

  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 12) return null;
    const ux = ex / len;
    const uy = ey / len;

    // Points on the straight run of this side: near it, and away from both
    // corners so the rounding does not drag the fit.
    const band = Math.max(2.5, len * 0.04);
    const pts: Point[] = [];
    for (const p of hull) {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
      if (t < 0.18 || t > 0.82) continue;
      const perp = Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
      if (perp <= band) pts.push(p);
    }
    if (pts.length < 2) {
      lines.push({ p: a, d: { x: ux, y: uy } });
      continue;
    }

    // Total least squares: principal direction of the point cloud.
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.x;
      my += p.y;
    }
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const p of pts) {
      const dx = p.x - mx;
      const dy = p.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    lines.push({ p: { x: mx, y: my }, d: { x: Math.cos(theta), y: Math.sin(theta) } });
  }

  const corners: Point[] = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4]; // edge arriving at corner i
    const l2 = lines[i];           // edge leaving corner i
    const denom = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(denom) < 1e-6) return null;
    const t =
      ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / denom;
    const c = { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
    // a refined corner far from the original is a sign the fit went wrong
    if (Math.hypot(c.x - quad[i].x, c.y - quad[i].y) > Math.hypot(
      quad[2].x - quad[0].x, quad[2].y - quad[0].y) * 0.2) {
      return null;
    }
    corners.push(c);
  }
  return corners as Quad;
}

/**
 * Snap the quad onto the card's real edges, at full resolution and sub-pixel.
 *
 * The coarse quad comes off a downscaled, thresholded, dilated gradient blob.
 * At 320 px working width on a 1280 px frame one working pixel is four source
 * pixels, so the corners land ~9 px out - and localisation, not matching, is
 * what caps accuracy: feeding the ground-truth quad into the same pipeline drops
 * the median Hamming distance from 115 to 28.
 *
 * So each edge is re-measured where the evidence actually is. Along the edge,
 * scanlines are cast perpendicular into the full-resolution luma; the strongest
 * gradient on each scanline is the card boundary, refined to sub-pixel with a
 * parabola through its neighbours. A robust line is fitted through those points
 * (outliers dropped, since glare and background clutter produce false peaks),
 * and adjacent lines are intersected to give corners - which also recovers the
 * true corner behind the card's rounded radius.
 */
/**
 * Somewhere to read brightness from, without caring how it is stored.
 *
 * Edge refinement is the only stage whose accuracy depends on the resolution
 * of the pixels it reads rather than on how many it reads, so it is worth
 * pointing at the sharpest image available - which on a phone is the camera's
 * own buffer, in whatever interleaved layout it arrived in.
 */
export interface LumaSource {
  width: number;
  height: number;
  lum(x: number, y: number): number;
}

/** A LumaSource over a tightly packed RGB or RGBA buffer. */
export function lumaOf(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  ch: number,
): LumaSource {
  return {
    width,
    height,
    lum(x: number, y: number): number {
      const xi = x < 0 ? 0 : x > width - 1 ? width - 1 : x | 0;
      const yi = y < 0 ? 0 : y > height - 1 ? height - 1 : y | 0;
      const p = (yi * width + xi) * ch;
      return 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
    },
  };
}

export function refineEdgesSubpixel(source: LumaSource, quad: Quad): Quad | null {
  const { width, height } = source;
  const lum = source.lum.bind(source);

  const SAMPLES = 40;
  // Wide enough that the true edge is never at the window boundary: scanlines
  // whose peak lands on the edge of the search window get discarded, and if
  // that happens preferentially on the side needing the biggest correction the
  // surviving points drag the fitted line back toward the coarse guess.
  const RADIUS = 16;
  const lines: Array<{ px: number; py: number; dx: number; dy: number }> = [];

  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 24) { detectStats.refineShortEdge++; return null; }
    const ux = ex / len;
    const uy = ey / len;
    const nx = -uy;
    const ny = ux;

    const pts: Array<{ x: number; y: number; w: number }> = [];
    for (let s = 0; s < SAMPLES; s++) {
      const t = 0.10 + (0.80 * s) / (SAMPLES - 1);
      const bx = a.x + ex * t;
      const by = a.y + ey * t;

      let bestMag = 0;
      let bestK = 0;
      const mags: number[] = new Array(2 * RADIUS + 1);
      for (let k = -RADIUS; k <= RADIUS; k++) {
        const px = bx + nx * k;
        const py = by + ny * k;
        // derivative along the normal, central difference
        const m = Math.abs(lum(px + nx, py + ny) - lum(px - nx, py - ny));
        mags[k + RADIUS] = m;
        if (m > bestMag) {
          bestMag = m;
          bestK = k;
        }
      }
      if (bestMag < 8) continue; // no real edge on this scanline
      if (bestK === -RADIUS || bestK === RADIUS) continue; // ran off the window

      // parabola through the peak and its neighbours for sub-pixel position
      const y0 = mags[bestK + RADIUS - 1];
      const y1 = mags[bestK + RADIUS];
      const y2 = mags[bestK + RADIUS + 1];
      const denom = y0 - 2 * y1 + y2;
      const shift = Math.abs(denom) > 1e-6 ? (0.5 * (y0 - y2)) / denom : 0;
      const k = bestK + Math.max(-1, Math.min(1, shift));
      pts.push({ x: bx + nx * k, y: by + ny * k, w: bestMag });
    }

    if (pts.length < 8) { detectStats.refineFewPoints++; return null; }

    // Robust total-least-squares: fit, drop the worst 25%, fit again.
    let use = pts;
    let fit = { px: 0, py: 0, dx: ux, dy: uy };
    for (let pass = 0; pass < 2; pass++) {
      let sw = 0;
      let mx = 0;
      let my = 0;
      for (const p of use) {
        sw += p.w;
        mx += p.x * p.w;
        my += p.y * p.w;
      }
      if (sw <= 0) return null;
      mx /= sw;
      my /= sw;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (const p of use) {
        const dx = p.x - mx;
        const dy = p.y - my;
        sxx += p.w * dx * dx;
        syy += p.w * dy * dy;
        sxy += p.w * dx * dy;
      }
      const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      fit = { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
      if (pass === 0) {
        const scored = pts
          .map((p) => ({
            p,
            r: Math.abs((p.x - fit.px) * -fit.dy + (p.y - fit.py) * fit.dx),
          }))
          .sort((l, r) => l.r - r.r);
        use = scored.slice(0, Math.max(8, Math.floor(scored.length * 0.75))).map((s) => s.p);
      }
    }
    // a fitted edge that swung away from the coarse one means the scanlines
    // locked onto something else - glare, a sleeve, the table edge
    if (Math.abs(fit.dx * ux + fit.dy * uy) < 0.985) { detectStats.refineAngle++; return null; }
    lines.push(fit);
  }

  const out: Point[] = [];
  const diag = Math.hypot(quad[2].x - quad[0].x, quad[2].y - quad[0].y);
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4];
    const l2 = lines[i];
    const denom = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(denom) < 1e-6) return null;
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / denom;
    const c = { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t };
    if (Math.hypot(c.x - quad[i].x, c.y - quad[i].y) > diag * 0.08) { detectStats.refineCorner++; return null; }
    out.push(c);
  }
  detectStats.refineOk++;
  return out as Quad;
}

/** Pull every corner `px` pixels toward the quad's centroid. */
function insetQuad(q: Quad, px: number): Quad {
  if (px <= 0) return q;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => {
    const dx = cx - p.x;
    const dy = cy - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(px / len, 0.25);
    return { x: p.x + dx * t, y: p.y + dy * t };
  }) as Quad;
}

/**
 * Put a sideways card upright.
 *
 * Phone cameras deliver frames in the sensor's native landscape orientation no
 * matter how the device is held - the preview is rotated for display, the pixel
 * buffer is not. So a card held normally arrives lying on its side, with an
 * aspect of 1.4 instead of 0.714. Rotating the corner order by one makes the
 * card's short edge the top again; the descriptor search already tries the
 * 180-degree flip, so between them all four orientations are covered.
 */
function orientToPortrait(q: Quad): Quad {
  const top = dist(q[0], q[1]);
  const right = dist(q[1], q[2]);
  if (top > right) return [q[1], q[2], q[3], q[0]];
  return q;
}

/** How card-shaped is this quad? 1 is perfect, 0 is unusable. */
function shapeScore(q: Quad): number {
  const top = dist(q[0], q[1]);
  const right = dist(q[1], q[2]);
  const bottom = dist(q[2], q[3]);
  const left = dist(q[3], q[0]);
  if (top < 8 || right < 8 || bottom < 8 || left < 8) return 0;

  // opposite sides should roughly agree (perspective allows some difference)
  const wRatio = Math.min(top, bottom) / Math.max(top, bottom);
  const hRatio = Math.min(left, right) / Math.max(left, right);

  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  // Accept the card either way up: the frame may be landscape while the card
  // is held portrait, so 0.714 and its reciprocal are both card-shaped.
  const aspect = w / h;
  const err = Math.min(
    Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT,
    Math.abs(aspect - 1 / CARD_ASPECT) / (1 / CARD_ASPECT),
  );
  const aspectScore = Math.max(0, 1 - err * 1.6);

  // the quad should fill its own convex hull, i.e. be genuinely convex
  const area = polygonArea(q);
  const hullArea = polygonArea(convexHull(q.slice()));
  const convexity = hullArea > 0 ? Math.min(1, area / hullArea) : 0;

  return aspectScore * 0.55 + wRatio * 0.15 + hRatio * 0.15 + convexity * 0.15;
}

export function detectCard(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  opts: DetectOptions = {},
): Detection | null {
  const workWidth = opts.workWidth ?? 320;
  const minAreaFrac = opts.minAreaFrac ?? 0.05;
  const maxAreaFrac = opts.maxAreaFrac ?? 0.95;
  const insetPx = opts.insetPx ?? 2;
  const channels = opts.channels ?? 4;

  const { gray, w, h, scale } = opts.work
    ? { gray: opts.work.gray, w: opts.work.w, h: opts.work.h, scale: opts.work.scale }
    : downscale(rgba, width, height, workWidth, channels);
  const frameArea = w * h;
  const comps = opts.blobs ?? (() => {
    const mag = sobelMagnitude(gray, w, h);
    const bin = binarize(mag, w, h);
    return components(bin, w, h, Math.floor(frameArea * 0.004));
  })();
  if (!comps.length) return null;

  comps.sort((a, b) => b.size - a.size);

  let best: Detection | null = null;
  for (const comp of comps.slice(0, 5)) {
    const hull = convexHull(comp.boundary);
    const coarse = hullToQuad(hull);
    if (!coarse) continue;
    const quad = refineQuadByEdges(hull, coarse) ?? coarse;

    const areaFrac = polygonArea(quad) / frameArea;
    if (areaFrac < minAreaFrac || areaFrac > maxAreaFrac) continue;

    const score = shapeScore(quad);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      const full = quad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad;
      // Refinement measures the edge itself, so it starts from the un-inset
      // quad and searches both ways. The inset only exists to bias the coarse
      // fallback, which sits outside the card by construction.
      // Refine against the sharpest image on offer. The camera's own frame is
      // typically twice the size of the copy everything else works on, and
      // corner precision is what limits match quality: measured on half-size
      // frames, refining against the original took the distance of a correct
      // read from 120 bits to 94, where sampling the original for the
      // descriptor itself was worth 1.
      const sharp = opts.refineSource;
      let refined: Quad | null = null;
      if (opts.refine ?? true) {
        if (sharp) {
          const k = sharp.scale;
          const lifted = full.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
          const got = refineEdgesSubpixel(sharp, lifted);
          refined = got
            ? (got.map((p) => ({ x: p.x / k, y: p.y / k })) as Quad)
            : null;
        } else {
          refined = refineEdgesSubpixel(lumaOf(rgba, width, height, channels), full);
        }
      }
      // Whatever we settled on, hand it back with the card standing up.
      best = {
        quad: orientToPortrait(
          refined ?? (insetQuad(quad, insetPx).map((p) => ({
            x: p.x * scale,
            y: p.y * scale,
          })) as Quad),
        ),
        score,
        areaFrac,
        signature: regionSignature(gray, w, h, quad),
      };
    }
  }
  return best;
}

/** Solve the homography mapping the 4 destination corners back to the source. */
function homographyToSource(quad: Quad, outW: number, outH: number): Float64Array {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  // Solve for H mapping dst -> src, so each output pixel samples the source.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = dst[i];
    const { x, y } = quad[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
    b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
    b.push(y);
  }
  // Gaussian elimination with partial pivoting on the 8x8 system.
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const hh = new Float64Array(9);
  for (let i = 0; i < 8; i++) hh[i] = b[i] / A[i][i];
  hh[8] = 1;
  return hh;
}

/** Warp the quad out of the frame into an outW x outH RGBA buffer, bilinear. */
/**
 * An interleaved pixel buffer, however it is laid out.
 *
 * Rectification samples a fixed 240x336 grid through a homography, so its cost
 * is its output size and it does not care how big or how oddly arranged the
 * source is. Letting it read the camera's own buffer removes the only reason
 * the frame was being copied into a tidy RGB image at all - a 1.5 MB write per
 * frame that a reused frame never looked at.
 */
export interface PixelSource {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  bytesPerRow: number;
  bytesPerPixel: number;
  rOff: number;
  gOff: number;
  bOff: number;
}

/** A PixelSource over a tightly packed RGB or RGBA buffer. */
export function sourceOf(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: 3 | 4 = 4,
): PixelSource {
  return {
    data, width, height,
    bytesPerRow: width * channels,
    bytesPerPixel: channels,
    rOff: 0, gOff: 1, bOff: 2,
  };
}

export function rectify(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  quad: Quad,
  outW: number,
  outH: number,
  channels: 3 | 4 = 4,
): Uint8ClampedArray {
  return rectifyFrom(sourceOf(rgba, width, height, channels), quad, outW, outH);
}

export function rectifyFrom(
  src: PixelSource,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const { data: rgba, width, height, bytesPerRow, bytesPerPixel, rOff, gOff, bOff } = src;
  const H = homographyToSource(quad, outW, outH);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const maxX = width - 1;
  const maxY = height - 1;
  let o = 0;
  for (let y = 0; y < outH; y++) {
    // The homography is affine in x along a row, so the three numerators walk
    // forward by a constant instead of being recomputed. That removes six
    // multiplies from each of 80,640 output pixels; the perspective divide is
    // the only thing that genuinely has to happen per pixel.
    let nx = H[1] * y + H[2];
    let ny = H[4] * y + H[5];
    let nw = H[7] * y + H[8];
    for (let x = 0; x < outW; x++, o += 4, nx += H[0], ny += H[3], nw += H[6]) {
      const sx = nx / nw;
      const sy = ny / nw;
      if (sx < 0 || sy < 0 || sx > maxX || sy > maxY) {
        out[o] = out[o + 1] = out[o + 2] = 0;
        out[o + 3] = 255;
        continue;
      }
      const x0 = sx | 0;
      const y0 = sy | 0;
      const x1 = x0 < maxX ? x0 + 1 : maxX;
      const y1 = y0 < maxY ? y0 + 1 : maxY;
      const fx = sx - x0;
      const fy = sy - y0;
      const gx = 1 - fx;
      const row0 = y0 * bytesPerRow;
      const row1 = y1 * bytesPerRow;
      const c0 = x0 * bytesPerPixel;
      const c1 = x1 * bytesPerPixel;
      const i00 = row0 + c0;
      const i10 = row0 + c1;
      const i01 = row1 + c0;
      const i11 = row1 + c1;
      const w00 = gx * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = gx * fy;
      const w11 = fx * fy;
      out[o] =
        rgba[i00 + rOff] * w00 + rgba[i10 + rOff] * w10 +
        rgba[i01 + rOff] * w01 + rgba[i11 + rOff] * w11;
      out[o + 1] =
        rgba[i00 + gOff] * w00 + rgba[i10 + gOff] * w10 +
        rgba[i01 + gOff] * w01 + rgba[i11 + gOff] * w11;
      out[o + 2] =
        rgba[i00 + bOff] * w00 + rgba[i10 + bOff] * w10 +
        rgba[i01 + bOff] * w01 + rgba[i11 + bOff] * w11;
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Grow or shrink a quad about its own centre.
 *
 * The detector finds the physical edge of the card; the reference images were
 * cropped by whoever scanned them, and the two conventions need not agree to
 * the pixel. A systematic few percent costs real accuracy - 3% measured at +50
 * bits on top of a 73-bit baseline - so the scanner calibrates it away rather
 * than assuming the edge is the right place to cut.
 */
export function scaleQuad(q: Quad, frac: number): Quad {
  if (frac === 0) return q;
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return [0, 1, 2, 3].map((i) => ({
    x: cx + (q[i].x - cx) * (1 + frac),
    y: cy + (q[i].y - cy) * (1 + frac),
  })) as Quad;
}

/** Rotate a rectified RGBA buffer 180 degrees, for upside-down cards. */
export function rotate180(buf: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.length);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const d = (n - 1 - i) * 4;
    out[d] = buf[s];
    out[d + 1] = buf[s + 1];
    out[d + 2] = buf[s + 2];
    out[d + 3] = buf[s + 3];
  }
  return out;
}

/**
 * The per-pixel stages, exposed so the C++ port can be compared against them.
 *
 * Not part of the app's path. It exists because a native rewrite of a hot loop
 * is only safe if it can be shown to produce the same answer, and "shown" here
 * means every grid cell and every component boundary point, on real frames -
 * not a spot check. See `packages/core/native/`.
 */
export function __stagesForParity(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4,
  workWidth: number,
  sampleStep: number,
) {
  const bpp = channels;
  const stride = width * bpp;
  const cell = Math.max(sampleStep, Math.round(width / workWidth / sampleStep) * sampleStep);
  const gW = Math.floor(width / cell);
  const gH = Math.floor(height / cell);
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
          sum += (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
        }
      }
      gray[cy * gW + cx] = sum * inv;
    }
  }

  const mag = sobelMagnitude(gray, gW, gH);
  const bin = binarize(mag, gW, gH);
  const comps = components(bin, gW, gH, Math.floor(gW * gH * 0.004));
  return { grid: { gray, w: gW, h: gH, scale: cell }, components: comps };
}
