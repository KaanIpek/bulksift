/**
 * Every card must have a picture, and it must be the right one.
 *
 * The pictures used to come from the catalogue's image host, and that failed in
 * the worst available way: asked for a card from a 2026 set it answers 200 OK
 * with a picture of a card *back*. No error, nothing to catch, and the app shows
 * the wrong card confidently. So all 20,444 thumbnails now ship inside the app,
 * concatenated into one file with a table of byte offsets.
 *
 * That trades a network failure for an indexing failure, which is quieter still:
 * an offset off by one row shows the previous card's picture next to this card's
 * name, and nothing anywhere reports an error. The only defence is to check the
 * table against the catalogue it was built from.
 *
 *   node --experimental-strip-types apps/mobile/test/thumbs.test.ts
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logoUrl, symbolUrl } from '../src/ui/art.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'assets', 'data');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

interface Compact {
  sets: Array<[string, string, string]>;
  cards: Array<[string, string, string, string | null, number, number | null]>;
}
interface Table { w: number; h: number; off: number[]; len: number[] }

const cards = (JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')) as Compact).cards;
const table = JSON.parse(readFileSync(join(dataDir, 'thumbs.json'), 'utf8')) as Table;
const binBytes = statSync(join(dataDir, 'thumbs.bin')).size;

// 1. One entry per card, in the same order. The whole scheme rests on the row
//    index meaning the same thing in both files.
check(
  `the table has one entry per card (${table.off.length.toLocaleString('en-US')})`,
  table.off.length === cards.length && table.len.length === cards.length,
  `cards ${cards.length}, offsets ${table.off.length}, lengths ${table.len.length}`,
);

// 2. Every range must lie inside the file. An offset past the end reads nothing;
//    one that overruns reads into the next card's picture.
{
  let bad = 0;
  let firstBad = '';
  for (let i = 0; i < table.off.length; i++) {
    const end = table.off[i] + table.len[i];
    if (table.off[i] < 0 || table.len[i] < 0 || end > binBytes) {
      bad++;
      if (!firstBad) firstBad = `${cards[i][0]} at ${table.off[i]}+${table.len[i]} of ${binBytes}`;
    }
  }
  check('every byte range lies inside the pack', bad === 0, firstBad);
}

/*
 * 3. The ranges must tile the file in order with no gaps and no overlaps. An
 *    overlap is the failure that would show a neighbour's picture, and it is
 *    invisible at runtime because a WebP decoder given a wrong offset simply
 *    fails and the app draws its fallback slot - which looks exactly like a
 *    card that has no picture.
 */
{
  let cursor = 0;
  let bad = 0;
  let firstBad = '';
  for (let i = 0; i < table.off.length; i++) {
    if (table.off[i] !== cursor) {
      bad++;
      if (!firstBad) firstBad = `${cards[i][0]} starts at ${table.off[i]}, expected ${cursor}`;
    }
    cursor += table.len[i];
  }
  check('the ranges tile the pack with no gaps or overlaps', bad === 0, firstBad);
  check(
    `the ranges account for the whole ${(binBytes / 1e6).toFixed(1)} MB`,
    cursor === binBytes,
    `ranges cover ${cursor}, file is ${binBytes}`,
  );
}

/*
 * 4. Every picture must actually be a WebP. The pack is written by a Python
 *    script; a change of format there would go unnoticed until a device showed
 *    twenty thousand empty slots, because the app names the format in the data
 *    URI it builds and an <Image> given the wrong one just fails silently.
 */
{
  const bin = readFileSync(join(dataDir, 'thumbs.bin'));
  let bad = 0;
  let firstBad = '';
  // Sample rather than read all 20,444: the failure this guards is a change of
  // encoder, which would affect every entry, not one.
  for (let i = 0; i < table.off.length; i += 97) {
    if (!table.len[i]) continue;
    const head = bin.subarray(table.off[i], table.off[i] + 12);
    if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WEBP') {
      bad++;
      if (!firstBad) firstBad = `${cards[i][0]} does not start with a WebP header`;
    }
  }
  check('sampled entries are WebP', bad === 0, firstBad);
}

/*
 * 5. Only the two cards known to have no artwork anywhere may be empty. A
 *    zero-length entry is how "no picture" is expressed, so a build that
 *    silently lost a set would show up here as a much larger count.
 */
{
  const empty = table.len
    .map((n, i) => (n === 0 ? cards[i][0] : null))
    .filter((x): x is string => x !== null);
  check(
    `only the two Unown with no artwork are empty (${empty.length})`,
    empty.length === 2 && empty.every((id) => id.startsWith('ex10-')),
    empty.slice(0, 8).join(', '),
  );
}

// 6. The thumbnails are the shape of a card, not a square or a rotation.
check(
  `the pack is ${table.w}x${table.h}, a card's proportions`,
  Math.abs(table.h / table.w - 342 / 245) < 0.02,
  `${(table.h / table.w).toFixed(3)} vs ${(342 / 245).toFixed(3)}`,
);

/*
 * 7. Set artwork still comes over the network - one image per set rather than
 *    one per card, on a screen that reads fine without them.
 */
check('set symbol url', symbolUrl('swsh7') === 'https://images.pokemontcg.io/swsh7/symbol.png');
check('set logo url', logoUrl('swsh7') === 'https://images.pokemontcg.io/swsh7/logo.png');
{
  const sets = (JSON.parse(readFileSync(join(dataDir, 'cards.json'), 'utf8')) as Compact).sets;
  const bad = sets.filter(([id]) => !/^[a-z0-9.-]+$/i.test(id));
  check(`all ${sets.length} set ids are safe in a url path`, bad.length === 0,
    bad.map((x) => x[0]).join(', '));
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
