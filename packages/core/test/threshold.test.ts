/**
 * Choose the confidence gate from data, using the path that actually ships.
 *
 * Scanner.identify runs the high-resolution detect that the live scanner uses
 * to commit a card, so its distances are the ones the threshold has to be set
 * against - the raw 320 px tracking pass reads much higher and would push the
 * gate to the wrong place.
 *
 * Three outcomes matter, in this order:
 *   confidently wrong - a wrong price shown as fact. Costs the user money.
 *   refused           - "rescan". Costs a second.
 *   priced correctly  - the point of the app.
 *
 *   node --experimental-strip-types packages/core/test/threshold.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { loadCards, type CardRecord, type PriceBook } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const dataDir = join(here, '..', '..', '..', 'data');

const meta = JSON.parse(readFileSync(join(fixtures, 'scan_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string; set: string }>;
};
const frames = readFileSync(join(fixtures, 'scan_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards: CardRecord[] = loadCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')),
);
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8')) as PriceBook;

// A permissive scanner, so every read is observed and bucketed here instead of
// being filtered before it can be counted.
const scanner = new Scanner(index, cards, book, { maxDistance: 10_000 });

const frameBytes = meta.width * meta.height * 4;
type Read = {
  distance: number;
  correct: boolean;
  ambiguous: boolean;
  /** How far off the quoted price was, in dollars. */
  priceError: number;
  want: string;
  got: string;
};
const reads: Read[] = [];
let undetected = 0;
let t = 0;

const truthPrice = (id: string) => {
  const v = scanner.pricesFor(id).filter((p) => p.market != null);
  return v.length ? Math.max(...v.map((p) => p.market as number)) : null;
};

for (let i = 0; i < meta.count; i++) {
  const rgba = new Uint8ClampedArray(
    frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
  );
  const t0 = performance.now();
  const hit = scanner.identify(rgba, meta.width, meta.height);
  t += performance.now() - t0;
  if (!hit) {
    undetected++;
    continue;
  }
  const want = meta.frames[i];
  const correct = hit.card.i === want.id;
  const shown = hit.topMarket ?? 0;
  const actual = truthPrice(want.id) ?? 0;
  reads.push({
    distance: hit.distance,
    correct,
    ambiguous: !!hit.ambiguity,
    priceError: correct ? 0 : Math.abs(shown - actual),
    want: `${want.name} (${want.set})`,
    got: `${hit.card.n} (${hit.card.S})`,
  });
}

const sorted = reads.filter((r) => r.correct).map((r) => r.distance).sort((a, b) => a - b);
console.log(`${meta.count} frames, ${index.rows} cards, ` +
  `${(t / meta.count).toFixed(0)} ms per identify (high-res path)\n`);
console.log(`correct-read distance: median ${sorted[sorted.length >> 1]}, ` +
  `p90 ${sorted[Math.floor(sorted.length * 0.9)]}, p99 ${sorted[Math.floor(sorted.length * 0.99)]}`);
console.log(`undetected: ${undetected}/${meta.count}\n`);

console.log('gate   priced correctly   refused   CONFIDENTLY WRONG   flagged   $ misquoted');
for (const gate of [120, 150, 180, 200, 220, 240, 260, 300]) {
  let good = 0;
  let wrong = 0;
  let refused = undetected;
  let flagged = 0;
  let dollars = 0;
  for (const r of reads) {
    if (r.distance > gate) refused++;
    else if (r.correct) good++;
    else if (r.ambiguous) flagged++;
    else {
      wrong++;
      dollars += r.priceError;
    }
  }
  const n = meta.count;
  console.log(
    `${String(gate).padStart(4)}   ${String(good).padStart(3)}/${n} ` +
    `(${((good / n) * 100).toFixed(0).padStart(3)}%)      ` +
    `${String(refused).padStart(3)}       ` +
    `${String(wrong).padStart(3)} (${((wrong / n) * 100).toFixed(1)}%)         ` +
    `${String(flagged).padStart(2)}      $${dollars.toFixed(2)}`,
  );
}

// A miscount is only a problem in proportion to what it misprices. Listing the
// dollar error separates "quoted 60c instead of 72c" from "quoted $6 for a $180
// card", which the counts alone cannot.
const misquotes = reads
  .filter((r) => !r.correct && !r.ambiguous && r.distance <= 240)
  .sort((a, b) => b.priceError - a.priceError);
if (misquotes.length) {
  console.log(`\nunflagged misquotes inside the gate:`);
  for (const m of misquotes) {
    console.log(`  $${m.priceError.toFixed(2).padStart(8)}   ${m.want}  ->  ${m.got}  d=${m.distance}`);
  }
}
