import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { AiCommander, type Difficulty } from '../src/game/ai';
import { CAMPAIGN, SKIRMISH } from '../src/game/levels';
import type { CampaignLevel } from '../src/game/levels';

const STEP = 1 / 60;

/** Play a level out with a commander on one or both sides. */
function play(
  level: CampaignLevel,
  opts: { enemy?: Difficulty | null; player?: Difficulty | null; seconds: number; seed?: number },
) {
  const w = new World(level, opts.seed ?? 4242);
  const bots: AiCommander[] = [];
  if (opts.enemy) bots.push(new AiCommander(w, opts.enemy, 'enemy', (opts.seed ?? 4242) + 1));
  if (opts.player) bots.push(new AiCommander(w, opts.player, 'player', (opts.seed ?? 4242) + 2));
  const ticks = Math.round(opts.seconds / STEP);
  for (let i = 0; i < ticks; i++) {
    for (const bot of bots) bot.update(STEP);
    w.update(STEP);
    w.fx.length = 0;
    if (w.outcome !== 'playing') break;
  }
  return w;
}

describe('campaign integrity', () => {
  it('gives every level a unique id and a name', () => {
    const ids = new Set(CAMPAIGN.map((l) => l.id));
    expect(ids.size).toBe(CAMPAIGN.length);
    expect(CAMPAIGN.every((l) => l.name.length > 0 && l.brief.length > 0)).toBe(true);
  });

  it('starts every level with both sides on the board', () => {
    for (const level of CAMPAIGN) {
      expect(level.bases.some((b) => b.owner === 'player'), level.id).toBe(true);
      expect(level.bases.some((b) => b.owner === 'enemy'), level.id).toBe(true);
    }
  });

  it('keeps every base inside the map and every road pointing at a real base', () => {
    for (const level of CAMPAIGN) {
      for (const b of level.bases) {
        expect(b.x, level.id).toBeGreaterThanOrEqual(0);
        expect(b.x, level.id).toBeLessThanOrEqual(level.width);
        expect(b.y, level.id).toBeGreaterThanOrEqual(0);
        expect(b.y, level.id).toBeLessThanOrEqual(level.height);
      }
      for (const [a, b] of level.roads) {
        expect(level.bases[a], `${level.id} road ${a}`).toBeDefined();
        expect(level.bases[b], `${level.id} road ${b}`).toBeDefined();
        expect(a).not.toBe(b);
      }
    }
  });

  it('never overlaps two bases', () => {
    for (const level of CAMPAIGN) {
      for (let i = 0; i < level.bases.length; i++) {
        for (let j = i + 1; j < level.bases.length; j++) {
          const a = level.bases[i];
          const b = level.bases[j];
          expect(Math.hypot(a.x - b.x, a.y - b.y), `${level.id} ${i}/${j}`).toBeGreaterThan(70);
        }
      }
    }
  });

  it('ramps difficulty forwards, never backwards', () => {
    const order: Difficulty[] = ['recruit', 'veteran', 'elite', 'legend'];
    let seen = 0;
    for (const level of CAMPAIGN) {
      const rank = order.indexOf(level.difficulty);
      expect(rank, level.id).toBeGreaterThanOrEqual(seen);
      seen = rank;
    }
  });
});

describe('the enemy commander', () => {
  it('expands onto neutral ground when left alone', () => {
    const level = CAMPAIGN[1];
    const before = level.bases.filter((b) => b.owner === 'enemy').length;
    const w = play(level, { enemy: 'veteran', seconds: 90 });
    expect(w.basesOf('enemy').length).toBeGreaterThan(before);
  });

  it('wins outright against a player who never gives an order', () => {
    // Chosen from the back half of the campaign, where the map is meant to
    // favour the enemy. The opening levels are deliberately forgiving.
    const w = play(CAMPAIGN[8], { enemy: 'elite', seconds: 900 });
    expect(w.outcome).toBe('defeat');
  });

  it('answers an attack instead of ignoring it', () => {
    const level = CAMPAIGN[1];
    const w = new World(level, 8);
    const bot = new AiCommander(w, 'elite', 'enemy', 9);
    // Let both sides settle, then find the sides by who owns what rather
    // than by index: the level data is solved by a script and its ordering
    // is not a promise.
    for (let i = 0; i < 240; i++) {
      bot.update(STEP);
      w.update(STEP);
      w.fx.length = 0;
    }
    const attacker = w.basesOf('player').sort((a, b) => b.garrison - a.garrison)[0];
    const victim = w
      .basesOf('enemy')
      .sort(
        (a, b) =>
          Math.hypot(a.x - attacker.x, a.y - attacker.y) -
          Math.hypot(b.x - attacker.x, b.y - attacker.y),
      )[0];
    expect(attacker, 'the player still holds something').toBeDefined();
    expect(victim, 'the enemy still holds something').toBeDefined();

    // Throw everything at one enemy base and watch for a relief column.
    w.send(attacker.id, victim.id, 'player', 1);
    let relief = false;
    for (let i = 0; i < 900 && !relief; i++) {
      bot.update(STEP);
      w.update(STEP);
      w.fx.length = 0;
      relief = w.squads.some((q) => q.owner === 'enemy' && q.toId === victim.id);
    }
    expect(relief).toBe(true);
  });

  it('spends surplus troops on upgrades at the higher tiers', () => {
    const w = play(CAMPAIGN[1], { enemy: 'elite', seconds: 200 });
    expect(w.basesOf('enemy').some((b) => b.level > 1)).toBe(true);
  });

  it('never spends troops on upgrades at the easiest tier', () => {
    const level = CAMPAIGN[4];
    const started = new Map(
      level.bases.map((b, i) => [i, b.level ?? 1] as const),
    );
    const w = play(level, { enemy: 'recruit', seconds: 300 });
    for (const b of w.basesOf('enemy')) {
      expect(b.level, `base ${b.id}`).toBeLessThanOrEqual(started.get(b.id) ?? 1);
    }
  });
});

describe('difficulty actually differs', () => {
  // A tier that cannot beat the one below it is decoration. scripts/ladder.ts
  // plays the full round-robin on a mirrored map; this pins the ends of it.
  const seeds = [11, 29, 57, 83, 101];

  /** Wins for the enemy side, on the mirrored map where position is even. */
  function tierDuel(enemy: Difficulty, player: Difficulty) {
    let wins = 0;
    for (const seed of seeds) {
      const w = play(SKIRMISH, { enemy, player, seconds: 900, seed });
      if (w.outcome === 'defeat') wins++;
    }
    return wins;
  }

  it('lets a legend commander beat a recruit one every time', () => {
    expect(tierDuel('legend', 'recruit')).toBe(seeds.length);
  });

  it('lets a legend commander beat a veteran one', () => {
    expect(tierDuel('legend', 'veteran')).toBeGreaterThanOrEqual(4);
  });

  it('lets an elite commander beat a veteran one', () => {
    expect(tierDuel('elite', 'veteran')).toBeGreaterThanOrEqual(3);
  });

  it('takes neutral ground rather than hesitating over it', () => {
    // Being cautious about an undefended outpost is how a strong commander
    // loses to a weak one, so the land-grab threshold is its own setting.
    const w = play(SKIRMISH, { enemy: 'legend', seconds: 150, seed: 31 });
    expect(w.basesOf('neutral').length).toBeLessThan(2);
  });
});

describe('every level can actually be won', () => {
  // The real gate is scripts/balance-campaign.ts, which plays five seeds per
  // level and weakens the enemy until a strong commander can win. This is the
  // regression guard for it: if a balance change makes a map unwinnable, this
  // fails and the script needs re-running.
  for (const level of CAMPAIGN) {
    it(`is winnable: ${level.name}`, () => {
      let won = false;
      for (const seed of [3, 77, 512]) {
        const w = play(level, { enemy: level.difficulty, player: 'legend', seconds: 900, seed });
        if (w.outcome === 'victory') {
          won = true;
          break;
        }
      }
      expect(won, `${level.id} was not winnable — re-run scripts/balance-campaign.ts`).toBe(true);
    });
  }
});
