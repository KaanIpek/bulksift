/**
 * Accuracy on the expensive cases: same artwork, different set, >=2x price gap.
 *
 * Reports three things, because on this fixture set they diverge:
 *   exact       - the right printing was picked
 *   flagged     - the wrong printing was picked but the user was asked
 *   silent      - the wrong printing was priced as fact
 *
 * Only the third is a failure. The point of the ambiguity prompt is to convert
 * the second into a one-tap question rather than a wrong number, so a change
 * that moves errors from "silent" to "flagged" is an improvement even though
 * exact accuracy did not move.
 *
 *   node --experimental-strip-types packages/core/test/reprint.test.ts
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

const meta = JSON.parse(readFileSync(join(fixtures, 'reprint_meta.json'), 'utf8')) as {
  width: number; height: number; count: number;
  frames: Array<{ id: string; row: number; name: string; set: string; price: number }>;
};
const frames = readFileSync(join(fixtures, 'reprint_frames.bin'));
const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards: CardRecord[] = loadCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')),
);
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8')) as PriceBook;

const frameBytes = meta.width * meta.height * 4;

function run(label: string, ambiguousMargin: number, ambiguousPriceRatio = 1.6) {
  const scanner = new Scanner(index, cards, book, {
    ambiguousMargin,
    ambiguousPriceRatio,
  });

  let exact = 0;
  let flagged = 0;
  let silent = 0;
  let refused = 0;
  let dollarsSilent = 0;

  for (let i = 0; i < meta.count; i++) {
    const rgba = new Uint8ClampedArray(
      frames.buffer, frames.byteOffset + i * frameBytes, frameBytes,
    );
    const want = meta.frames[i];
    const hit = scanner.identify(rgba, meta.width, meta.height);
    if (!hit) {
      refused++;
      continue;
    }
    if (hit.card.i === want.id) {
      exact++;
    } else if (hit.ambiguity) {
      flagged++;
    } else {
      silent++;
      dollarsSilent += Math.abs((hit.topMarket ?? 0) - want.price);
    }
  }

  const n = meta.count;
  const pc = (v: number) => `${((v / n) * 100).toFixed(0)}%`.padStart(4);
  console.log(
    `${label.padEnd(12)} exact ${String(exact).padStart(3)} (${pc(exact)})   ` +
    `flagged ${String(flagged).padStart(3)} (${pc(flagged)})   ` +
    `SILENT ${String(silent).padStart(3)} (${pc(silent)})   ` +
    `refused ${String(refused).padStart(2)}   $${dollarsSilent.toFixed(2)} misquoted`,
  );
  return { exact, flagged, silent, dollarsSilent };
}

console.log(
  `${meta.count} frames of cards that share artwork across sets with a >=2x ` +
  `price gap\n${index.rows} cards in the index\n`,
);

// A wider ambiguity margin cannot make the identification better - it only
// changes whether a wrong pick is presented as fact or as a question. The cost
// is asking about scans that were already right, so the sweep is looking for
// where misquoted dollars stop falling faster than prompts rise.
for (const margin of [28, 40, 60, 80, 120, 160]) {
  run(`margin ${margin}`, margin);
}
