# Frontline

A tower-defence and territory-capture strategy game for phones. Bases make
troops, you drag them at your neighbours, and columns that meet in the snow
fight it out. Twelve missions, three fighting arms, one thumb.

Built as a web game and wrapped for Android and iOS with Capacitor, so the
same build runs in a browser, installs to a home screen, and ships to a
store. The whole thing is about 20 kB gzipped and works offline.

## Playing it

- **Drag** from a base you own onto another base to send half its garrison.
- **Tap** several of your bases first and the drag sends all of them at
  once — a two-pronged attack is one gesture.
- **Hold** a base to open it and spend troops on a permanent upgrade.
- **Pinch** to zoom, **drag on open ground** to pan.

Bases fill to a ceiling on their own. Marching troops in can stack a
garrison higher than that, which is the only way to gather enough force to
break a defended line — but the surplus drains away, so a massed army is a
window to attack through rather than a wall to sit behind.

Three arms, and each beats one of the others: **tanks** crush **infantry**,
infantry shoot down **helicopters**, helicopters gut tanks. Gun
emplacements and headquarters shell anything hostile that comes near.
Fortifications wear out over a few minutes, so a stalemate resolves itself
even if neither side forces it.

## Running it

```bash
npm install
npm run dev            # play it at localhost:5173
npm test               # the rules
npm run test:browser   # the actual build, driven in a real browser
npm run build          # production bundle in dist/
```

Mobile:

```bash
npx cap add android    # or ios
npm run cap:sync       # build and copy into the native shell
npx cap open android
```

## How it is put together

```
src/
  core/      types and a seeded random generator — no DOM, no canvas
  game/      the simulation: balance numbers, world rules, the enemy
             commander, the campaign, saved progress
  render/    camera, procedural terrain, sprites, effects, the renderer
  ui/        touch handling, menus, HUD
  audio/     sound, synthesised at runtime
scripts/     balance tooling and the browser harness
tests/       the rules and the campaign, run headless
```

The simulation runs headless on a fixed timestep with seeded randomness, so
a battle plays out identically whatever the frame rate and a replayed level
unfolds the same way twice. That is what makes everything below possible:
the game can play itself thousands of times in a few seconds.

### Combat

Fighting runs on **Lanchester's square law** — a body of troops brings its
whole headcount to bear, so doubling an army roughly quadruples what it can
kill. Two consequences shaped the rest of the design.

Unit weights are `sqrt(dps * hp)` rather than hand-picked numbers. Under the
square law that makes the matchup table the *only* thing that decides an
even fight, so rock-paper-scissors holds at equal combat value instead of
drowning in stat creep, and retraining troops between unit types is exactly
fair.

Everything one side has on a base fights as a single body. Resolving each
column separately meant two waves of thirty hit like thirty twice over
rather than like sixty, which made massing pointless and turtling
unbeatable. Pooling the assault is what made attacking viable at all.

### The enemy commander

Its settings are not guesses. `scripts/sweep.ts` plays candidate policies
against each other on a mirrored map and ranks them by win rate; the winner
became the top difficulty tier, and the lower tiers are that policy degraded
along the axes the tournament showed actually matter — how much a base holds
back, how big an edge it demands before attacking, how often it thinks, and
whether it banks anything into upgrades.

`scripts/ladder.ts` plays the full round-robin and prints the result. A tier
that cannot beat the one below it is decoration, and the current table is
strictly monotone.

The sweep also caught the bug that had a "better" commander losing to a
worse one: it treated an undefended outpost like a fortified position. Early
expansion decides these matches, so neutral ground has its own, much lower,
threshold.

### The campaign

`npm run balance` (`scripts/balance-campaign.ts`) solves the twelve maps onto
a difficulty curve and writes the numbers back into `src/game/levels.ts`. It
tunes two things and nothing else — what level each base starts at, and how
full its garrison is. Positions, kinds and ownership stay as authored,
because those are design rather than arithmetic.

Then it stops trusting the model and **plays each map five times**. A strong
commander has to win it often enough, and the opening three missions have to
be winnable by the *weakest* commander in the game as well, because somebody
meeting this for the first time throws half a garrison at whatever is
nearest and hopes.

That second gate earns its keep. Two maps priced out perfectly fair and were
unwinnable anyway, because of where the ground lay rather than what was on
it. The model is a decent guess and a poor referee; only the playtest
decides what ships.

Re-run it after changing anything in `src/game/balance.ts`, then run the
tests.

### Art

There are no asset files. Snow slabs, drifts, roads, pines, boulders and the
mountain range are all generated, the unit sprites are drawn into small
offscreen canvases at startup, and every sound is synthesised at runtime.
Nothing to download, nothing to licence, nothing to keep in step.

The camera tilts and squashes the ground plane to fake a low angle. Anything
meant to stand up out of the ground is drawn taller by the inverse of that
squash so it comes out upright; units skip the problem entirely by being
blitted in screen space. The ground tilts, the soldiers standing on it do
not.

The camera fits the map's *width*, never its height. A phone in portrait is
far taller than these maps are deep, and matching the height crops the
flanks off the battlefield — the one thing a strategy game cannot do.

## Testing

`npm test` runs 53 headless tests: the combat rules, production and
capture, the rock-paper-scissors table at equal combat value, turrets,
upgrades, frame-rate independence, the difficulty ladder, and a winnability
check on all twelve maps.

`npm run test:browser` builds the game and drives the real thing through
Chromium: the menus, an order given by dragging, an upgrade bought once its
garrison affords it, and a mission played through to its result. Screenshots
land in `shots/`.

## Licence

MIT. See `LICENSE`.
