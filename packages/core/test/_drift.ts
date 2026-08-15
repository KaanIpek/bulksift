/**
 * How far apart are two glared reads of the SAME card, against two different
 * cards?
 *
 * The voting ring needs a rule for "these frames are of one card". Brightness
 * was the wrong one - glare is a brightness change, so the test rejected
 * exactly the frames the vote exists to combine, and the ring never got past a
 * depth of one. Geometry alone is not enough either: two cards laid on the same
 * spot have the same quad.
 *
 * The descriptors themselves can answer it, if the two distributions are far
 * enough apart to put a threshold between them. This measures both.
 *
 *   node --experimental-strip-types packages/core/test/_drift.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe } from '../src/descriptor.ts';
import { detectCard, rectifyFrom, sourceOf } from '../src/detect.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

let seed = 5150;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

function glare(img: Uint8ClampedArray, strength: number): Uint8ClampedArray {
  const out = img.slice();
  const cx = CANON_W * (0.15 + rnd() * 0.7);
  const cy = CANON_H * (0.1 + rnd() * 0.8);
  const angle = rnd() * Math.PI;
  const rx = CANON_W * 0.55, ry = CANON_H * 0.13;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = 0, o = 0; y < CANON_H; y++) {
    for (let x = 0; x < CANON_W; x++, o += 4) {
      const dx = x - cx, dy = y - cy;
      const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
      const t = u * u + v * v;
      if (t >= 1) continue;
      const k = (1 - t) ** 2 * strength;
      out[o] += (255 - out[o]) * k;
      out[o + 1] += (255 - out[o + 1]) * k;
      out[o + 2] += (255 - out[o + 2]) * k;
    }
  }
  return out;
}

function canonical(i: number): Uint8ClampedArray | null {
  const raw = new Uint8ClampedArray(frames.buffer, frames.byteOffset + i * frameBytes, frameBytes);
  const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
  if (!det) return null;
  return rectifyFrom(sourceOf(raw, meta.width, meta.height, 4), det.quad, CANON_W, CANON_H);
}

const POP = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const bitsOf = (b: number) => {
  let n = 0;
  for (let i = 0; i < 8; i++) if (b & (1 << i)) n++;
  return n;
};
function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += bitsOf(a[i] ^ b[i]);
  return d;
}
void POP;

const N = 30;
const bases: Uint8ClampedArray[] = [];
for (let i = 0; i < N; i++) {
  const c = canonical(i);
  if (c) bases.push(c);
}

console.log('strength   same card (min/mean/max)   different cards (min/mean/max)');
for (const strength of [0.5, 0.75, 0.9]) {
  const same: number[] = [];
  const diff: number[] = [];
  const reads = bases.map((b) => [describe(glare(b, strength)), describe(glare(b, strength))]);
  for (const [a, b] of reads) same.push(hamming(a, b));
  for (let i = 0; i < reads.length; i++) {
    for (let j = i + 1; j < reads.length; j++) diff.push(hamming(reads[i][0], reads[j][0]));
  }
  const st = (xs: number[]) =>
    `${Math.min(...xs).toString().padStart(3)}/` +
    `${(xs.reduce((p, q) => p + q, 0) / xs.length).toFixed(0).padStart(3)}/` +
    `${Math.max(...xs).toString().padStart(3)}`;
  console.log(`   ${(strength * 100).toFixed(0)}%          ${st(same)}              ${st(diff)}`);
}
