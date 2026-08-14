/**
 * Nothing in front of the camera must produce nothing in the collection.
 *
 * A device build was pointed at a bare desk and logged twelve cards; pointed at
 * a bed, twenty-nine. Its diagnostics said the detector found a quad in 216 of
 * 216 frames and the matcher answered at distance 232 - inside the 240 gate, so
 * every frame was accepted.
 *
 * Two things had gone wrong together. The gate was swept on frames rendered
 * from the reference images, where a correct read sits at 37 and the 99th
 * percentile at 194; through a real lens both correct reads and blank surfaces
 * land far higher, and 240 no longer sits between them. And the detector will
 * always find *a* quad - a shadow, a placemat edge, the vignette of the lens -
 * so "there is a rectangle here" was never evidence that there was a card.
 *
 * What separates them is how far the winner is ahead of the first rival that is
 * a genuinely different card. See Scanner.nameMargin for why the rival has to
 * be a different card rather than simply the runner-up: a Basic Lightning
 * Energy ties with its runner-up too, because that runner-up is the same card
 * from another set.
 *
 * These frames are built the way the failure happened: a surface with a
 * card-shaped patch in it, so the detector really does find a quad and the
 * decision falls to the matcher rather than being dodged.
 *
 *   node --experimental-strip-types packages/core/test/nocard.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { loadCards, type CardRecord, type PriceBook } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards: CardRecord[] = loadCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')),
);
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8')) as PriceBook;

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const W = 960;
const H = 540;

// Deterministic, so a failure is reproducible rather than a coin flip.
let seed = 987654321;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

/**
 * A frame of `tint` with a card-shaped patch of slightly different brightness
 * in the middle - the shadow or placemat edge the detector latches onto.
 */
function blankFrame(
  tint: (x: number, y: number) => [number, number, number],
  patchDelta = 26,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  // A card at roughly the size one fills the frame at, in the same 2.5:3.5.
  const ph = Math.round(H * 0.8);
  const pw = Math.round((ph * 2.5) / 3.5);
  const px = (W - pw) >> 1;
  const py = (H - ph) >> 1;
  for (let y = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++, o += 4) {
      const [r, g, b] = tint(x, y);
      const inside = x >= px && x < px + pw && y >= py && y < py + ph;
      const d = inside ? patchDelta : 0;
      out[o] = r + d;
      out[o + 1] = g + d;
      out[o + 2] = b + d;
      out[o + 3] = 255;
    }
  }
  return out;
}

const SURFACES: Array<{ name: string; frame: Uint8ClampedArray }> = [
  {
    name: 'a bare brown desk',
    frame: blankFrame(() => [92, 58, 40]),
  },
  {
    name: 'a desk under a lamp, with a vignette',
    frame: blankFrame((x, y) => {
      const dx = (x - W / 2) / W;
      const dy = (y - H / 2) / H;
      const k = 1 - Math.min(1, (dx * dx + dy * dy) * 1.6);
      return [92 * k + 20, 58 * k + 14, 40 * k + 10];
    }),
  },
  {
    name: 'wood grain',
    frame: blankFrame((x, y) => {
      const g = Math.sin(y * 0.13 + Math.sin(x * 0.02) * 3) * 12;
      return [110 + g, 72 + g, 48 + g];
    }),
  },
  {
    name: 'a crumpled bedsheet',
    frame: blankFrame((x, y) => {
      const g = Math.sin(x * 0.05) * 18 + Math.sin(y * 0.037 + 1.3) * 14
        + Math.sin((x + y) * 0.021) * 10;
      return [198 + g, 190 + g, 178 + g];
    }),
  },
  {
    name: 'sensor noise on grey',
    frame: blankFrame(() => {
      const n = (rnd() - 0.5) * 26;
      return [128 + n, 128 + n, 128 + n];
    }),
  },
  {
    name: 'a soft shadow gradient',
    frame: blankFrame((x, y) => {
      const k = 40 + (y / H) * 90 + (x / W) * 25;
      return [k, k * 0.85, k * 0.72];
    }),
  },
  {
    name: 'a white sheet of paper',
    frame: blankFrame(() => [236, 234, 230], -14),
  },
  {
    name: 'a dark sleeve or mat',
    frame: blankFrame(() => [28, 30, 36], 18),
  },
];

// 1. A still photo of each surface must not identify as anything.
for (const s of SURFACES) {
  const scanner = new Scanner(index, cards, book);
  const hit = scanner.identify(s.frame, W, H, 4);
  check(
    `${s.name} identifies as nothing`,
    hit === null,
    hit ? `read as ${hit.card.n} (${hit.card.S})` : '',
  );
}

/*
 * 2. And the live loop, which is where the damage was done: sixty frames of the
 *    same empty surface, as a fixed camera would deliver, must commit nothing.
 *    One frame slipping through is a card in the collection; sixty are twelve.
 */
for (const s of SURFACES) {
  const scanner = new Scanner(index, cards, book);
  let hits = 0;
  for (let i = 0; i < 60; i++) {
    // Re-tint slightly each frame the way auto-exposure drifts, so the reuse
    // path and the fresh path are both exercised.
    const frame = s.frame.slice();
    const drift = ((i % 5) - 2) * 2;
    for (let p = 0; p < frame.length; p += 4) {
      frame[p] += drift; frame[p + 1] += drift; frame[p + 2] += drift;
    }
    if (scanner.processFrame(frame, W, H, 4).hit) hits++;
  }
  check(`${s.name} commits nothing over 60 frames`, hits === 0, `${hits} cards logged`);
}

/*
 * 3. The rule must not be so strict that it refuses everything. If the engine
 *    stopped recognising cards entirely these tests would also pass, which
 *    would be the worst kind of green.
 */
{
  const meta = JSON.parse(
    readFileSync(join(here, 'fixtures', 'scan_meta.json'), 'utf8'),
  ) as { width: number; height: number; count: number; frames: Array<{ row: number }> };
  const frames = readFileSync(join(here, 'fixtures', 'scan_frames.bin'));
  const frameBytes = meta.width * meta.height * 4;
  const scanner = new Scanner(index, cards, book);
  let identified = 0;
  for (let i = 0; i < meta.count; i++) {
    const raw = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    if (scanner.identify(raw, meta.width, meta.height, 4)) identified++;
  }
  check(
    `real cards still identify: ${identified}/${meta.count}`,
    identified >= 90,
    'the rejection rule is refusing real cards',
  );
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
