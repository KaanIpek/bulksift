/**
 * The live scan loop, as a sequence rather than as isolated frames.
 *
 * Everything else in this suite calls `identify()` on one frame at a time, so
 * the part of the engine the app actually runs - streaks, cooldowns, the
 * learned orientation, and skipping recognition on a frame that looks like the
 * last one - had no coverage at all. Three bugs lived there: a card counted
 * three times because a near-tie made its track identity alternate, both
 * orientations tested on every frame forever because the threshold was
 * calibrated on clean fixtures, and now a reuse rule that could in principle
 * answer for a card that has already been swapped.
 *
 * Each card is held for a run of frames, as it would be in front of a fixed
 * lens. Every emitted hit must name the card that was actually in view, and
 * each card must be emitted exactly once.
 *
 *   node --experimental-strip-types packages/core/test/sequence.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { Scanner } from '../src/scanner.ts';
import { expandCards, type CompactCatalogue } from '../src/types.ts';

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
const cards = expandCards(
  JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')) as CompactCatalogue,
);
const book = JSON.parse(readFileSync(join(dataDir, 'prices.json'), 'utf8'));

const frameBytes = meta.width * meta.height * 4;
const frameAt = (i: number) =>
  new Uint8ClampedArray(frames.buffer, frames.byteOffset + i * frameBytes, frameBytes);

/** Hold each of the first `cardCount` cards for `hold` frames in a row. */
function play(cardCount: number, hold: number) {
  const scanner = new Scanner(index, cards, book);
  const emitted: Array<{ atCard: number; row: number }> = [];
  let reused = 0;
  let frames = 0;

  for (let c = 0; c < cardCount; c++) {
    for (let f = 0; f < hold; f++) {
      const r = scanner.processFrame(frameAt(c), meta.width, meta.height, 4);
      frames++;
      reused += r.timings.reused;
      if (r.hit) emitted.push({ atCard: c, row: cards.indexOf(r.hit.card) });
    }
  }
  return { emitted, reused, frames };
}

let failed = 0;
const CARDS = 25;
const HOLD = 12;
const { emitted, reused, frames: total } = play(CARDS, HOLD);

console.log(`${CARDS} cards held for ${HOLD} frames each (${total} frames)`);
console.log(`recognition skipped on ${reused}/${total} frames (${((reused / total) * 100).toFixed(0)}%)`);
console.log(`${emitted.length} hits emitted for ${CARDS} cards\n`);

/*
 * 1. Every hit names the card that was in front of the lens.
 *
 * A wrong *printing* of the right card is counted apart from a wrong card.
 * Same-artwork reprints are a measured, documented limit of an image-only
 * descriptor - the reprint suite puts them at 92% exact - and the app surfaces
 * them to the user rather than pretending to know. Naming a different Pokemon
 * entirely would be a real failure, and this is the check that would catch it.
 */
let wrong = 0;
let reprint = 0;
for (const e of emitted) {
  const want = meta.frames[e.atCard].row;
  if (e.row === want) continue;
  const got = cards[e.row];
  const expected = cards[want];
  if (got && expected && got.n === expected.n) {
    reprint++;
    console.log(`  reprint: ${expected.n} read as the ${got.S} printing, not ${expected.S}`);
    continue;
  }
  wrong++;
  if (wrong <= 3) {
    console.log(
      `  MISNAMED while showing ${meta.frames[e.atCard].name}: ` +
      `got ${got?.n} (${got?.S})`,
    );
  }
}
console.log(
  `${wrong ? 'FAIL' : 'OK  '} ${emitted.length - wrong - reprint}/${emitted.length} exact` +
  `, ${reprint} right card wrong printing, ${wrong} wrong card`,
);
if (wrong) failed++;

// 2. No card is counted twice. This is the bug that put three Patrats in one
//    list, and reuse could reintroduce it by keeping a stale result alive.
const perCard = new Map<number, number>();
for (const e of emitted) perCard.set(e.atCard, (perCard.get(e.atCard) ?? 0) + 1);
const duplicated = [...perCard.entries()].filter(([, n]) => n > 1);
console.log(
  `${duplicated.length ? 'FAIL' : 'OK  '} no card emitted more than once` +
  (duplicated.length ? ` (${duplicated.length} were: ${duplicated.slice(0, 3).map(([c, n]) => `${meta.frames[c].name} x${n}`).join(', ')})` : ''),
);
if (duplicated.length) failed++;

// 3. Cards are not silently dropped. A few refusals are expected and correct -
//    the gate exists so a doubtful read costs nothing - but most must land.
const seen = perCard.size;
const ok = seen >= Math.ceil(CARDS * 0.8);
console.log(`${ok ? 'OK  ' : 'FAIL'} ${seen}/${CARDS} cards were emitted at all`);
if (!ok) failed++;

// 4. The reuse rule has to actually fire, or it is costing complexity for
//    nothing. A card held for 12 frames should be recognised once or twice.
const fires = reused / total > 0.5;
console.log(`${fires ? 'OK  ' : 'FAIL'} reuse skipped the majority of frames`);
if (!fires) failed++;

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
