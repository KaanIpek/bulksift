import type { Base, Faction, LevelDef, Outcome, Squad, UnitKind } from '../core/types';
import { Rng } from '../core/rng';
import {
  BASES,
  ENGAGE_RANGE,
  MARCH_FIRE,
  MATCHUP,
  MAX_FRAME,
  MAX_LEVEL,
  MIN_SQUAD,
  NEUTRAL_PRODUCTION,
  OVERSTACK_DECAY,
  SEND_FRACTION,
  TICK,
  UNITS,
  UPGRADE_COST,
  baseStats,
  convert,
  defenceAt,
  strength,
} from './balance';

/** Things worth drawing that happened inside a tick. The renderer drains
 *  this list every frame; the simulation never touches a canvas itself. */
export type FxEvent =
  | { t: 'clash'; x: number; y: number; owner: Faction }
  | { t: 'tracer'; x0: number; y0: number; x1: number; y1: number; owner: Faction }
  | { t: 'capture'; x: number; y: number; owner: Faction }
  | { t: 'depart'; x: number; y: number; owner: Faction }
  | { t: 'upgrade'; x: number; y: number; owner: Faction };

export interface WorldStats {
  troopsSent: number;
  basesTaken: number;
  basesLost: number;
  elapsed: number;
}

export interface Road {
  a: number;
  b: number;
}

/** The whole game state and the rules that move it forward.
 *  Runs headless: no DOM, no canvas, fixed timestep, seeded randomness. */
export class World {
  readonly width: number;
  readonly height: number;
  readonly bases: Base[] = [];
  readonly roads: Road[] = [];
  squads: Squad[] = [];
  fx: FxEvent[] = [];
  outcome: Outcome = 'playing';
  stats: WorldStats = { troopsSent: 0, basesTaken: 0, basesLost: 0, elapsed: 0 };

  private nextSquadId = 1;
  private accumulator = 0;
  private rng: Rng;

  constructor(level: LevelDef, seed = 1337) {
    this.width = level.width;
    this.height = level.height;
    this.rng = new Rng(seed);

    level.bases.forEach((b, i) => {
      this.bases.push({
        id: i,
        x: b.x,
        y: b.y,
        kind: b.kind,
        owner: b.owner,
        garrison: b.garrison,
        level: b.level ?? 1,
        reload: 0,
        contested: 0,
        flashCapture: 0,
      });
    });

    for (const [a, b] of level.roads) this.roads.push({ a, b });
  }

  base(id: number): Base | undefined {
    return this.bases[id];
  }

  basesOf(owner: Faction): Base[] {
    return this.bases.filter((b) => b.owner === owner);
  }

  /** Headcount a base would field right now, rounded the way the badge shows it. */
  displayCount(b: Base): number {
    return Math.floor(b.garrison);
  }

  unitOf(b: Base): UnitKind {
    return BASES[b.kind].unit;
  }

  capacityOf(b: Base): number {
    return baseStats(b.kind, b.level).capacity;
  }

  upgradeCost(b: Base): number {
    return b.level >= MAX_LEVEL ? 0 : UPGRADE_COST[b.level];
  }

  canUpgrade(b: Base, owner: Faction): boolean {
    return b.owner === owner && b.level < MAX_LEVEL && b.garrison >= this.upgradeCost(b);
  }

  /** Spend part of a garrison to make the base permanently better. */
  upgrade(baseId: number, owner: Faction): boolean {
    const b = this.bases[baseId];
    if (!b || !this.canUpgrade(b, owner)) return false;
    b.garrison -= this.upgradeCost(b);
    b.level += 1;
    this.fx.push({ t: 'upgrade', x: b.x, y: b.y, owner: b.owner });
    return true;
  }

  /** March a share of a garrison to another base. Returns the squad, or null
   *  if the order was not legal (wrong owner, same base, nobody to send). */
  send(fromId: number, toId: number, owner: Faction, fraction = SEND_FRACTION): Squad | null {
    const from = this.bases[fromId];
    if (!from) return null;
    return this.sendCount(fromId, toId, owner, Math.floor(from.garrison * fraction));
  }

  /** March an exact number of troops. Commanders order in headcounts rather
   *  than fractions so they can hold a precise home guard back. */
  sendCount(fromId: number, toId: number, owner: Faction, count: number): Squad | null {
    const from = this.bases[fromId];
    const to = this.bases[toId];
    if (!from || !to || from.id === to.id) return null;
    if (from.owner !== owner) return null;

    count = Math.floor(Math.min(count, from.garrison));
    if (count < 1) return null;

    from.garrison -= count;
    const unit = this.unitOf(from);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;

    const squad: Squad = {
      id: this.nextSquadId++,
      owner,
      unit,
      count,
      x: from.x,
      y: from.y,
      fromId,
      toId,
      travelled: 0,
      distance,
      dx: dx / distance,
      dy: dy / distance,
      state: 'march',
      fighting: false,
      lane: this.rng.range(-1, 1),
    };
    this.squads.push(squad);
    if (owner === 'player') this.stats.troopsSent += count;
    this.fx.push({ t: 'depart', x: from.x, y: from.y, owner });
    return squad;
  }

  /** Advance real time. Chops the frame into fixed ticks so the outcome of a
   *  battle never depends on the player's frame rate. */
  update(dt: number): void {
    if (this.outcome !== 'playing') return;
    this.accumulator += Math.min(dt, MAX_FRAME);
    while (this.accumulator >= TICK) {
      this.tick(TICK);
      this.accumulator -= TICK;
      if (this.outcome !== 'playing') {
        this.accumulator = 0;
        break;
      }
    }
  }

  private tick(dt: number): void {
    this.stats.elapsed += dt;
    this.produce(dt);
    this.fireTurrets(dt);
    this.march(dt);
    this.skirmish(dt);
    this.assault(dt);
    this.cull();
    this.judge();
  }

  private produce(dt: number): void {
    for (const b of this.bases) {
      b.contested = Math.max(0, b.contested - dt);
      b.flashCapture = Math.max(0, b.flashCapture - dt);
      const cap = this.capacityOf(b);
      if (b.garrison > cap) {
        // A garrison stacked past its ceiling is living off its supply dump.
        // It drains, so a doomstack is a window to attack through rather than
        // a wall to sit behind, and turtling slowly loses to moving.
        b.garrison = Math.max(cap, b.garrison - (b.garrison - cap) * OVERSTACK_DECAY * dt);
        continue;
      }
      if (b.garrison === cap) continue;
      const rate =
        b.owner === 'neutral' ? NEUTRAL_PRODUCTION : baseStats(b.kind, b.level).production;
      b.garrison = Math.min(cap, b.garrison + rate * dt);
    }
  }

  private fireTurrets(dt: number): void {
    for (const b of this.bases) {
      if (b.owner === 'neutral') continue;
      const s = baseStats(b.kind, b.level);
      if (s.turretRange <= 0) continue;
      b.reload -= dt;
      if (b.reload > 0) continue;

      let best: Squad | null = null;
      let bestDist = s.turretRange;
      for (const q of this.squads) {
        if (q.owner === b.owner || q.owner === 'neutral') continue;
        const d = Math.hypot(q.x - b.x, q.y - b.y);
        if (d < bestDist) {
          bestDist = d;
          best = q;
        }
      }
      if (!best) continue;

      b.reload = s.turretReload;
      // A volley is flat damage, so turrets punish small raids hardest and
      // merely tax a real offensive.
      best.count -= s.turretDamage / UNITS[best.unit].hp;
      this.fx.push({ t: 'tracer', x0: b.x, y0: b.y, x1: best.x, y1: best.y, owner: b.owner });
    }
  }

  private march(dt: number): void {
    for (const q of this.squads) {
      if (q.state === 'assault') continue;
      // Columns in contact grind forward instead of stopping dead, so a push
      // with real weight behind it still makes ground.
      const speed = UNITS[q.unit].speed * (q.fighting ? 0.18 : 1);
      q.travelled = Math.min(q.distance, q.travelled + speed * dt);
      q.x = this.bases[q.fromId].x + q.dx * q.travelled;
      q.y = this.bases[q.fromId].y + q.dy * q.travelled;
      if (q.travelled >= q.distance) {
        this.arrive(q);
      }
    }
  }

  /** Opposing columns that come within range trade fire until one breaks. */
  private skirmish(dt: number): void {
    for (const q of this.squads) q.fighting = false;

    for (let i = 0; i < this.squads.length; i++) {
      const a = this.squads[i];
      if (a.count <= 0) continue;
      for (let j = i + 1; j < this.squads.length; j++) {
        const b = this.squads[j];
        if (b.count <= 0 || b.owner === a.owner) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > ENGAGE_RANGE) continue;

        a.fighting = true;
        b.fighting = true;
        const aCount = a.count;
        const bCount = b.count;
        b.count -= this.damage(aCount, a.unit, b.unit, MARCH_FIRE) * dt;
        a.count -= this.damage(bCount, b.unit, a.unit, MARCH_FIRE) * dt;
        this.fx.push({
          t: 'clash',
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2,
          owner: aCount >= bCount ? a.owner : b.owner,
        });
      }
    }
  }

  private arrive(q: Squad): void {
    const to = this.bases[q.toId];
    if (to.owner === q.owner) {
      // Reinforcements retrain into whatever the base fields, keeping their
      // combat value rather than their headcount. They may stack the garrison
      // above its ceiling: production stops there, but marching troops in does
      // not, which is the only way to mass enough force to storm a line.
      to.garrison += convert(strength(q.count, q.unit), this.unitOf(to));
      q.count = 0;
      return;
    }
    q.state = 'assault';
    q.x = to.x;
    q.y = to.y;
  }

  /** Squads standing on a hostile base grind its garrison down.
   *
   *  Everything one side has on the base fights as a single body. Resolving
   *  each column separately would mean two waves of thirty hit like thirty
   *  twice over instead of like sixty — and under the square law that is the
   *  difference between a breakthrough and a slaughter. It made massing
   *  pointless and turtling unbeatable, so the pooling here is load-bearing. */
  private assault(dt: number): void {
    const groups = new Map<string, Squad[]>();
    for (const q of this.squads) {
      if (q.state !== 'assault' || q.count <= 0) continue;
      const to = this.bases[q.toId];

      if (to.owner === q.owner) {
        // Somebody else took it first: walk in as reinforcements.
        to.garrison += convert(strength(q.count, q.unit), this.unitOf(to));
        q.count = 0;
        continue;
      }
      const key = `${q.toId}:${q.owner}`;
      const list = groups.get(key);
      if (list) list.push(q);
      else groups.set(key, [q]);
    }

    for (const attackers of groups.values()) {
      const to = this.bases[attackers[0].toId];
      const defUnit = this.unitOf(to);
      const defence = defenceAt(to.kind, to.level, this.stats.elapsed);
      const defenders = to.garrison;
      const total = attackers.reduce((sum, q) => sum + q.count, 0);
      if (total <= 0) continue;

      to.contested = 0.4;
      let incoming = 0;
      for (const q of attackers) {
        q.fighting = true;
        incoming += this.damage(q.count, q.unit, defUnit, 1);
      }
      to.garrison -= incoming * dt;

      // The garrison splits its fire across the attacking columns in
      // proportion to how much of the assault each one is.
      for (const q of attackers) {
        const facing = defenders * (q.count / total);
        q.count -= this.damage(facing, defUnit, q.unit, defence) * dt;
      }

      if (to.garrison > 0) continue;
      const survivors = attackers.filter((q) => q.count > 0);
      if (survivors.length === 0) continue;

      const previous = to.owner;
      to.owner = survivors[0].owner;
      to.flashCapture = 0.9;
      // Whatever survived the storming becomes the new garrison.
      let value = 0;
      for (const q of survivors) {
        value += strength(q.count, q.unit);
        q.count = 0;
      }
      to.garrison = convert(value, this.unitOf(to));
      if (to.owner === 'player') this.stats.basesTaken++;
      else if (previous === 'player') this.stats.basesLost++;
      this.fx.push({ t: 'capture', x: to.x, y: to.y, owner: to.owner });
    }
  }

  /** Lanchester's square law: a body of troops brings its whole headcount to
   *  bear, so doubling an army roughly quadruples what it can kill. */
  private damage(count: number, from: UnitKind, to: UnitKind, scale: number): number {
    if (count <= 0) return 0;
    return (count * UNITS[from].dps * MATCHUP[from][to] * scale) / UNITS[to].hp;
  }

  private cull(): void {
    if (this.squads.some((q) => q.count < MIN_SQUAD)) {
      this.squads = this.squads.filter((q) => q.count >= MIN_SQUAD);
    }
    for (const b of this.bases) if (b.garrison < 0) b.garrison = 0;
  }

  private judge(): void {
    const playerAlive =
      this.bases.some((b) => b.owner === 'player') || this.squads.some((q) => q.owner === 'player');
    const enemyAlive =
      this.bases.some((b) => b.owner === 'enemy') || this.squads.some((q) => q.owner === 'enemy');
    if (!enemyAlive) this.outcome = 'victory';
    else if (!playerAlive) this.outcome = 'defeat';
  }
}
