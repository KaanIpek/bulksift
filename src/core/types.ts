/** Shared vocabulary for the whole game. Kept dependency-free so the
 *  simulation can run headless (tests, balance sweeps) without a canvas. */

export type Faction = 'player' | 'enemy' | 'neutral';

/** The three fighting arms. Each beats one of the others. */
export type UnitKind = 'infantry' | 'tank' | 'heli';

/** What a base is for. Kind decides what it makes and how well it defends. */
export type BaseKind = 'barracks' | 'factory' | 'airbase' | 'hq' | 'turret';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Base {
  id: number;
  x: number;
  y: number;
  kind: BaseKind;
  owner: Faction;
  /** Troops sitting at home. Fractional between ticks, shown rounded. */
  garrison: number;
  level: number;
  /** Seconds until the base turret may fire again. */
  reload: number;
  /** Counts down while the base is under assault, drives the shake/flash. */
  contested: number;
  /** Set the frame the base changes hands, so the view can celebrate it. */
  flashCapture: number;
}

export interface Squad {
  id: number;
  owner: Faction;
  unit: UnitKind;
  /** Troop count. Fractional while taking losses. */
  count: number;
  x: number;
  y: number;
  fromId: number;
  toId: number;
  /** Distance already walked, in world units. */
  travelled: number;
  /** Straight-line distance of the whole march. */
  distance: number;
  /** Unit vector pointing at the destination. */
  dx: number;
  dy: number;
  /** Marching to the target, or already trading fire with its garrison. */
  state: 'march' | 'assault';
  /** True while trading fire, so the view can draw muzzle flashes. */
  fighting: boolean;
  /** Small per-squad jitter so parallel columns do not overlap exactly. */
  lane: number;
}

export type Outcome = 'playing' | 'victory' | 'defeat';

export interface LevelBase {
  x: number;
  y: number;
  kind: BaseKind;
  owner: Faction;
  garrison: number;
  level?: number;
}

export interface LevelDef {
  id: string;
  name: string;
  /** Flavour line shown on the level card. */
  brief: string;
  difficulty: 'recruit' | 'veteran' | 'elite' | 'legend';
  width: number;
  height: number;
  bases: LevelBase[];
  /** Decorative road segments, given as base-index pairs. */
  roads: [number, number][];
}
