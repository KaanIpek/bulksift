# BulkSift

Point a camera at trading cards and get their current US market price, live, fast
enough to fix the camera in place and swipe cards past it. Named for the job:
sift a bulk box and the valuable card announces itself instead of going by
unnoticed.

Recognition runs **entirely on-device** against a 1.96 MB index. No server
round-trip, which is why it can keep up with a moving card.

The first catalogue is the complete English Pokémon TCG — 20,444 cards — but
nothing in the engine is game-specific: it matches a rectangle of artwork
against an index. Adding Magic, Yu-Gi-Oh! or Lorcana is a data-pipeline job, not
an engine one, since tcgcsv.com already carries their prices and each game has
an open image source.

The name deliberately carries no third-party trademark, and the app ships
descriptors rather than card art, so nothing copyrighted is distributed.

---

## Is this actually possible?

Yes, and it was measured rather than assumed. `research/` holds the experiments;
the numbers below come from the shipping TypeScript engine, not a prototype.

| | |
|---|---|
| Catalogue | **20,444** English cards, all indexed |
| On-device index | **1.96 MB** (742-bit descriptor per card, padded to 32-bit rows) |
| Detection rate | **100%** of simulated 1280×720 frames |
| Top-1 identification | **97%** per single frame |
| Corner localisation | **1.5 px** median on a ~510 px card (0.3%) |
| Throughput | **~80 fps** single-threaded; 10 ms to identify a card against all 20,444 |
| Prices | TCGplayer USD, **refreshed daily**, per printing variant |

With the confidence gate at 240 bits, per-frame outcomes are:

```
priced correctly     96%
refused, ask rescan   3%     costs the user a second
confidently wrong     1%     worth $0.12 across 100 scans
```

That last line is the one worth reading twice. Counting mistakes is misleading
when a mistake can be either "quoted 60c for a 72c card" or "quoted $6 for a
$180 card", so the test suite reports the **dollar** error. Across 100 scans the
single unflagged mistake was a 72c Gardevoir read as its 60c reprint.

The live scanner does better than any single frame, because a card is visible
for 15–30 frames and only has to be read well once.

### The one hard problem

Cards that share artwork across sets — Jungle vs Base Set 2 Mr. Mime, Base vs
Base Set 2 Charizard — sit **inside camera-noise distance** of each other while
their prices differ 3–7×. Five approaches were tried and measured:

| approach | accuracy on the hardest reprint pairs |
|---|---|
| coarse hash alone | 67–71% |
| + aligned NCC re-rank | 75% |
| + discriminative-region re-rank | 82% |
| + hi-res reference | 79% (worse) |
| + OCR of the collector number | 66% (read the number only 8% of the time) |
| **+ sub-pixel edge localisation** | **92%** |

OCR failed for a physical reason, not an algorithmic one: motion blur destroys
an 18 px digit, and the number is the only thing that separates the printings.
What did work was measuring the card's corners properly — see below.

The residual is handled honestly rather than hidden. When two candidates are
close **and** their prices differ materially, the scan is flagged
`check printing` and the user gets a one-tap choice. On 180 frames of cards that
share artwork across sets with a ≥2× price gap:

```
exact printing      92%
flagged for choice   2%
silently wrong       5%     worth $0.30 in total
```

The ambiguity margin was tuned on that number, not on the counts: widening it
from 28 to 40 bits costs one extra prompt and takes the misquoted total from
**$51.55 down to $0.30**.

### What made the difference

The engine was rebuilt around one measurement. Feeding the pipeline a
ground-truth quad instead of a detected one dropped the median Hamming distance
from 115 to 26 — so identification was never the bottleneck, **localisation
was**. Detection runs on a downscaled copy, where one working pixel covers four
source pixels; the corners landed ~9 px out.

The fix casts scanlines perpendicular to each edge into the full-resolution
image, finds the true boundary as a sub-pixel gradient peak, fits a robust line
through those points and intersects adjacent lines — which also recovers the
corner hidden behind the card's rounded radius. Median corner error went 9 px →
1.5 px, distance 115 → 37, top-1 95% → 97%.

It also made the pipeline simpler and faster: the commit pass used to re-run
detection at 1280 px for 45 ms per card. Since refinement reads full resolution
regardless of the coarse search width, 320 px now matches 1280 px exactly, and
the second pass was deleted.

---

## Layout

```
tools/          Python data pipeline and the descriptor reference implementation
data/           generated: catalogue.json, index.bin, cards.json, prices.json
packages/core/  the engine, shared by both apps (TypeScript, zero dependencies)
apps/web/       browser scanner (Vite) — also the fastest way to test changes
apps/mobile/    Expo app for iOS/Android
research/       the feasibility experiments, kept so the numbers can be re-checked
```

## Data sources, and why these ones

- **Catalogue** — `PokemonTCG/pokemon-tcg-data` GitHub zip. The live
  `api.pokemontcg.io` returns 502s under load; the git repo does not.
- **Prices** — `tcgcsv.com`, a free daily mirror of TCGplayer's own feed.
  TCGplayer's official API has been closed to new applicants since late 2024.
  TCGCSV is both reliable and *more current* (217 sets vs the API's 175).
- **Card art** — `images.pokemontcg.io`, with `tcgplayer-cdn.tcgplayer.com` as a
  fallback. That fallback matters: 738 cards (3.6%) have no art on the primary
  mirror and they cluster in the newest sets — including a $1,126 Mega Gengar ex.
  The two sources were verified to agree within 10–12 bits before being mixed.

Sets are joined to TCGplayer groups by abbreviation, then **verified by
collector-number overlap**, so a bad name match surfaces as a warning instead of
silently attaching wrong prices. 99% of cards join; the one rejected set is
visible in `data/set_match_report.json`.

**The app ships hashes, never card images.** Card art is copyright The Pokémon
Company, and a 742-bit descriptor cannot be turned back into a picture.

## Rebuilding the data

```bash
python tools/build_catalogue.py    # catalogue + daily TCGplayer prices
python tools/download_images.py    # resumable; the CDN throttles hard
python tools/fallback_images.py    # fills gaps from the TCGplayer CDN
python tools/build_index.py        # writes index.bin, cards.json, prices.json
```

Prices change daily but the index does not, so in production only
`prices.json` needs re-publishing. `apps/mobile/src/engine.ts` has a
`PRICE_FEED_URL` hook for that; it falls back to the bundled snapshot if the
feed is unreachable or truncated.

## Running

```bash
npm install --prefix apps/web && npm run dev
```

Open the page and press **Start camera**, or **Demo feed** to exercise the
engine without a webcam. The web app installs as a PWA and caches its index, so
it keeps working with no connection — which is the normal state of affairs at a
card show.

```bash
npm install --prefix apps/mobile
npm run sync                       # copy the built data into both apps
npm run android --prefix apps/mobile   # or ios; needs a dev build, not Expo Go
```

VisionCamera 5 is a different API from 4 and is easy to get wrong: there is no
`useFrameProcessor`, no Expo config plugin, and it does **not** use
`react-native-worklets-core`. Frames come from `useFrameOutput` (which can be
asked for `pixelFormat: 'rgb'` at a target resolution), pixels from
`frame.getPixelBuffer()`, and the JS hop from `scheduleOnRN` in
`react-native-worklets`. Its peers are `react-native-nitro-modules`,
`react-native-nitro-image` and `react-native-vision-camera-worklets`. Keep
`expo install --fix` happy; a mismatched React Native fails Gradle with the
unhelpful `Cannot invoke method getAbsolutePath() on null object`.

Prices change daily, the index does not:

```bash
npm run prices    # refetch just the price feed (~17s) and sync it into the apps
```

## Using it

Fix the camera in place and pass cards through the frame. Each identified card
lands in the session list with its price and a running total.

- **Flag cards over $N** highlights and beeps on anything above the threshold.
  Bulk scanning is a search problem — hundreds of cards worth cents and the
  point is the one that is not — so a valuable card is not allowed to scroll
  past silently.
- **Export CSV** writes the session with card id, set, printing, price and a
  TCGplayer link, plus a total row.
- **check printing** marks a scan whose artwork is shared with a differently
  priced reprint. One tap picks the right one.

## Tests

```bash
npm test
```

- **parity** — the index is built in Python and searched in TypeScript, so the
  two are pinned against each other over 250 real cards. A one-bit disagreement
  would not throw; it would quietly match the wrong card.
- **localise** — corner error against ground-truth quads, and what the match
  distance would be with a perfect quad. This is the test that found the real
  bottleneck.
- **pipeline** — end-to-end accuracy and latency over the full 20k index.
- **threshold** — sweeps the confidence gate, reporting dollars misquoted rather
  than just error counts.
- **reprint** — the same, restricted to cards that share artwork across sets
  with a ≥2× price gap, i.e. the only errors that cost anything.

Fixtures are hundreds of MB of raw frames and are not committed; `npm test`
reports which command regenerates any that are missing.

### On-device

Everything except VisionCamera can be checked on a phone without a camera:
reading the 1.96 MB index out of an asset, expanding the compact catalogue,
constructing the Scanner, and the speed of the pipeline in mobile JS. The app
runs a few bundled frames through the real code path at startup under `__DEV__`
and prints the result to the screen and to logcat:

```bash
python tools/export_device_fixture.py     # writes apps/mobile/assets/dev (gitignored)
npm run android --prefix apps/mobile
adb logcat -s ReactNativeJS | grep BulkSift
```

Run on an Android emulator it reports **4/4 correct** — Base Charizard at
$825.38, Shining Tyranitar at $4,249.99 and so on, at the same Hamming
distances as the desktop suite. So the asset path, the index, the catalogue
expansion and the whole recognition pipeline are confirmed on a device; only
the camera feed itself is not.

**Timings there are a floor, not a forecast.** A *release* build on that
emulator identifies a card in 213-322 ms (detect 90 / hash 117 / search 111);
the same debug build took 511-579 ms, and desktop takes 10 ms. An emulated
x86_64 CPU with software rendering is the slowest thing this will ever run on,
so real-phone numbers need a real phone — build a release APK before believing
any mobile timing, because debug Hermes runs without bytecode or optimisations.

That the stages come out evenly spread (90/117/111) rather than with one hot
spot is the useful signal: it says the cost is the JS engine itself, so the next
real gain would be moving the loops into a native module, not more micro-tuning.

## What the prices mean

Every number is the **TCGplayer market price for a raw Near Mint card**, in USD.
Condition moves real prices by 2–3×, and a card swiped past a lens cannot be
graded — the app says so rather than implying a grade it did not measure.

## Known gaps

- **Reprint pairs** are surfaced, not solved: 92% exact, and the rest is either
  flagged or worth cents. See above.
- **Error cards** (e.g. Base Set Charizard "Black Dot Error") exist as separate
  TCGplayer products but are not distinguishable by artwork.
- **Japanese cards** are not indexed. TCGCSV carries them as category 85 if that
  becomes worth doing.
- **The mobile camera path is unverified on a device.** The engine, the data and
  the whole app path are verified in the browser; VisionCamera's frame output
  needs a real build to confirm.
