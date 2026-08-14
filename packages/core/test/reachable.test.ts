/**
 * No acceptance rule may make a card impossible to scan.
 *
 * The rule that keeps an empty desk out of the collection asks the winner to
 * beat the nearest differently-named card by a margin. Raise that threshold far
 * enough and cards start becoming unreachable - not "hard", but impossible,
 * because no read can ever score better than the card's own index row.
 *
 * That is exactly what happened. The threshold was set to 40 because two suites
 * said 24, 32 and 40 all cost the same one card in a hundred, so it took the
 * widest for headroom. Both suites measured the same hundred fixture frames.
 * Neither could see that Basic Fire Energy peaks at 37 - so basic energies,
 * which are a good half of any box of bulk, could not be scanned at all, and a
 * device build duly failed to read one.
 *
 * The check is cheap and has no experiment in it: feed each card's own row back
 * as a query and see what margin it gets. That is the ceiling. A threshold
 * above the ceiling is a card the app cannot see.
 *
 * Eight cards sit at margin zero because their index rows are byte-identical -
 * four Celebrations Classic Collection reprints and two Black Bolt pairs that
 * share artwork exactly. No threshold can help those; they are a data defect,
 * and the scanner surfaces them as an ambiguity instead of guessing.
 *
 *   node --experimental-strip-types packages/core/test/reachable.test.ts
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CardIndex } from '../src/matcher.ts';
import { baseName } from '../src/scanner.ts';
import { DEFAULT_CONFIG, loadCards } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', '..', 'data');

const idxBuf = readFileSync(join(dataDir, 'index.bin'));
const index = CardIndex.parse(
  idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength) as ArrayBuffer,
);
const cards = loadCards(JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')));
/*
 * Names are compared the way the scanner compares them: without the trailing
 * parenthetical, which the catalogue uses to separate printings of one card.
 * Compared literally, "Professor's Research (Professor Sada)" and
 * "(Professor Turo)" look like rivals and their margin is 10 bits - which made
 * both of them unscannable at any sensible gate.
 */
const NAMES = cards.map((c) => baseName(c.n));

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

/** The best margin this card could ever achieve, over a perfect read. */
function ceilingFor(row: number): number {
  const top = index.topK(index.rowBytes(row), 16);
  const winner = NAMES[top[0].index];
  for (let i = 1; i < top.length; i++) {
    if (NAMES[top[i].index] === winner) continue;
    return top[i].distance - top[0].distance;
  }
  return Number.POSITIVE_INFINITY;
}

// 1. A row must find itself. If this fails nothing below means anything.
{
  let bad = 0;
  for (const row of [0, 1, 5000, 12345, cards.length - 1]) {
    if (index.topK(index.rowBytes(row), 1)[0].distance !== 0) bad++;
  }
  check('a row used as its own query matches itself exactly', bad === 0);
}

const gate = DEFAULT_CONFIG.minNameMargin;

/*
 * 2. Basic energies specifically. They are the flattest rows in the index, the
 *    most common card in bulk, and the ones a threshold reaches first.
 */
{
  const energies = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => /^Basic .* Energy$/.test(c.n));
  const worst = energies
    .map(({ c, i }) => ({ name: `${c.n} (${c.S})`, m: ceilingFor(i) }))
    .sort((a, b) => a.m - b.m)[0];
  check(
    `every basic energy is reachable — worst is ${worst.name} at ${worst.m}, gate is ${gate}`,
    worst.m >= gate,
    'the gate is above what this card can ever score, so it can never be scanned',
  );
}

/*
 * 3. The catalogue at large. Sampled every 7th card: the failure this guards
 *    is a threshold moved too far, which lifts above whole families at once,
 *    not one card in isolation.
 */
{
  const unreachable: string[] = [];
  let identical = 0;
  for (let row = 0; row < cards.length; row += 7) {
    const m = ceilingFor(row);
    if (m >= gate) continue;
    if (m === 0) { identical++; continue; }
    unreachable.push(`${cards[row].n} (${cards[row].S}) at ${m}`);
  }
  check(
    `no sampled card is unreachable for any reason but an identical twin`,
    unreachable.length === 0,
    unreachable.slice(0, 6).join('; '),
  );
  console.log(
    `     ${identical} sampled cards have a byte-identical twin and are ` +
    `surfaced as ambiguous rather than guessed`,
  );
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
