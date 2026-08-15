/**
 * Can a small search over the crop recover what a wrong quad costs?
 *
 * `_align.ts` measured the damage: corner error is the most expensive thing
 * that happens to a read - 5% of the card's width costs 99 bits of distance and
 * 65 of margin, against 36 and 24 for the heaviest glare. The scanner already
 * searches ONE degree of freedom, scale, every eighth frame. A corner that is
 * wrong in the other direction is untouched by that.
 *
 * This asks whether widening the search to translation pays for itself, and by
 * how much, so the extra milliseconds are bought with a number.
 *
 *   node --experimental-strip-types packages/core/test/_refine.ts
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

let seed = 777001;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

type Pt = { x: number; y: number };
type Quad = [Pt, Pt, Pt, Pt];

function score(q: Uint8Array, want: number) {
  const top = index.topK(q, 16);
  const winner = NAMES[top[0].index];
  let margin = 742;
  for (let k = 1; k < top.length; k++) {
    if (NAMES[top[k].index] === winner) continue;
    margin = top[k].distance - top[0].distance;
    break;
  }
  return { d: top[0].distance, margin, ok: top[0].index === want };
}

/** Nudge a quad: translate by (dx,dy) and scale about its centre. */
function nudge(quad: Quad, dx: number, dy: number, s: number): Quad {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  return quad.map((p) => ({
    x: cx + (p.x - cx) * (1 + s) + dx,
    y: cy + (p.y - cy) * (1 + s) + dy,
  })) as Quad;
}

const N = 40;
const ERROR = 0.03;   // the corner error being recovered from

console.log(`per-corner error ${(ERROR * 100).toFixed(0)}%, ${N} cards\n`);
console.log('search                     trials   distance   margin   correct');

const PLANS: Array<{ name: string; d: number[]; s: number[] }> = [
  { name: 'none (what ships today)', d: [0], s: [0] },
  { name: 'scale only, +/-2%', d: [0], s: [-0.02, 0, 0.02] },
  { name: 'translate only, +/-2%', d: [-0.02, 0, 0.02], s: [0] },
  { name: 'translate + scale, +/-2%', d: [-0.02, 0, 0.02], s: [-0.02, 0, 0.02] },
  { name: 'translate + scale, +/-3%', d: [-0.03, 0, 0.03], s: [-0.03, 0, 0.03] },
];

for (const plan of PLANS) {
  let dSum = 0, mSum = 0, ok = 0, n = 0, trials = 0;
  seed = 777001;   // the same perturbations for every plan

  for (let i = 0; i < Math.min(N, meta.count); i++) {
    const raw = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
    if (!det) continue;
    const src = sourceOf(raw, meta.width, meta.height, 4);
    const span = Math.hypot(det.quad[1].x - det.quad[0].x, det.quad[1].y - det.quad[0].y);
    const bad = det.quad.map((p) => ({
      x: p.x + (rnd() - 0.5) * 2 * ERROR * span,
      y: p.y + (rnd() - 0.5) * 2 * ERROR * span,
    })) as Quad;

    let best: Uint8Array | null = null;
    let bestD = Infinity;
    let count = 0;
    for (const dx of plan.d) {
      for (const dy of plan.d) {
        for (const s of plan.s) {
          const q = nudge(bad, dx * span, dy * span, s);
          const desc = describe(rectifyFrom(src, q, CANON_W, CANON_H));
          const d = index.search(desc).best.distance;
          count++;
          if (d < bestD) { bestD = d; best = desc; }
        }
      }
    }
    trials += count;
    const sc = score(best!, meta.frames[i].row);
    dSum += sc.d; mSum += Math.min(sc.margin, 742); if (sc.ok) ok++;
    n++;
  }

  console.log(
    `${plan.name.padEnd(26)} ${String(Math.round(trials / n)).padStart(5)}   ` +
    `${(dSum / n).toFixed(0).padStart(8)}   ${(mSum / n).toFixed(0).padStart(6)}   ${ok}/${n}`,
  );
}
