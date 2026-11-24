# BulkSift

A US-market Pokémon TCG bulk scanner for iOS. Prop the phone over a table, pass
cards under it, and each one is recognised **entirely on the device** — no
network, no account, no per-scan server call — and lands in a collection with
its market price.

Bundle id `com.rldgames.bulksift`. App Store Connect app id **6800808960**.
Repo <https://github.com/KaanIpek/bulksift> (**public**, deliberately — see CI).

---

## Picking this up on a new machine

```bash
git clone https://github.com/KaanIpek/bulksift.git
cd bulksift && npm install && npm --prefix apps/mobile install
npm test          # expect: 26 passed, 0 failed
```

That is enough to build and ship the app. **`data/images/` (8.4 GB, 25,233 card
pictures) and `data/cache/` (47 MB of API responses) are gitignored and do NOT
come with the clone.** They are only needed to rebuild the index from scratch;
the built artifacts — `data/index.bin`, `data/cards.json`, and the staged copies
under `apps/mobile/assets/data/` — are tracked, so the app works immediately.

To rebuild the index on a fresh machine you must re-fetch the images first:

```bash
python tools/build_catalogue.py     # catalogue + prices from TCGplayer
python tools/download_images.py     # the 8.4 GB, resumable, throttled
python tools/build_index.py         # writes missing_images.json
python tools/fallback_images.py     # TCGplayer art for what pokemontcg.io lacks
python tools/build_index.py         # fold them in
npm run sync && python tools/build_thumbs.py
```

Order matters and the pipeline will not warn you if you get it wrong — see
"traps" below.

---

## Shape of the thing

- `packages/core/` — the engine, pure TypeScript, no React Native. Detect a card
  in a frame, rectify it, describe it as 742 bits, search 25,234 rows by Hamming
  distance. `packages/core/native/` is the same thing in C++ for the phone, kept
  bit-identical by a parity test.
- `apps/mobile/` — the Expo app. `src/core/` is a **copy** of the engine, written
  by `npm run sync`. Never edit it; edit `packages/core/src/` and sync.
- `tools/` — the Python data pipeline.
- `docs/` — SETUP.md (services), STORE_LISTING.md (App Store copy), and the
  privacy/support pages GitHub Pages serves.

Convention: pure logic and I/O live in separate files so the logic can be tested
in Node — `collection.ts`↔`collectionStore.ts`, `prices.ts`↔`pricesStore.ts`,
`merge.ts`↔`sync.ts`.

Tests: `npm test` runs 26 suites. Files named `_foo.ts` in `packages/core/test/`
are **measurement harnesses**, not tests — they are how every constant below was
chosen, and they are the tool to reach for before changing one.

---

## Decisions, and the measurement behind each

Nothing here is a preference. Each number came from a sweep, and the harness
that produced it is named so it can be re-run.

| Constant | Value | Why |
|---|---|---|
| `maxDistance` | 200 | Correct reads: median 38, p99 194. The sweep is flat from 200 up (94/100 at 200, 240, 300), so anything looser is pure false-positive surface. At 25k cards, 240 let a crumpled bedsheet read as a Double Colorless Energy. |
| `minNameMargin` | 24 | Bits the winner must beat the nearest **differently-named** card by. 40 made Basic Fire/Fighting Energy impossible (their ceiling is 37). `reachable.test.ts` guards it. |
| `VOTE_FRAMES` | 7 | Per-bit majority across frames, to defeat moving glare. Margin at 90% glare: 1 frame 104, 5 frames 122, **7 frames 124**, 13 frames 125. Flat after 7 — which also means "hold a shiny card longer" helps for about a quarter second and no more. |
| `VOTE_MAX_DRIFT` | 180 | Two frames belong together if their descriptors sit within this. Measured: same card under heavy glare reaches 148, different cards start at 226. |
| `CALIBRATE_LIMIT` / `OFFSET_LIMIT` | 0.24 / 0.16 | The standing crop correction. Raised because the device kept **saturating** the old 0.15/0.10 — a search parked on its bound has been cut off, not converged. |
| `GOOD_FILL` | 0.08 | When to say "a little closer". Read quality is flat from areaFrac 0.055 to 0.336; the old 0.28 nagged about cards that were about to read perfectly. The detector's own floor is 0.05. |

**The margin rule is the whole safety story.** A distance gate alone cannot tell
a card from a bedsheet, because *something* in 25,234 rows is always within 200
bits of noise. What separates them is whether the winner beats the nearest
differently-named rival — noise has no such structure.

**Money model.** 30 free scans a day, +10 per rewarded video (max 5/day), Pro
removes the limit, credit packs for people who will not subscribe. One
collection free, several with Pro. Competitor pricing and the reasoning are in
`docs/SETUP.md`; the short version is that the two direct rivals sell a **weekly**
subscription at $7.99, which annualises to ~$415, and their reviews say so.

**Freshness is not sold.** The whole price book is 0.26 MB gzipped, so serving it
costs cents. Charging for it would mean free users see stale numbers, and an app
whose numbers cannot be trusted is not worth paying for either.

**The repo is public on purpose.** GitHub bills macOS runners at 10× minutes, so
a few 11-minute builds exhaust a private repo's allowance and every dispatch then
dies in ~5 seconds with a message about *payments failing* — which is a quota
message, not a billing one. Public repos get unlimited macOS minutes. History was
audited before flipping: no `.p8`, no `.env`, no JWT was ever committed, and the
three keys in the source ship inside the app binary anyway.

---

## Traps this project has already fallen into

Each of these cost real time. They are in the code comments too, but start here.

1. **A harness must drive the shipped path.** A multi-frame vote measured +31
   bits in isolation and did *nothing* on the device — twice. First it keyed its
   ring on a field that a refused frame clears (and 99% of device frames are
   refused); then on a "same view" test that compares **brightness**, when glare
   *is* a brightness change. Both were invisible until the harness called the
   real `Scanner`. Vote depth is now on the diagnostic line for that reason.
2. **Rectify before you scale.** Three separate harnesses first shrank the whole
   frame instead of detecting and unwarping the card, so they described the table
   with a small card in it and reported total failure at every setting. A uniform
   0/N is the tell that the harness, not the idea, is broken.
3. **Two sources spell one card four ways.** `Thundurus - 50/113 (…)`,
   `Lurantis-GX` vs `Lurantis GX`, `Poké Ball` vs `Poke Ball`, and
   `Research (Sada)` vs `Research [Sada]`. Each made a card its own rival under
   the margin rule, and each was found only by measuring collisions. `baseName()`
   now cuts at either bracket, decomposes accents, folds case and punctuation.
4. **`build_thumbs.py` used to read the staged copy, not the source** — so it
   silently built a pack for the *previous* catalogue (25,234 in the index,
   20,468 in the pack, every new card blank). Fixed, but the class of bug is
   live: the pipeline has ordering dependencies it will not warn you about.
5. **Metro rejects a dynamic `require`,** and follows a literal one even inside a
   `try`. Native-only SDKs therefore go through `native.ts` / `native.web.ts`,
   which the resolver picks between. Adding an SDK any other way breaks the web
   build, and the web build is how every screen gets looked at.
6. **The build number was never bumped.** Every upload claimed to be build 20, so
   `altool` said "UPLOAD SUCCEEDED" (the bytes arrived) and Apple rejected the
   duplicate later by email. The workflow now stamps `run_number + 100`.

---

## Where it stands

**Working and shipped to TestFlight:** recognition with the glare vote and the
crop search, 25,655 cards across 194 sets, multi-collection, manual search, want
list, value history, CSV export, Apple + email sign-in, two-device sync with a
three-way merge, rewarded ads, RevenueCat purchases, App Tracking Transparency,
account deletion, a full-screen camera with a translucent dock, and a synthesised
ka-ching on every card.

**Connected:** AdMob, Supabase (+ deployed `delete-account` function), App Store
Connect products (all five), RevenueCat (all five packages, `pro` entitlement),
GitHub Pages for the privacy and support URLs. Details and keys: `docs/SETUP.md`.

### 2026-11-16 — repositioned as a sorting station (branch `sort-mode`, not on a device yet)

Market research that day (sources in `D:\cowork\RLDGames-Ops\CLAUDE.md`, "16 Nov 2026") changed
what this app is for. The short version:

- **"Scanner" is a lost position.** Rare Candy's scanner is free and unlimited with auto-scan,
  TCGplayer has Live Scan in beta for sellers, Collectr holds search with 5M+ installs.
  Realistic 12-month range for a new scanner: $100-$1,500/month; under $5K with ~85-90% odds.
- **The open comparison is hardware, not apps:** a $799 hopper (sold out) and a $3,000 robot at
  ~250 cards/hour. So the app now answers "which cards do I take OUT of the box", by ear.
- **`pokemontcg.io` is deprecated and its keys die on 1 March 2027.** Anything that still
  fetches from it (card art, catalogue rebuilds) must move before then.
- **Price data for a paid app:** TCGplayer's API is closed to new developers; JustTCG's paid
  plans ($19+/month) carry a commercial licence and allow server caching. Decide before launch.
- **Store risk:** Apple rejected an AI card scanner under 4.1 for brand elements in the name and
  screenshots; a disclaimer in the description was not enough. Keep the name neutral and keep
  card art out of the screenshots.

What was built (all in `apps/mobile`, 24 suites green, UI checked in the web target):

- `src/sort.ts` — three piles (bulk / keep / pull) from two lines the user sets with a thumb.
  Doubt resolves upward: an unpriced card is kept, and every card is judged by its **dearest**
  printing, because the camera matches artwork and cannot see foil. `test/sort.test.ts`.
- Three sounds, told apart by pitch, strike count and length (`tools/make_sounds.py`):
  `bulk.wav` low tick, `scan.wav` the bell (keep), `pull.wav` a rising triad. Pull also gets
  the success haptic so the stop signal survives a muted phone.
- Scan screen: a pile tag on every row and a PULL / KEEP / BULK strip under the totals.
  Settings → Sorting. The rule is saved in the collection file (`sort`, optional).
- **A paywall bug, fixed:** `onPixels` has an empty dependency list and called the `onHit`
  from the render the screen mounted with, so the allowance check read a snapshot taken when
  the tab was opened. The free limit never fired inside one sitting. Now read through a ref.
  **Not yet proven on a device** — the camera screen does not exist on web. Check it on the
  next TestFlight build: scan past the free allowance without leaving the tab and the paywall
  must appear.

Not done, and not mine to decide alone: prices (a Seller tier around $19.99/month with
TCGplayer/eBay CSV and a one-time "7 days unlimited" pass were the research's suggestion), and
the kill rule the research proposed — **90 days after launch, under ~$1K MRR or 50 paying
sellers, stop.**

### 2026-11-24 - the plan was questioned, and three things it had missed were fixed

The owner asked for the 16 November plan to be attacked rather than continued.
Applying to this app the same App Store measurement that had just killed another
idea, and reading the repository as a stranger would, turned up three defects
that mattered more than the store text the plan said was next.

**1. The prices were three months old and could never change.** `PRICE_HOST` was
`null`, so every build priced cards with the snapshot it shipped with (24 August).
Against today's feed, 1,326 of 24,776 cards (5.4%) fall in a different pile at
the default lines - 521 of them from keep up to pull. Fixed: a daily job
(`.github/workflows/prices.yml`) publishes the book on GitHub Pages and
`PRICE_HOST` points at it. Details and the ways to break it: `docs/SETUP.md`.

**2. The catalogue did not contain the two newest sets** - the ones people are
opening, and so the bulk they are sorting. Rebuilt: 25,655 cards across 194
sets, 421 more than before. The image CDN this pipeline was built on
(`images.pokemontcg.io`) no longer receives new sets at all: every card from
July 2026 onward 404s there and comes from `fallback_images.py` (the TCGplayer
product shot) instead. That path is now the main road for anything new, not a
fallback.

**3. A throttled rebuild wrote a catalogue with sets missing, and said so only
in a log line.** The price feed answers 401 when it has had enough, and
`build_catalogue.py` printed "FAILED" for each refused set and carried on - Base
Set, Jungle and Fossil were among the twenty-odd it dropped. It now backs off
properly, falls back to the cached copy of a set's product list, and refuses to
write anything if a set has neither. Run the data pipeline when the feed has not
been hit for a while; three price runs and a rebuild in one hour is too many.

Two smaller things the rebuild tripped over, both fixed: `fallback_images.py`
took its list of missing cards from a file the *next* step writes, so the first
pass after adding sets fetched nothing for them (it reads the disk now, one pass
is enough); and the fixture exporters still expected the old `cards.json` shape.
The calibrate suite counted an exact row as "correct" and failed on the new
sample with no card misread - three of its 25 frames were same-art twins - so it
now uses the rule the sequence suite uses: right card, any printing. 11 promo
cards whose TCGplayer product no longer exists dropped out of the catalogue.

**The store listing is drafted in App Store Connect** (name "BulkSift: TCG Card
Scanner", subtitle "Sort bulk by price, hands-free", description, keywords,
review notes, categories, age rating, URLs). Nothing is submitted.
**Build 138** carries all of the above; it is on TestFlight for the internal group
and attached to the 1.0 draft. Not yet on a phone: the paywall fix, the sort
sounds, the price refresh and the new sets are all unproven on a device. Why it leads
with "scanner" again, and what still blocks a submission: `docs/STORE_LISTING.md`.

**What the research said about getting customers, which changes the plan more
than any of the above.** Rating counts in this category are not revenue and
search is not the channel. Every scanner released since 2025 whose growth could
be traced buys its installs with Meta ads and meets them with a paywall in
onboarding and a weekly plan (HoloDex ~590 ads, FoilSnap ~120, Acorn ~64; Acorn
is one person and reports over $50K a month at 2.6x return on ad spend,
unaudited). Of ~36 scanners released since 2025, ~22 have under 110 ratings.
This app's offer - 30 free scans a day, $4.99 a month - is far more generous
than any of them and cannot pay for an install. So after the store launch the
question is not "will search find it" but "does a small paid test pay for
itself", and that needs two decisions that are the owner's: an ad budget, and a
tighter offer (fewer free scans, a weekly plan). Neither was changed.

### 2026-11-24, later - the paywall could not have passed review, and the paid test was costed

Asked to continue, I went to prepare the tighter offer and read the paywall as
a reviewer would first. Three defects, none of them about the offer:

**1. The subscribe button had no price.** One button, "Go Pro"; no amount, no
period, no choice between the monthly and the yearly plan. `subscribe()` bought
"whichever package is not a credit pack", which with two subscriptions on sale
is whichever the store lists first. App Review rejects that under guideline
3.1.2, and build 138 - attached to the 1.0 draft - had it. Now: `plans.ts`
(pure, tested) turns what the store returns into rows with price and period, a
button that names what it charges ("Subscribe for $29.99 / year"), the renewal
sentence, and Terms / Privacy links. A free trial is mentioned only when the
store says this customer can still have one. Nothing in the app contains a
price.

**2. The Pro list sold something free.** "Weekly price updates" - prices refresh
daily for everyone. Removed.

**3. A new day was only noticed at cold start.** `refill` ran in `load()` and
nowhere else, and so did the once-a-day price check. iOS keeps a suspended app
for days: run out on Monday, come back Tuesday without force-quitting, and the
paywall still said "your free scans come back tomorrow". Both now run when the
app returns to the front, and the allowance again at each scan. (This also
means the build-138 test note's "the price date moves by itself" was only true
after a force-quit.)

**The tighter offer exists and is switched off.** `offer.ts` holds two offers:
`launch` (30 a day, 5 videos, no paywall until the scans run out) and `tight`
(10 a day, 3 videos, the paywall introduced once before the first scan, weekly
plan preselected if one exists). `docs/offer.json` on the Pages site names the
live one and says `launch`. It can only name an offer that shipped - it cannot
supply numbers - and with no answer a phone keeps the offer it had. Switching
is one word and a push; it is the owner's decision and nobody else's.
`entitlement.ts` gained `CEILING` (what a saved file is trusted up to),
`setLimits` and `retune`; credits are never touched by an offer.

**The paywall can now be looked at without a phone.** In a development web
build, `?demo=settings` (or `out-of-scans`, or `welcome&offer=tight&weekly=1`)
opens it with sample plans. `docs/review/paywall-web-preview.jpg` is that
render. A screenshot taken while the sheet is sliding in shows it a fifth of
the way up - the preview pane's animation clock stalls when hidden - so measure
the sheet's rectangle before believing a picture of it.

**What a paid test would cost, before spending anything: `docs/PAID_TEST.md`.**
At published medians a paid install loses money under either offer: about $177
per paying customer on the launch offer against $25-51 of revenue, and about
break-even after a year on the tight one if it converted like a hard paywall,
which it is not. A $500 test buys ~109 installs and cannot measure the paying
rate (3 payers is consistent with 1% to 8%); it can measure the cost of a
started trial, and the line is **under about $14**. Running it needs the
owner's decisions on budget, the live offer, a weekly product and its price,
and whether the Meta SDK goes in (without it Meta optimises for clicks, not
installs).

### Next, in the order I would do it

1. **The remaining recognition gap — needs one real frame.** Holos and Special
   Illustration Rares still read slowly or not at all. Four hypotheses were
   measured: glare (fixed), crop misalignment (fixed), the index's own ceiling
   for SIRs (**refuted** — they are the *most* distinctive cards in the
   catalogue, median ceiling 276 against 195 for a Common), and detection
   resolution (**refuted** — 5 bits for 2–5× the frame cost). The device reports
   ~230 where anything reproducible on a desk sits near 80, and the screenshots
   show why nothing synthetic reaches it: motion blur, a toploader's reflection
   and dim warm light, all at once. **Settings → Diagnostics → Capture a failing
   read** writes the rectified card the engine actually saw; that file dropped
   into the harnesses settles it. Do not guess further without it — the record
   for guessing here is 2 refuted out of 4.
2. **Framing brackets.** They are a fixed box and do not follow the card. Drawing
   them on the detected quad needs a frame→screen mapping including a 90°
   rotation (landscape buffer, portrait preview), which cannot be verified
   without a device. Verify with engine-reported coordinates, not by eyeballing
   a screenshot.
3. **Japanese cards cannot be read at all** — the catalogue is English-only, 191
   sets, exactly one card with a Japanese character in its name. Adding them is a
   separate catalogue and US prices do not apply. A product decision, not a bug.
4. **Price hosting.** Done 2026-11-24, see above and `docs/SETUP.md`.
5. **Store submission.** The text is in App Store Connect as a draft. Left, all
   needing the phone or the owner: six screenshots and one of the paywall, the
   content rights answer, the App Privacy questionnaire, and the owner's yes.
   The list is in `docs/STORE_LISTING.md`. Submit a build that has the priced
   paywall (139 or later), never 138.
6. **AdMob payment profile**, or the rewarded unit serves nothing.

---

## Working agreements

- **Measure, then change.** Every constant above has a harness. When a
  measurement contradicts the plan, the measurement wins — two of four
  recognition hypotheses were killed this way, each saving a pointless rebuild.
- **Batch the builds.** Finish everything, then fire one. Builds are free but
  they are not instant.
- **Comments say _why_, with the number.** The sweep that chose a value belongs
  next to it, including the failures — the value is the least interesting part.
- **Nothing outward-facing without asking.** Publishing, purchases, account
  settings and anything irreversible get confirmed first.
