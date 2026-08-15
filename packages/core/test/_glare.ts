/**
 * Can several frames of a shiny card be combined into one clean read?
 *
 * The device says full arts are never recognised, holos rarely, and ordinary
 * matte cards fine. That is not a random failure - it is a property of the
 * card's surface, and the perturbation table measured at the start of this work
 * already named it: glare costs 210 bits, the largest single term, against 86
 * for triple blur and 82 for a warm white balance. The distances coming off the
 * device are 203 to 230.
 *
 * Glare masking was tried before and rejected, because masking throws away the
 * bits it covers and a mask big enough to help removed too much signal.
 *
 * This tries the other idea. A card under a lamp does not have glare in the
 * same place from one frame to the next - the hand moves, the card tilts, the
 * highlight slides across it. So the bits it corrupts are different each time,
 * while the bits it does not touch are the same. A majority vote over several
 * frames should recover the truth without discarding anything.
 *
 * The app already sees thirty frames a second of the same card. If this works,
 * it costs one accumulator and no index rebuild.
 *
 *   node --experimental-strip-types packages/core/test/_glare.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANON_H, CANON_W, describe } from '../src/descriptor.ts';
import { detectCard, rectifyFrom, sourceOf } from '../src/detect.ts';
import { CardIndex } from '../src/matcher.ts';
import { baseName } from '../src/scanner.ts';
import { loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');
const fixtures = join(here, 'fixtures');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
const NAMES = cards.map((c) => baseName(c.n));

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number; frames: Array<{ row: number; name: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const frameBytes = meta.width * meta.height * 4;

let seed = 424242;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/**
 * Lay a specular highlight over a canonical card.
 *
 * A soft elliptical band, blown out at the centre and falling off - which is
 * what a lamp on a holo actually looks like - placed somewhere different on
 * every frame, and rotated, because a hand does not hold a card still.
 */
function glare(
  img: Uint8ClampedArray, cx: number, cy: number, strength: number, angle: number,
): Uint8ClampedArray {
  const out = img.slice();
  const rx = CANON_W * 0.55;
  const ry = CANON_H * 0.13;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  for (let y = 0, o = 0; y < CANON_H; y++) {
    for (let x = 0; x < CANON_W; x++, o += 4) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (dx * ca + dy * sa) / rx;
      const v = (-dx * sa + dy * ca) / ry;
      const t = u * u + v * v;
      if (t >= 1) continue;
      const k = (1 - t) ** 2 * strength;
      out[o] = out[o] + (255 - out[o]) * k;
      out[o + 1] = out[o + 1] + (255 - out[o + 1]) * k;
      out[o + 2] = out[o + 2] + (255 - out[o + 2]) * k;
    }
  }
  return out;
}

/**
 * The rectified card out of a fixture frame - detect the quad, then unwarp it.
 *
 * Scaling the whole frame instead, which an earlier version of this did,
 * describes the table around the card and lands in the noise band the whole
 * experiment is trying to measure. It reads as a total failure at zero glare,
 * which is a useful tell that the harness rather than the idea is broken.
 */
function canonical(i: number): Uint8ClampedArray | null {
  const raw = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
  if (!det) return null;
  return rectifyFrom(
    sourceOf(raw, meta.width, meta.height, 4), det.quad, CANON_W, CANON_H,
  );
}

/** Per-bit majority over several descriptors. */
function vote(descs: Uint8Array[]): Uint8Array {
  const bits = index.bits;
  const out = new Uint8Array(descs[0].length);
  const half = descs.length / 2;
  for (let b = 0; b < bits; b++) {
    let ones = 0;
    for (const d of descs) ones += (d[b >> 3] >> (7 - (b & 7))) & 1;
    if (ones > half) out[b >> 3] |= 0x80 >> (b & 7);
  }
  return out;
}

function score(q: Uint8Array, want: number) {
  const top = index.topK(q, 16);
  const winner = NAMES[top[0].index];
  let margin = 9999;
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    margin = top[k].distance - top[0].distance;
    break;
  }
  return { best: top[0].distance, margin, ok: top[0].index === want };
}

const N = 40;
const FRAMES_PER_CARD = 7;

for (const strength of [0.0, 0.5, 0.75, 0.9]) {
  let d1 = 0, m1 = 0, ok1 = 0;
  let dv = 0, mv = 0, okv = 0;
  let n = 0;

  for (let i = 0; i < Math.min(N, meta.count); i++) {
    const base = canonical(i);
    if (!base) continue;
    const want = meta.frames[i].row;

    const descs: Uint8Array[] = [];
    for (let f = 0; f < FRAMES_PER_CARD; f++) {
      // The highlight lands somewhere different, at a different angle, on each
      // frame - which is what a hand holding a card under a lamp produces.
      const img = strength === 0 ? base : glare(
        base,
        CANON_W * (0.15 + rnd() * 0.7),
        CANON_H * (0.1 + rnd() * 0.8),
        strength,
        rnd() * Math.PI,
      );
      descs.push(describe(img));
    }

    const single = score(descs[0], want);
    d1 += single.best; m1 += Math.min(single.margin, 742); if (single.ok) ok1++;

    const voted = score(vote(descs), want);
    dv += voted.best; mv += Math.min(voted.margin, 742); if (voted.ok) okv++;
    n++;
  }

  console.log(
    `glare ${(strength * 100).toFixed(0).padStart(3)}%  ` +
    `one frame: d=${(d1 / n).toFixed(0).padStart(3)} m=${(m1 / n).toFixed(0).padStart(3)} ` +
    `${ok1}/${n} correct   |   ` +
    `${FRAMES_PER_CARD}-frame vote: d=${(dv / n).toFixed(0).padStart(3)} ` +
    `m=${(mv / n).toFixed(0).padStart(3)} ${okv}/${n} correct`,
  );
}
