import type { BaseKind, UnitKind } from '../core/types';

/** One place for every number that decides how the game feels.
 *  Tuning happens here and nowhere else. */

export interface UnitStats {
  /** Damage a single soldier deals per second against an even matchup. */
  dps: number;
  /** Damage a single soldier absorbs before dying. */
  hp: number;
  /** World units per second on the march. */
  speed: number;
  /** Combat value of one soldier, used when troops change unit type.
   *  Derived, not invented: see the note above UNITS. */
  weight: number;
  label: string;
}

/** Combat runs on Lanchester's square law, where a force's fighting power is
 *  count * sqrt(dps * hp). Weights are that square root, which makes the
 *  matchup table the *only* thing that decides an even fight: two forces of
 *  equal weight settle it on rock-paper-scissors alone, never on stat creep.
 *  It also means retraining troops between unit types is exactly fair. */
export const UNITS: Record<UnitKind, UnitStats> = {
  infantry: { dps: 1.0, hp: 1.0, speed: 46, weight: 1.0, label: 'Infantry' },
  heli: { dps: 1.9, hp: 1.7, speed: 78, weight: 1.8, label: 'Helicopter' },
  tank: { dps: 2.7, hp: 3.1, speed: 33, weight: 2.9, label: 'Tank' },
};

/** Rock-paper-scissors. MATCHUP[attacker][defender] scales the attacker's dps.
 *  Infantry shred helicopters, helicopters kill tanks, tanks crush infantry. */
export const MATCHUP: Record<UnitKind, Record<UnitKind, number>> = {
  infantry: { infantry: 1.0, tank: 0.6, heli: 1.4 },
  tank: { infantry: 1.45, tank: 1.0, heli: 0.55 },
  heli: { infantry: 0.75, tank: 1.5, heli: 1.0 },
};

export interface BaseStats {
  unit: UnitKind;
  /** Troops produced per second at level 1. */
  production: number;
  /** Garrison ceiling at level 1. */
  capacity: number;
  /** Multiplier on garrison dps when defending at home. */
  defence: number;
  /** Turret reach in world units. 0 means the base has no turret. */
  turretRange: number;
  /** Damage per turret volley. Flat, so a turret taxes every attack by the
   *  same amount rather than scaling with the size of it — which is what
   *  keeps a gun line punishing to raids without being unbreakable. */
  turretDamage: number;
  /** Seconds between volleys. */
  turretReload: number;
  label: string;
}

export const BASES: Record<BaseKind, BaseStats> = {
  barracks: {
    unit: 'infantry',
    production: 1.5,
    capacity: 60,
    defence: 1.1,
    turretRange: 0,
    turretDamage: 0,
    turretReload: 0,
    label: 'Barracks',
  },
  factory: {
    unit: 'tank',
    production: 0.55,
    capacity: 32,
    defence: 1.2,
    turretRange: 0,
    turretDamage: 0,
    turretReload: 0,
    label: 'Factory',
  },
  airbase: {
    unit: 'heli',
    production: 0.85,
    capacity: 40,
    defence: 1.08,
    turretRange: 0,
    turretDamage: 0,
    turretReload: 0,
    label: 'Airbase',
  },
  hq: {
    unit: 'infantry',
    production: 2.1,
    capacity: 90,
    defence: 1.35,
    turretRange: 95,
    turretDamage: 1.2,
    turretReload: 1.5,
    label: 'Headquarters',
  },
  turret: {
    unit: 'infantry',
    production: 0.4,
    capacity: 45,
    defence: 1.9,
    turretRange: 130,
    turretDamage: 2.2,
    turretReload: 1.1,
    label: 'Gun Emplacement',
  },
};

/** Each level adds this fraction of the base value, compounding lightly. */
export const LEVEL_GAIN = {
  production: 0.55,
  capacity: 0.6,
  defence: 0.18,
  turretDamage: 0.7,
  turretRange: 0.12,
};

export const MAX_LEVEL = 3;

/** Garrison spent to raise a base one level. Index is the current level. */
export const UPGRADE_COST = [0, 45, 90, 0];

/** Share of a garrison that marches out when you send troops. */
export const SEND_FRACTION = 0.5;

/** Troops closer than this to an enemy column start trading fire. */
export const ENGAGE_RANGE = 26;

/** How much of a squad's dps lands while it is still marching. */
export const MARCH_FIRE = 0.85;

/** A squad this small evaporates rather than limping on. */
export const MIN_SQUAD = 0.6;

/** Neutral garrisons regrow slowly so an ignored map still tightens up. */
export const NEUTRAL_PRODUCTION = 0.12;

/** Fraction of the *excess* a garrison over its ceiling loses each second.
 *  Massing for a push is meant to be a decision with a clock on it. */
export const OVERSTACK_DECAY = 0.06;

/** Two evenly matched sides behind fortifications will sit there forever, and
 *  a phone game cannot afford a stalemate. Dug-in positions therefore wear
 *  out: the home advantage fades to nothing between these two marks, so a
 *  long match resolves itself even if neither commander forces it. Turret
 *  guns keep firing throughout — only the fortification bonus decays. */
export const FORTIFY_HOLDS = 150;
export const FORTIFY_GONE = 420;

/** How much of a base's defence bonus still applies after this long. */
export function fortification(elapsed: number): number {
  if (elapsed <= FORTIFY_HOLDS) return 1;
  if (elapsed >= FORTIFY_GONE) return 0;
  return 1 - (elapsed - FORTIFY_HOLDS) / (FORTIFY_GONE - FORTIFY_HOLDS);
}

/** A base's effective defence multiplier this far into a match. */
export function defenceAt(kind: BaseKind, level: number, elapsed: number): number {
  return 1 + (baseStats(kind, level).defence - 1) * fortification(elapsed);
}

/** Simulation runs on a fixed step so results are reproducible. */
export const TICK = 1 / 60;

/** Never simulate more than this much time in one frame after a stall. */
export const MAX_FRAME = 0.25;

export function baseStats(kind: BaseKind, level: number) {
  const s = BASES[kind];
  const n = Math.max(0, level - 1);
  return {
    unit: s.unit,
    production: s.production * (1 + LEVEL_GAIN.production * n),
    capacity: Math.round(s.capacity * (1 + LEVEL_GAIN.capacity * n)),
    defence: s.defence * (1 + LEVEL_GAIN.defence * n),
    turretRange: s.turretRange * (1 + LEVEL_GAIN.turretRange * n),
    turretDamage: s.turretDamage * (1 + LEVEL_GAIN.turretDamage * n),
    turretReload: s.turretReload,
    label: s.label,
  };
}

/** Combat value of a body of troops, used to convert between unit types. */
export function strength(count: number, unit: UnitKind): number {
  return count * UNITS[unit].weight;
}

/** Turn a combat value back into a headcount of some other unit. */
export function convert(value: number, into: UnitKind): number {
  return value / UNITS[into].weight;
}

/** Combat value an attacker needs to storm a garrison, straight out of the
 *  square law. Because power goes as the square of the headcount, the edge a
 *  defender's fortification buys is the *square root* of its multiplier — a
 *  commander who compares the raw numbers instead will never attack anything.
 *  `defenderStrength` is a plain count * weight, with no defence factor. */
export function stormingStrength(
  defenderStrength: number,
  attacker: UnitKind,
  defender: UnitKind,
  defence: number,
): number {
  const ratio = (defence * MATCHUP[defender][attacker]) / MATCHUP[attacker][defender];
  return defenderStrength * Math.sqrt(ratio);
}

/** Rough economic worth of a base's guns, for comparing map positions.
 *  Counted at a fraction of raw output because a turret only earns its keep
 *  while something hostile is inside its reach. */
export function turretValue(kind: BaseKind, level: number): number {
  const s = baseStats(kind, level);
  if (s.turretRange <= 0) return 0;
  return (s.turretDamage / s.turretReload) * 60 * 0.35;
}
