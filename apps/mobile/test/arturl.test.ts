/**
 * The card art URLs are derived, so they have to be derived correctly.
 *
 * Nothing stores an image URL: 20,444 of them would be half a megabyte of
 * duplicated string in a file the app parses at launch, when every one is
 * `{host}/{setId}/{number}.png`. The cost of deriving is that a mistake in one
 * short function silently blanks the pictures on every screen - and it would
 * blank them the same way a network outage does, which is the fallback working
 * as designed, so nothing would look broken.
 *
 * Two collector numbers in the catalogue are not URL-safe: the Unown "!" and
 * "?" from Unseen Forces. The "?" is the one that matters - left raw it ends
 * the URL's path and turns the rest into a query string, so the request goes to
 * a directory rather than a file. Percent-encoded it reaches the server, which
 * answers with a real image. The catalogue's own `image` field for that card is
 * the raw, broken form; this deliberately does not copy it.
 *
 *   node --experimental-strip-types apps/mobile/test/arturl.test.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artUrl, logoUrl, symbolUrl } from '../src/ui/art.ts';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '..', 'assets', 'data', 'cards.json');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

interface Compact {
  sets: Array<[string, string, string]>;
  cards: Array<[string, string, string, string | null, number, number | null]>;
}

const compact = JSON.parse(readFileSync(data, 'utf8')) as Compact;
const HOST = 'https://images.pokemontcg.io';

// 1. Every card produces a URL that parses, keeps its host, and puts the whole
//    number in one path segment.
{
  let bad = 0;
  let firstBad = '';
  let queried = 0;
  for (const [id, , number, , setIndex] of compact.cards) {
    const setId = compact.sets[setIndex][0];
    const url = artUrl(setId, number);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      bad++;
      if (!firstBad) firstBad = `${id}: ${url} does not parse`;
      continue;
    }
    // A number that leaks into the query means the path stopped early.
    if (parsed.search) {
      queried++;
      if (!firstBad) firstBad = `${id}: ${url} has a query string`;
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    const ok = parsed.origin === HOST
      && segments.length === 2
      && segments[0] === setId
      && decodeURIComponent(segments[1]) === `${number}.png`;
    if (!ok) {
      bad++;
      if (!firstBad) firstBad = `${id}: ${url} (set ${setId}, number ${number})`;
    }
  }
  check(
    `all ${compact.cards.length.toLocaleString('en-US')} art urls are one host and one path segment`,
    bad === 0 && queried === 0,
    firstBad,
  );
}

// 2. The two awkward numbers specifically, because they are the whole reason
//    the encoding is there.
check(
  'the Unown "?" is percent-encoded rather than starting a query',
  artUrl('ex10', '?') === `${HOST}/ex10/%3F.png`,
  artUrl('ex10', '?'),
);
check(
  'the Unown "!" is left alone, since it is already path-safe',
  artUrl('ex10', '!') === `${HOST}/ex10/!.png`,
  artUrl('ex10', '!'),
);

// 3. An ordinary card must come out exactly as the catalogue has it, or the
//    derivation has drifted from the source it was read off.
check(
  'an ordinary number derives to the catalogue url',
  artUrl('base1', '4') === `${HOST}/base1/4.png`,
  artUrl('base1', '4'),
);
check(
  'the hires variant asks for the large scan',
  artUrl('base1', '4', true) === `${HOST}/base1/4_hires.png`,
  artUrl('base1', '4', true),
);

// 4. Set artwork, used by the sets list.
check('set symbol url', symbolUrl('swsh7') === `${HOST}/swsh7/symbol.png`);
check('set logo url', logoUrl('swsh7') === `${HOST}/swsh7/logo.png`);

// 5. Every set the app knows about can ask for its own artwork.
{
  let bad = 0;
  for (const [setId] of compact.sets) {
    if (!/^[a-z0-9.-]+$/i.test(setId)) bad++;
  }
  check(`all ${compact.sets.length} set ids are safe in a url path`, bad === 0);
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
