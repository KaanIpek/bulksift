/**
 * What each failure mode does to the four section numbers.
 *
 * The app prints them; this says what they mean. Each perturbation below is
 * applied to frames that read correctly, so the only thing that changed is the
 * named defect.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe } from '../src/descriptor.ts';
import { detectCard, rectify, type Quad } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const frameBytes = meta.width * meta.height * 4;

/** Grow or shrink a quad about its centre by `frac`. */
function scaleQuad(q: Quad, frac: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  return q.map((p) => ({
    x: cx + (p.x - cx) * (1 + frac),
    y: cy + (p.y - cy) * (1 + frac),
  })) as Quad;
}

/** Rotate a quad about its centre, in degrees. */
function rotateQuad(q: Quad, deg: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return q.map((p) => ({
    x: cx + (p.x - cx) * c - (p.y - cy) * s,
    y: cy + (p.x - cx) * s + (p.y - cy) * c,
  })) as Quad;
}

function blur(buf: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  let src = buf;
  for (let pass = 0; pass < r; pass++) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              sum += src[(yy * w + xx) * 4 + c];
              n++;
            }
          }
          out[o + c] = sum / n;
        }
        out[o + 3] = 255;
      }
    }
    src = out;
  }
  return src;
}

/** A warm cast, as a phone under tungsten light produces. */
function warm(buf: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = Math.min(255, buf[i] * 1.18);
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i + 2] * 0.82;
    out[i + 3] = 255;
  }
  return out;
}

/** A bright diagonal band, as gloss reflects a ceiling light. */
function glare(buf: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = Uint8ClampedArray.from(buf);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const band = Math.exp(-((t - 0.45) ** 2) / 0.004) * 120;
      const o = (y * w + x) * 4;
      out[o] = Math.min(255, out[o] + band);
      out[o + 1] = Math.min(255, out[o + 1] + band);
      out[o + 2] = Math.min(255, out[o + 2] + band);
    }
  }
  return out;
}

type Case = {
  name: string;
  quad?: (q: Quad) => Quad;
  frame?: (b: Uint8ClampedArray, w: number, h: number) => Uint8ClampedArray;
};

/** Shrink the whole frame, so the card covers fewer pixels. */
function shrink(b: Uint8ClampedArray, w: number, h: number, f: number) {
  const ow = Math.round(w * f), oh = Math.round(h * f);
  const out = new Uint8ClampedArray(w * h * 4);
  // Downscale into the middle of a same-sized frame, so detection still has
  // margin around the card and only the card's pixel count changes.
  const ox = ((w - ow) / 2) | 0, oy = ((h - oh) / 2) | 0;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(w - 1, (x / f) | 0);
      const sy = Math.min(h - 1, (y / f) | 0);
      const si = (sy * w + sx) * 4;
      const di = ((y + oy) * w + (x + ox)) * 4;
      out[di] = b[si];
      out[di + 1] = b[si + 1];
      out[di + 2] = b[si + 2];
      out[di + 3] = 255;
    }
  }
  return out;
}

const CASES: Case[] = [
  { name: 'none (reference)' },
  { name: 'quad 3% too big', quad: (q) => scaleQuad(q, 0.03) },
  { name: 'quad 3% too small', quad: (q) => scaleQuad(q, -0.03) },
  { name: 'quad 6% too big', quad: (q) => scaleQuad(q, 0.06) },
  { name: 'quad rotated 2 deg', quad: (q) => rotateQuad(q, 2) },
  { name: 'blur (1 pass)', frame: (b, w, h) => blur(b, w, h, 1) },
  { name: 'blur (3 passes)', frame: (b, w, h) => blur(b, w, h, 3) },
  { name: 'warm white balance', frame: (b) => warm(b) },
  { name: 'glare band', frame: (b, w, h) => glare(b, w, h) },
  { name: 'card at 70% size', frame: (b, w, h) => shrink(b, w, h, 0.7) },
  { name: 'card at 50% size', frame: (b, w, h) => shrink(b, w, h, 0.5) },
  { name: 'card at 35% size', frame: (b, w, h) => shrink(b, w, h, 0.35) },
];

const N = 40;
console.log(`each case over ${N} frames that read correctly untouched\n`);
console.log(
  'case                  total   gridH  gridV    art  colour'.padEnd(60),
);

for (const c of CASES) {
  let total = 0, n = 0;
  const acc: Record<string, number> = { gridH: 0, gridV: 0, art: 0, colour: 0 };
  const of: Record<string, number> = { gridH: 240, gridV: 240, art: 154, colour: 108 };

  for (let i = 0; i < N; i++) {
    const raw = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    const truth = meta.frames[i].row;
    const buf = c.frame ? c.frame(raw, meta.width, meta.height) : raw;
    const det = detectCard(buf, meta.width, meta.height);
    if (!det) continue;
    const quad = c.quad ? c.quad(det.quad) : det.quad;
    const q = describe(rectify(buf, meta.width, meta.height, quad, CANON_W, CANON_H));
    const d = index.sections(q, truth);
    total += d.reduce((s, x) => s + x.d, 0);
    for (const x of d) acc[x.name] += x.d;
    n++;
  }
  if (!n) continue;
  const pct = (k: string) => `${Math.round((acc[k] / n / of[k]) * 100)}%`.padStart(6);
  console.log(
    `${c.name.padEnd(20)} ${String(Math.round(total / n)).padStart(5)}   ` +
    `${pct('gridH')} ${pct('gridV')} ${pct('art')} ${pct('colour')}`,
  );
}
