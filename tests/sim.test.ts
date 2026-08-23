import { describe, expect, it } from 'vitest';
import { World } from '../src/game/world';
import { BASES, UNITS, baseStats } from '../src/game/balance';
import type { LevelDef, BaseKind, Faction } from '../src/core/types';

/** Minimal two-base map so each rule can be tested on its own. */
function duel(
  a: { kind: BaseKind; owner: Faction; garrison: number; level?: number },
  b: { kind: BaseKind; owner: Faction; garrison: number; level?: number },
  gap = 200,
): LevelDef {
  return {
    id: 'test',
    name: 'test',
    brief: '',
    difficulty: 'recruit',
    width: 400,
    height: 4000,
    bases: [
      { x: 200, y: 2000 + gap / 2, ...a },
      { x: 200, y: 2000 - gap / 2, ...b },
    ],
    roads: [[0, 1]],
  };
}

/** Both sides need to still exist or the match ends and the clock stops, so
 *  tests about friendly movement park a spare base for each side far away. */
function withSpectators(level: LevelDef): LevelDef {
  const bases = [...level.bases];
  const owners: Faction[] = ['player', 'enemy'];
  for (const owner of owners) {
    if (!bases.some((b) => b.owner === owner)) {
      bases.push({ x: 20, y: 20 + bases.length * 40, kind: 'barracks', owner, garrison: 5 });
    }
  }
  return { ...level, bases };
}

function run(w: World, seconds: number, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) w.update(step);
}

describe('production', () => {
  it('fills a garrison at the base rate and stops at capacity', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 0 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    run(w, 10);
    const expected = BASES.barracks.production * 10;
    expect(w.bases[0].garrison).toBeCloseTo(expected, 1);

    run(w, 200);
    expect(w.bases[0].garrison).toBe(BASES.barracks.capacity);
  });

  it('lets neutral ground regrow, but slowly', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'neutral', garrison: 0 }, { kind: 'barracks', owner: 'player', garrison: 5 }));
    run(w, 10);
    expect(w.bases[0].garrison).toBeGreaterThan(0);
    expect(w.bases[0].garrison).toBeLessThan(BASES.barracks.production * 10);
  });
});

describe('orders', () => {
  it('sends half the garrison and leaves the rest at home', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 20 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    const q = w.send(0, 1, 'player');
    expect(q?.count).toBe(10);
    expect(w.bases[0].garrison).toBe(10);
    expect(w.squads).toHaveLength(1);
  });

  it('refuses orders from a base you do not own', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'enemy', garrison: 20 }, { kind: 'barracks', owner: 'player', garrison: 5 }));
    expect(w.send(0, 1, 'player')).toBeNull();
    expect(w.squads).toHaveLength(0);
  });

  it('refuses a send with nobody to send and refuses self-targeting', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 1 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    expect(w.send(0, 1, 'player')).toBeNull();
    expect(w.send(0, 0, 'player')).toBeNull();
  });
});

describe('movement and arrival', () => {
  it('reinforces a friendly base on arrival', () => {
    const w = new World(withSpectators(duel({ kind: 'barracks', owner: 'player', garrison: 30 }, { kind: 'barracks', owner: 'player', garrison: 0 })));
    w.send(0, 1, 'player');
    run(w, 12);
    expect(w.squads).toHaveLength(0);
    expect(w.bases[1].garrison).toBeGreaterThan(14);
  });

  it('keeps combat value, not headcount, when troops retrain', () => {
    // Tanks reinforcing a barracks become a larger number of infantry.
    const level = withSpectators(
      duel({ kind: 'factory', owner: 'player', garrison: 20 }, { kind: 'barracks', owner: 'player', garrison: 0 }),
    );
    const w = new World(level, 7);
    w.send(0, 1, 'player');
    // Ten tanks are worth 26 infantry, so the barracks gains far more heads
    // than it received bodies.
    const arrival = 200 / UNITS.tank.speed;
    run(w, arrival + 0.5);
    expect(w.bases[1].garrison).toBeGreaterThan(10 * UNITS.tank.weight * 0.9);
  });

  it('lets reinforcements stack a garrison above its ceiling', () => {
    // Production stops at capacity, but marching troops in does not. Massing
    // beyond the ceiling is the only way to break a fortified line.
    const w = new World(withSpectators(duel({ kind: 'hq', owner: 'player', garrison: 80 }, { kind: 'barracks', owner: 'player', garrison: 55 })));
    w.send(0, 1, 'player');
    run(w, 20);
    expect(w.bases[1].garrison).toBeGreaterThan(BASES.barracks.capacity);
  });

  it('still refuses to produce past the ceiling', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 59 }, { kind: 'barracks', owner: 'enemy', garrison: 20 }));
    run(w, 30);
    expect(w.bases[0].garrison).toBe(BASES.barracks.capacity);
  });
});

describe('assault', () => {
  it('captures a weakly held base and garrisons the survivors', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 60 }, { kind: 'barracks', owner: 'enemy', garrison: 4 }));
    w.send(0, 1, 'player');
    run(w, 20);
    expect(w.bases[1].owner).toBe('player');
    expect(w.bases[1].garrison).toBeGreaterThan(0);
    expect(w.stats.basesTaken).toBe(1);
  });

  it('breaks on a garrison that is too strong, leaving the base held', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 10 }, { kind: 'barracks', owner: 'enemy', garrison: 50 }));
    w.send(0, 1, 'player');
    run(w, 20);
    expect(w.bases[1].owner).toBe('enemy');
    expect(w.squads).toHaveLength(0);
  });

  it('gives the defender a real home advantage', () => {
    // Equal numbers, equal units: the attack should fail on fortification alone.
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 40 }, { kind: 'barracks', owner: 'enemy', garrison: 20 }));
    w.send(0, 1, 'player');
    run(w, 25);
    expect(w.bases[1].owner).toBe('enemy');
  });

  it('reports a lost base in the run stats', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'enemy', garrison: 60 }, { kind: 'barracks', owner: 'player', garrison: 3 }));
    w.send(0, 1, 'enemy');
    run(w, 20);
    expect(w.bases[1].owner).toBe('enemy');
    expect(w.stats.basesLost).toBe(1);
  });
});

describe('rock paper scissors', () => {
  /** March equal combat value at each other and see who is left standing. */
  /** Send equal *combat value* from each side, not equal headcount, so the
   *  only thing left to decide the fight is the matchup table. */
  function clash(a: BaseKind, b: BaseKind, value = 40) {
    const unitA = BASES[a].unit;
    const unitB = BASES[b].unit;
    const heads = (k: BaseKind) => Math.round((2 * value) / UNITS[BASES[k].unit].weight);
    const gap = 700;
    const w = new World(
      duel({ kind: a, owner: 'player', garrison: heads(a) }, { kind: b, owner: 'enemy', garrison: heads(b) }, gap),
      3,
    );
    w.send(0, 1, 'player');
    w.send(1, 0, 'enemy');
    // Stop shortly after the columns meet. A wide gap keeps the winner from
    // walking on and storming the far base, which would empty the squad list
    // and make the comparison meaningless.
    const contact = gap / (UNITS[unitA].speed + UNITS[unitB].speed);
    run(w, contact + 2.5);
    const player = w.squads.find((q) => q.owner === 'player');
    const enemy = w.squads.find((q) => q.owner === 'enemy');
    return {
      player: (player?.count ?? 0) * UNITS[BASES[a].unit].weight,
      enemy: (enemy?.count ?? 0) * UNITS[BASES[b].unit].weight,
    };
  }

  it('lets tanks roll over infantry of equal combat value', () => {
    const r = clash('factory', 'barracks');
    expect(r.player).toBeGreaterThan(r.enemy);
  });

  it('lets infantry shoot down helicopters of equal combat value', () => {
    const r = clash('barracks', 'airbase');
    expect(r.player).toBeGreaterThan(r.enemy);
  });

  it('lets helicopters gut tanks of equal combat value', () => {
    const r = clash('airbase', 'factory');
    expect(r.player).toBeGreaterThan(r.enemy);
  });

  it('ends a mirror match close to even', () => {
    const r = clash('barracks', 'barracks');
    expect(Math.abs(r.player - r.enemy)).toBeLessThan(6);
  });
});

describe('turrets', () => {
  it('shells a hostile column that walks into range', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 60 }, { kind: 'turret', owner: 'enemy', garrison: 30 }, 300));
    const q = w.send(0, 1, 'player')!;
    const sent = q.count;
    run(w, 4);
    const live = w.squads.find((s) => s.id === q.id);
    expect(live).toBeDefined();
    expect(live!.count).toBeLessThan(sent);
    expect(w.fx.some((f) => f.t === 'tracer')).toBe(true);
  });

  it('holds fire when nothing hostile is in range', () => {
    const w = new World(duel({ kind: 'turret', owner: 'player', garrison: 30 }, { kind: 'barracks', owner: 'enemy', garrison: 30 }, 900));
    run(w, 5);
    expect(w.fx.some((f) => f.t === 'tracer')).toBe(false);
  });
});

describe('upgrades', () => {
  it('spends the garrison and raises capacity and output', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 50 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    const cost = w.upgradeCost(w.bases[0]);
    const capBefore = w.capacityOf(w.bases[0]);
    expect(w.upgrade(0, 'player')).toBe(true);
    expect(w.bases[0].garrison).toBe(50 - cost);
    expect(w.bases[0].level).toBe(2);
    expect(w.capacityOf(w.bases[0])).toBeGreaterThan(capBefore);
    expect(baseStats('barracks', 2).production).toBeGreaterThan(BASES.barracks.production);
  });

  it('refuses an upgrade you cannot pay for or do not own', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 5 }, { kind: 'barracks', owner: 'enemy', garrison: 50 }));
    expect(w.upgrade(0, 'player')).toBe(false);
    expect(w.upgrade(1, 'player')).toBe(false);
  });

  it('stops at the maximum level', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 500, level: 3 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    expect(w.upgrade(0, 'player')).toBe(false);
  });
});

describe('match end', () => {
  it('calls victory once no enemy base or column is left', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 60 }, { kind: 'barracks', owner: 'enemy', garrison: 2 }));
    w.send(0, 1, 'player');
    run(w, 20);
    expect(w.outcome).toBe('victory');
  });

  it('calls defeat once the player is wiped out', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'enemy', garrison: 60 }, { kind: 'barracks', owner: 'player', garrison: 2 }));
    w.send(0, 1, 'enemy');
    run(w, 20);
    expect(w.outcome).toBe('defeat');
  });

  it('stops simulating after the match is decided', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 60 }, { kind: 'barracks', owner: 'enemy', garrison: 2 }));
    w.send(0, 1, 'player');
    run(w, 20);
    const snapshot = w.stats.elapsed;
    run(w, 5);
    expect(w.stats.elapsed).toBe(snapshot);
  });
});

describe('fixed timestep', () => {
  it('reaches the same state whatever the frame rate', () => {
    const build = () =>
      new World(duel({ kind: 'barracks', owner: 'player', garrison: 40 }, { kind: 'barracks', owner: 'enemy', garrison: 30 }), 5);
    const smooth = build();
    const choppy = build();
    smooth.send(0, 1, 'player');
    choppy.send(0, 1, 'player');
    for (let i = 0; i < 600; i++) smooth.update(1 / 60);
    for (let i = 0; i < 200; i++) choppy.update(1 / 20);
    expect(choppy.bases[1].garrison).toBeCloseTo(smooth.bases[1].garrison, 6);
    expect(choppy.bases[1].owner).toBe(smooth.bases[1].owner);
  });

  it('does not let a long stall fast-forward the whole battle', () => {
    const w = new World(duel({ kind: 'barracks', owner: 'player', garrison: 0 }, { kind: 'barracks', owner: 'enemy', garrison: 5 }));
    w.update(30);
    expect(w.stats.elapsed).toBeLessThanOrEqual(0.26);
  });
});
