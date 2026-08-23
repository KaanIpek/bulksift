import type { Base, Faction } from '../core/types';
import { Rng } from '../core/rng';
import { BASES, MAX_LEVEL, SEND_FRACTION, UNITS, defenceAt, stormingStrength } from './balance';
import type { World } from './world';

export type Difficulty = 'recruit' | 'veteran' | 'elite' | 'legend';

export interface AiProfile {
  /** Seconds between decisions. A slower commander is an easier one. */
  interval: number;
  /** Strength edge demanded before storming a base the enemy holds. */
  safety: number;
  /** Edge demanded before taking neutral ground. Much lower, and it must be:
   *  a neutral garrison never counter-attacks and never gets reinforced, so
   *  hesitating over one just hands the map to whoever moved first. Early
   *  expansion decides these matches, and treating a quiet outpost like a
   *  fortified enemy position is how a "better" commander loses to a worse
   *  one that simply grabbed the ground. */
  landgrab: number;
  /** Chance a qualifying attack is actually launched this cycle. */
  nerve: number;
  /** Garrison a base keeps back before it will attack at all. */
  reserve: number;
  /** Whether the commander spends troops on upgrades. */
  upgrades: boolean;
  /** How much it prefers taking undefended ground over hitting the player. */
  expansion: number;
}

/** A rear base this full pushes its surplus towards the fighting. */
const FORWARD_AT = 0.8;

/** Share of a garrison sent when the base is safely behind the line. */
const COMMIT_SAFE = 0.85;

/** A hostile base closer than this makes a base a front-line base. */
const FRONT_RANGE = 380;

/** Share of its ceiling a front-line base keeps at home no matter what.
 *  Without this the commander dribbles its whole army out in small packets
 *  and hands over empty bases to the first raid that wanders past. */
const HOME_GUARD = 0.38;

/** These are not guesses. `scripts/sweep.ts` plays policies against each
 *  other on a mirrored map and ranks them; `legend` is the policy that came
 *  out on top, and the lower tiers are that policy degraded along the axes
 *  the tournament showed actually matter — how much a base holds back, how
 *  big an edge it demands before attacking, how often it thinks, and whether
 *  it banks anything into upgrades. Re-run the sweep after touching combat. */
const PROFILES: Record<Difficulty, AiProfile> = {
  recruit: { interval: 3.8, safety: 1.25, landgrab: 1.6, nerve: 0.55, reserve: 20, upgrades: false, expansion: 1.2 },
  veteran: { interval: 2.8, safety: 1.55, landgrab: 1.35, nerve: 0.82, reserve: 11, upgrades: true, expansion: 1.3 },
  elite: { interval: 2.2, safety: 1.9, landgrab: 1.2, nerve: 0.95, reserve: 5, upgrades: true, expansion: 1.4 },
  legend: { interval: 2.0, safety: 2.2, landgrab: 1.1, nerve: 1.0, reserve: 2, upgrades: true, expansion: 1.4 },
};

/** How badly the commander wants to own each kind of base. */
const PRIZE: Record<string, number> = {
  hq: 3.0,
  turret: 2.1,
  factory: 1.9,
  airbase: 1.7,
  barracks: 1.0,
};

/** An opposing commander. Given a world it issues the same orders a player
 *  would: march troops, defend what is threatened, and bank spare production
 *  into upgrades. It reads only what a player can see. */
export class AiCommander {
  private readonly profile: AiProfile;
  private timer: number;
  private rng: Rng;

  constructor(
    private readonly world: World,
    difficulty: Difficulty,
    private readonly side: Faction = 'enemy',
    seed = 991,
    /** Used by the balance sweep in scripts/ to search for better play. */
    overrides?: Partial<AiProfile>,
  ) {
    this.profile = { ...PROFILES[difficulty], ...overrides };
    this.rng = new Rng(seed);
    // Stagger the first move so the opening is not identical every run.
    this.timer = this.profile.interval * this.rng.range(0.3, 1);
  }

  update(dt: number): void {
    if (this.world.outcome !== 'playing') return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = this.profile.interval;
    this.decide();
  }

  private decide(): void {
    const mine = this.world.basesOf(this.side);
    if (mine.length === 0) return;

    const threatened = this.defend(mine);
    for (const from of mine) {
      if (threatened.has(from.id)) continue;
      // Failing an attack, a full rear base ships its surplus to the front
      // rather than sitting at its ceiling wasting production.
      if (!this.offend(from)) this.forward(from, mine);
    }
    if (this.profile.upgrades) this.improve(mine, threatened);
  }

  /** Feed bases that have hostile columns bearing down on them. */
  private defend(mine: Base[]): Set<number> {
    const threatened = new Set<number>();
    for (const b of mine) {
      const incoming = this.incomingStrength(b);
      if (incoming <= 0) continue;
      const held =
        this.holdStrength(b) *
        Math.sqrt(defenceAt(b.kind, b.level, this.world.stats.elapsed));
      if (held >= incoming * 1.15) {
        threatened.add(b.id);
        continue;
      }
      threatened.add(b.id);
      // Pull from the nearest base that can spare troops without collapsing.
      const helpers = mine
        .filter((o) => o.id !== b.id && o.garrison > this.profile.reserve)
        .sort((p, q) => this.dist(p, b) - this.dist(q, b));
      for (const helper of helpers) {
        if (this.incomingStrength(helper) > 0) continue;
        // A relief column may strip the helper below its own guard: the base
        // under attack is the more urgent of the two.
        const relief = Math.floor(helper.garrison * SEND_FRACTION);
        if (relief < 1) continue;
        this.world.sendCount(helper.id, b.id, this.side, relief);
        threatened.add(helper.id);
        break;
      }
    }
    return threatened;
  }

  /** Look for a base worth taking that this garrison can actually take.
   *  Returns true if an order went out. */
  private offend(from: Base): boolean {
    if (from.garrison <= this.profile.reserve) return false;
    if (this.rng.next() > this.profile.nerve) return false;

    // A base with nothing hostile nearby can empty itself; one on the line
    // keeps a real garrison back.
    const exposed = this.nearestHostile(from) < FRONT_RANGE;
    const commit = exposed ? SEND_FRACTION : COMMIT_SAFE;
    const sending = this.spare(from, commit);
    if (sending < 1) return false;
    const fromUnit = BASES[from.kind].unit;

    let best: Base | null = null;
    let bestScore = 0;

    for (const target of this.world.bases) {
      if (target.owner === this.side) continue;

      const targetUnit = BASES[target.kind].unit;
      const attack = sending * UNITS[fromUnit].weight;
      const need = stormingStrength(
        this.holdStrength(target),
        fromUnit,
        targetUnit,
        defenceAt(target.kind, target.level, this.world.stats.elapsed),
      );
      // Troops already on the way soften the target for us — and if they
      // already cover it, spend this garrison somewhere else instead.
      const enRoute = this.friendlyEnRoute(target);
      if (enRoute >= need * 1.05) continue;
      const softened = Math.max(0, need - enRoute);
      const margin = target.owner === 'neutral' ? this.profile.landgrab : this.profile.safety;
      if (attack <= softened * margin) continue;

      const prize = PRIZE[target.kind] ?? 1;
      const bias = target.owner === 'neutral' ? this.profile.expansion : 1;
      const travel = this.dist(from, target) / UNITS[fromUnit].speed;
      const score = (prize * bias) / (1 + travel * 0.35);
      if (score > bestScore) {
        bestScore = score;
        best = target;
      }
    }

    if (!best) return false;
    this.world.sendCount(from.id, best.id, this.side, sending);
    return true;
  }

  /** Troops this base may march out while still holding itself. */
  private spare(b: Base, commit: number): number {
    const guard =
      this.nearestHostile(b) < FRONT_RANGE
        ? Math.max(this.profile.reserve, this.world.capacityOf(b) * HOME_GUARD)
        : this.profile.reserve;
    return Math.floor(Math.min(b.garrison - guard, b.garrison * commit));
  }

  /** Move troops from a quiet rear base towards whichever base of ours is
   *  closest to the enemy, so the front can stack up for a real push. */
  private forward(from: Base, mine: Base[]): void {
    if (from.garrison < this.world.capacityOf(from) * FORWARD_AT) return;
    const sending = this.spare(from, COMMIT_SAFE);
    if (sending < 1) return;
    const ourDistance = this.nearestHostile(from);
    const closer = mine.filter(
      (o) => o.id !== from.id && this.nearestHostile(o) < ourDistance * 0.9,
    );
    if (closer.length === 0) return;
    closer.sort((a, b) => this.dist(from, a) - this.dist(from, b));
    this.world.sendCount(from.id, closer[0].id, this.side, sending);
  }

  /** Distance to the nearest base we do not own. */
  private nearestHostile(b: Base): number {
    let best = Infinity;
    for (const other of this.world.bases) {
      if (other.owner === this.side || other.id === b.id) continue;
      best = Math.min(best, this.dist(b, other));
    }
    return best;
  }

  /** Bank surplus production into permanent capacity behind the front. */
  private improve(mine: Base[], busy: Set<number>): void {
    const safe = mine
      .filter((b) => !busy.has(b.id) && b.level < MAX_LEVEL)
      .filter((b) => this.incomingStrength(b) === 0)
      .filter((b) => b.garrison >= this.world.upgradeCost(b) + this.profile.reserve);
    if (safe.length === 0) return;
    // Upgrade the most valuable of them, one per cycle.
    safe.sort((a, b) => (PRIZE[b.kind] ?? 1) - (PRIZE[a.kind] ?? 1));
    this.world.upgrade(safe[0].id, this.side);
  }

  /** Plain combat value of a garrison. The fortification bonus is applied
   *  separately by stormingStrength, which knows to take its square root. */
  private holdStrength(b: Base): number {
    return b.garrison * UNITS[BASES[b.kind].unit].weight;
  }

  private incomingStrength(b: Base): number {
    let total = 0;
    for (const q of this.world.squads) {
      if (q.toId !== b.id || q.owner === this.side) continue;
      total += q.count * UNITS[q.unit].weight;
    }
    return total;
  }

  private friendlyEnRoute(b: Base): number {
    let total = 0;
    for (const q of this.world.squads) {
      if (q.toId !== b.id || q.owner !== this.side) continue;
      total += q.count * UNITS[q.unit].weight;
    }
    return total;
  }

  private dist(a: Base, b: Base): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
