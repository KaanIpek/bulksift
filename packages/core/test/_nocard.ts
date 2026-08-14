/**
 * What does the index say when there is no card in front of the camera?
 *
 * A device build logged 12 cards while pointed at an empty desk and 29 while
 * pointed at a bed. The diagnostics said the detector found a quad in 216 of
 * 216 frames and the matcher answered at distance 232 - under the 240 gate, so
 * every one of them was accepted and written to the collection.
 *
 * That gate was swept on frames rendered from the reference images, where a
 * correct read sits at 37 and the 99th percentile at 275. Through a real lens a
 * correct read sits near 210, so the gate was raised to cover it - and 240 is
 * also where a flat brown table lands. Distance alone cannot separate them.
 *
 * This measures the thing that can: how far the winner is ahead of the runner
 * up. A real card beats the field; noise ties with it, because nothing in a
 * featureless surface prefers one of 20,444 rows over another.
 *
 *   node --experimental-strip-types packages/core/test/_nocard.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { loadCards } from '../src/types.ts';
import { describe } from '../src/descriptor.ts';
import { detectCard, rectifyFrom, rotate180, sourceOf } from '../src/detect.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);

const CANON_W = 240;
const CANON_H = 336;

/** A canonical-sized RGBA image filled by a function of x and y. */
function surface(f: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(CANON_W * CANON_H * 4);
  for (let y = 0, o = 0; y < CANON_H; y++) {
    for (let x = 0; x < CANON_W; x++, o += 4) {
      const [r, g, b] = f(x, y);
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
    }
  }
  return out;
}

// A deterministic value noise, so the numbers below are reproducible.
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const SURFACES: Array<{ name: string; img: Uint8ClampedArray }> = [
  {
    name: 'flat brown desk',
    img: surface(() => [92, 58, 40]),
  },
  {
    name: 'desk with a vignette',
    img: surface((x, y) => {
      const dx = (x - CANON_W / 2) / CANON_W;
      const dy = (y - CANON_H / 2) / CANON_H;
      const k = 1 - Math.min(1, (dx * dx + dy * dy) * 1.6);
      return [92 * k + 20, 58 * k + 14, 40 * k + 10];
    }),
  },
  {
    name: 'wood grain',
    img: surface((x, y) => {
      const g = Math.sin(y * 0.13 + Math.sin(x * 0.02) * 3) * 12;
      return [110 + g, 72 + g, 48 + g];
    }),
  },
  {
    name: 'crumpled cloth',
    img: surface((x, y) => {
      const g = Math.sin(x * 0.05) * 18 + Math.sin(y * 0.037 + 1.3) * 14
        + Math.sin((x + y) * 0.021) * 10;
      return [198 + g, 190 + g, 178 + g];
    }),
  },
  {
    name: 'sensor noise on grey',
    img: surface(() => {
      const n = (rnd() - 0.5) * 26;
      return [128 + n, 128 + n, 128 + n];
    }),
  },
  {
    name: 'soft shadow gradient',
    img: surface((x, y) => {
      const k = 40 + (y / CANON_H) * 90 + (x / CANON_W) * 25;
      return [k, k * 0.85, k * 0.72];
    }),
  },
];

interface Row { label: string; best: number; second: number; gap: number; ratio: number }
const rows: Row[] = [];

for (const s of SURFACES) {
  const q = describe(s.img);
  const top = index.topK(q, 2);
  rows.push({
    label: s.name,
    best: top[0].distance,
    second: top[1].distance,
    gap: top[1].distance - top[0].distance,
    ratio: top[0].distance / top[1].distance,
  });
}

/*
 * Real cards, straight from the index's own rows, so the comparison is between
 * "a card the index knows" and "not a card at all". Their gap is the floor a
 * genuine read has to clear even under ideal conditions.
 */
const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string }>;
};
const frameBytes = meta.width * meta.height * 4;
const framesBuf = readFileSync(join(fixtures, 'scan_frames.bin'));

const cardRows: Row[] = [];
let wrong = 0;
for (let i = 0; i < meta.count; i++) {
  const raw = new Uint8ClampedArray(
    framesBuf.buffer, framesBuf.byteOffset + i * frameBytes, frameBytes,
  );
  /*
   * The path the app actually takes to commit a card: find the quad, rectify
   * it, describe the rectified card. An earlier version of this described the
   * whole frame instead, which measures the table around the card and lands
   * squarely in the noise band being investigated - the numbers looked like a
   * refutation and were an artefact.
   */
  const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
  if (!det) continue;
  const upright = rectifyFrom(
    sourceOf(raw, meta.width, meta.height, 4), det.quad, CANON_W, CANON_H,
  );
  let top = index.topK(describe(upright), 2);
  if (top[0].distance > 150) {
    const tb = index.topK(describe(rotate180(upright, CANON_W, CANON_H)), 2);
    if (tb[0].distance < top[0].distance) top = tb;
  }
  const ok = top[0].index === meta.frames[i].row;
  if (!ok) wrong++;
  cardRows.push({
    label: `${meta.frames[i].name}${ok ? '' : '   <- WRONG'}`,
    best: top[0].distance,
    second: top[1].distance,
    gap: top[1].distance - top[0].distance,
    ratio: top[0].distance / top[1].distance,
  });
}

const show = (label: string, list: Row[]) => {
  console.log(`\n=== ${label}`);
  console.log('  best  2nd   gap   ratio  what');
  for (const r of list) {
    console.log(
      `  ${String(r.best).padStart(4)} ${String(r.second).padStart(4)} ` +
      `${String(r.gap).padStart(5)}  ${r.ratio.toFixed(3)}  ${r.label}`,
    );
  }
  const gaps = list.map((r) => r.gap).sort((a, b) => a - b);
  const ratios = list.map((r) => r.ratio).sort((a, b) => a - b);
  console.log(
    `  gap   min ${gaps[0]}  median ${gaps[gaps.length >> 1]}  max ${gaps[gaps.length - 1]}`,
  );
  console.log(
    `  ratio min ${ratios[0].toFixed(3)}  median ${ratios[ratios.length >> 1].toFixed(3)}` +
    `  max ${ratios[ratios.length - 1].toFixed(3)}`,
  );
};

show('surfaces with no card in them', rows);
show('real cards', cardRows);
console.log(`\n  ${wrong} of ${cardRows.length} identified wrongly`);

/*
 * The rule that separates "not a card" from "a card whose printing is
 * genuinely hard to pin down".
 *
 * A plain margin to the runner-up cannot tell those apart. A blank desk ties
 * with its runner-up because nothing in a featureless surface prefers one of
 * 20,444 rows over another - and a Basic Lightning Energy also ties with its
 * runner-up, because that runner-up is the same card printed in another set and
 * the two really are near-identical. Refusing both would make the app unable to
 * count energies, which is half of what bulk is.
 *
 * So the margin is measured to the first rival that is a *different card*, by
 * name. Reprints of the same card are not rivals for the question "is there a
 * card here at all" - they are the separate question the footer and the
 * ambiguity prompt already handle.
 */
const NAMES: string[] = loadCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')),
).map((c) => c.n);

function nameMargin(q: Uint8Array): { best: number; margin: number; rivalsSameName: number } {
  const top = index.topK(q, 16);
  const winner = NAMES[top[0].index];
  let rivalsSameName = 0;
  for (let i = 1; i < top.length; i++) {
    if (NAMES[top[i].index] === winner) { rivalsSameName++; continue; }
    return { best: top[0].distance, margin: top[i].distance - top[0].distance, rivalsSameName };
  }
  // Every one of the sixteen is the same card: an enormous margin, in effect.
  return { best: top[0].distance, margin: 9999, rivalsSameName };
}

const surfaceMargins = SURFACES.map((s) => ({ label: s.name, ...nameMargin(describe(s.img)) }));
const cardMargins: Array<{ label: string; best: number; margin: number; rivalsSameName: number; ok: boolean }> = [];
for (let i = 0; i < meta.count; i++) {
  const raw = new Uint8ClampedArray(
    framesBuf.buffer, framesBuf.byteOffset + i * frameBytes, frameBytes,
  );
  const det = detectCard(raw, meta.width, meta.height, { workWidth: 320, channels: 4 });
  if (!det) continue;
  const upright = rectifyFrom(
    sourceOf(raw, meta.width, meta.height, 4), det.quad, CANON_W, CANON_H,
  );
  let q = describe(upright);
  if (index.topK(q, 1)[0].distance > 150) {
    const qb = describe(rotate180(upright, CANON_W, CANON_H));
    if (index.topK(qb, 1)[0].distance < index.topK(q, 1)[0].distance) q = qb;
  }
  const m = nameMargin(q);
  cardMargins.push({
    label: meta.frames[i].name, ...m,
    ok: index.topK(q, 1)[0].index === meta.frames[i].row,
  });
}

console.log('\n=== margin to the first rival with a different name');
const sm = surfaceMargins.map((x) => x.margin).sort((a, b) => a - b);
const cm = cardMargins.map((x) => x.margin).sort((a, b) => a - b);
console.log(`  surfaces: ${surfaceMargins.map((x) => x.margin).join(', ')}`);
console.log(`  cards   : min ${cm[0]}  p10 ${cm[Math.floor(cm.length * 0.1)]}  median ${cm[cm.length >> 1]}`);
console.log(`  the widest a surface managed: ${sm[sm.length - 1]}`);

console.log('\n   N   cards refused   of those, ones that were WRONG   surfaces accepted');
for (const n of [0, 10, 20, 30, 40, 60, 80, 120]) {
  const refused = cardMargins.filter((r) => r.margin < n);
  const survive = surfaceMargins.filter((r) => r.margin >= n).length;
  console.log(
    `  ${String(n).padStart(3)}   ${String(refused.length).padStart(3)}/${cardMargins.length}`
    + `             ${refused.filter((r) => !r.ok).length}/${cardMargins.filter((r) => !r.ok).length}`
    + `                        ${survive}/${surfaceMargins.length}`,
  );
}
