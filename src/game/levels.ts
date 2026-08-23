import type { LevelBase, LevelDef } from '../core/types';
import type { Difficulty } from './ai';

export interface CampaignLevel extends LevelDef {
  difficulty: Difficulty;
}

interface LevelSpec {
  id: string;
  name: string;
  brief: string;
  difficulty: Difficulty;
  height: number;
  bases: LevelBase[];
}

/** Maps are authored in a portrait world 640 wide. The player always starts
 *  at the bottom and pushes north.
 *
 *  Difficulty rises through *fortification*, not through handing the enemy a
 *  bigger economy. Gun emplacements produce almost nothing but are murder to
 *  storm, so a late map feels dug in without the player being out-produced
 *  two to one — which is the shape that made earlier drafts unwinnable. */
const WIDTH = 640;

/** Roads are decoration: they show where the ground is walkable, while troops
 *  actually march in a straight line. Deriving them from the layout keeps the
 *  level data to just the bases, with no hand-written index pairs to get
 *  wrong. Each base links to its two nearest neighbours, plus anything else
 *  close enough that a missing road would look odd. */
function deriveRoads(bases: LevelBase[]): [number, number][] {
  const near = 300;
  const seen = new Set<string>();
  const roads: [number, number][] = [];
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (a === b || seen.has(key)) return;
    seen.add(key);
    roads.push(a < b ? [a, b] : [b, a]);
  };
  const dist = (a: LevelBase, b: LevelBase) => Math.hypot(a.x - b.x, a.y - b.y);

  bases.forEach((base, i) => {
    const others = bases
      .map((other, j) => ({ j, d: dist(base, other) }))
      .filter((o) => o.j !== i)
      .sort((p, q) => p.d - q.d);
    others.slice(0, 2).forEach((o) => add(i, o.j));
    others.filter((o) => o.d <= near).forEach((o) => add(i, o.j));
  });
  return roads;
}

function level(spec: LevelSpec): CampaignLevel {
  return {
    id: spec.id,
    name: spec.name,
    brief: spec.brief,
    difficulty: spec.difficulty,
    width: WIDTH,
    height: spec.height,
    bases: spec.bases,
    roads: deriveRoads(spec.bases),
  };
}

export const CAMPAIGN: CampaignLevel[] = [
  level({
    id: 'first-light',
    name: 'First Light',
    brief: 'Drag from one of your camps to another base to send half its garrison.',
    difficulty: 'recruit',
    height: 1120,
    bases: [
      { x: 170, y: 900, kind: 'barracks', owner: 'player', garrison: 27, level: 2 },
      { x: 470, y: 950, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 320, y: 620, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 300, y: 250, kind: 'barracks', owner: 'enemy', garrison: 82, level: 2 },
    ],
  }),
  level({
    id: 'crossroads',
    name: 'Crossroads',
    brief: 'Neutral ground in the middle. Whoever holds it feeds faster.',
    difficulty: 'recruit',
    height: 1160,
    bases: [
      { x: 320, y: 1000, kind: 'hq', owner: 'player', garrison: 40 },
      { x: 130, y: 880, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 130, y: 700, kind: 'barracks', owner: 'neutral', garrison: 12 },
      { x: 510, y: 730, kind: 'barracks', owner: 'neutral', garrison: 12 },
      { x: 320, y: 560, kind: 'barracks', owner: 'neutral', garrison: 20 },
      { x: 150, y: 270, kind: 'barracks', owner: 'enemy', garrison: 51 },
      { x: 490, y: 270, kind: 'barracks', owner: 'enemy', garrison: 51 },
    ],
  }),
  level({
    id: 'armour-depot',
    name: 'Armour Depot',
    brief: 'Your factory builds tanks: slow to fill, brutal against infantry.',
    difficulty: 'recruit',
    height: 1180,
    bases: [
      { x: 180, y: 1010, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 470, y: 1040, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 330, y: 830, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 120, y: 520, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 500, y: 700, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 520, y: 470, kind: 'barracks', owner: 'enemy', garrison: 13 },
      { x: 280, y: 230, kind: 'hq', owner: 'enemy', garrison: 20 },
    ],
  }),
  level({
    id: 'air-superiority',
    name: 'Air Superiority',
    brief: 'Helicopters fly fast and gut armour, but infantry shoot them down.',
    difficulty: 'veteran',
    height: 1200,
    bases: [
      { x: 150, y: 1050, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 480, y: 1080, kind: 'airbase', owner: 'player', garrison: 18, level: 2 },
      { x: 320, y: 880, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 100, y: 640, kind: 'factory', owner: 'neutral', garrison: 12 },
      { x: 540, y: 610, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 320, y: 660, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 170, y: 330, kind: 'airbase', owner: 'enemy', garrison: 9 },
      { x: 470, y: 250, kind: 'hq', owner: 'enemy', garrison: 20 },
      { x: 320, y: 150, kind: 'barracks', owner: 'enemy', garrison: 13 },
    ],
  }),
  level({
    id: 'the-gun-line',
    name: 'The Gun Line',
    brief: 'Emplacements shell anything that walks past. Take them or go around.',
    difficulty: 'veteran',
    height: 1240,
    bases: [
      { x: 170, y: 1090, kind: 'hq', owner: 'player', garrison: 40, level: 2 },
      { x: 480, y: 1110, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 330, y: 900, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 110, y: 690, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 540, y: 660, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 320, y: 520, kind: 'turret', owner: 'enemy', garrison: 10 },
      { x: 130, y: 300, kind: 'barracks', owner: 'enemy', garrison: 13 },
      { x: 500, y: 260, kind: 'hq', owner: 'enemy', garrison: 20 },
      { x: 310, y: 170, kind: 'barracks', owner: 'enemy', garrison: 13 },
    ],
  }),
  level({
    id: 'pincer',
    name: 'Pincer',
    brief: 'Two enemy commands, one on each flank. They will not wait for you.',
    difficulty: 'veteran',
    height: 1260,
    bases: [
      { x: 320, y: 1120, kind: 'hq', owner: 'player', garrison: 40 },
      { x: 140, y: 940, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 500, y: 940, kind: 'airbase', owner: 'player', garrison: 18 },
      { x: 320, y: 730, kind: 'factory', owner: 'neutral', garrison: 14 },
      { x: 90, y: 600, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 550, y: 600, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 130, y: 340, kind: 'hq', owner: 'enemy', garrison: 20 },
      { x: 510, y: 340, kind: 'hq', owner: 'enemy', garrison: 20 },
      { x: 320, y: 170, kind: 'turret', owner: 'enemy', garrison: 10 },
    ],
  }),
  level({
    id: 'ridgeway',
    name: 'Ridgeway',
    brief: 'One narrow pass north. Whoever fortifies it first decides the map.',
    difficulty: 'elite',
    height: 1320,
    bases: [
      { x: 160, y: 1180, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 470, y: 1200, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 320, y: 980, kind: 'hq', owner: 'player', garrison: 40, level: 2 },
      { x: 320, y: 730, kind: 'turret', owner: 'neutral', garrison: 22 },
      { x: 110, y: 780, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 540, y: 760, kind: 'airbase', owner: 'neutral', garrison: 12 },
      { x: 320, y: 470, kind: 'turret', owner: 'enemy', garrison: 10 },
      { x: 130, y: 280, kind: 'factory', owner: 'enemy', garrison: 7 },
      { x: 510, y: 260, kind: 'hq', owner: 'enemy', garrison: 32, level: 2 },
      { x: 320, y: 150, kind: 'barracks', owner: 'enemy', garrison: 13 },
    ],
  }),
  level({
    id: 'iron-triangle',
    name: 'Iron Triangle',
    brief: 'Three headquarters, three doctrines. Pick your matchups carefully.',
    difficulty: 'elite',
    height: 1300,
    bases: [
      { x: 320, y: 1160, kind: 'hq', owner: 'player', garrison: 40 },
      { x: 120, y: 990, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 520, y: 990, kind: 'airbase', owner: 'player', garrison: 18 },
      { x: 200, y: 760, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 440, y: 760, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 320, y: 620, kind: 'turret', owner: 'neutral', garrison: 24 },
      { x: 110, y: 430, kind: 'factory', owner: 'enemy', garrison: 7 },
      { x: 530, y: 430, kind: 'airbase', owner: 'enemy', garrison: 9 },
      { x: 320, y: 200, kind: 'hq', owner: 'enemy', garrison: 32, level: 2 },
    ],
  }),
  level({
    id: 'deep-freeze',
    name: 'Deep Freeze',
    brief: 'A wall of guns across the north. Bleed it down before you commit.',
    difficulty: 'elite',
    height: 1340,
    bases: [
      { x: 160, y: 1200, kind: 'hq', owner: 'player', garrison: 40, level: 2 },
      { x: 470, y: 1220, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 320, y: 1010, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 100, y: 880, kind: 'barracks', owner: 'neutral', garrison: 16 },
      { x: 545, y: 870, kind: 'airbase', owner: 'neutral', garrison: 14 },
      { x: 200, y: 640, kind: 'barracks', owner: 'neutral', garrison: 20 },
      { x: 450, y: 620, kind: 'factory', owner: 'neutral', garrison: 16 },
      { x: 130, y: 400, kind: 'turret', owner: 'enemy', garrison: 16, level: 2 },
      { x: 510, y: 400, kind: 'turret', owner: 'enemy', garrison: 16, level: 2 },
      { x: 320, y: 330, kind: 'barracks', owner: 'enemy', garrison: 21, level: 2 },
      { x: 320, y: 170, kind: 'hq', owner: 'enemy', garrison: 20 },
    ],
  }),
  level({
    id: 'counterstrike',
    name: 'Counterstrike',
    brief: 'They hold more ground than you do. Trade space for time, then turn it.',
    difficulty: 'legend',
    height: 1300,
    bases: [
      { x: 320, y: 1170, kind: 'hq', owner: 'player', garrison: 45, level: 2 },
      { x: 130, y: 1010, kind: 'turret', owner: 'player', garrison: 20 },
      { x: 510, y: 1010, kind: 'turret', owner: 'player', garrison: 20 },
      { x: 150, y: 830, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 490, y: 830, kind: 'factory', owner: 'player', garrison: 14, level: 2 },
      { x: 320, y: 820, kind: 'barracks', owner: 'neutral', garrison: 14 },
      { x: 100, y: 640, kind: 'factory', owner: 'neutral', garrison: 16 },
      { x: 540, y: 640, kind: 'airbase', owner: 'neutral', garrison: 14 },
      { x: 200, y: 420, kind: 'barracks', owner: 'enemy', garrison: 11 },
      { x: 440, y: 420, kind: 'barracks', owner: 'enemy', garrison: 11 },
      { x: 110, y: 210, kind: 'turret', owner: 'enemy', garrison: 13, level: 2 },
      { x: 530, y: 210, kind: 'airbase', owner: 'enemy', garrison: 12, level: 2 },
      { x: 320, y: 110, kind: 'hq', owner: 'enemy', garrison: 26, level: 2 },
    ],
  }),
  level({
    id: 'winter-storm',
    name: 'Winter Storm',
    brief: 'Three lanes, three fights. Your flanks are yours if you take them.',
    difficulty: 'legend',
    height: 1400,
    bases: [
      { x: 320, y: 1280, kind: 'hq', owner: 'player', garrison: 40 },
      { x: 110, y: 1120, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 320, y: 1000, kind: 'airbase', owner: 'player', garrison: 18 },
      { x: 110, y: 900, kind: 'barracks', owner: 'player', garrison: 27 },
      { x: 540, y: 920, kind: 'factory', owner: 'player', garrison: 14 },
      { x: 105, y: 730, kind: 'barracks', owner: 'neutral', garrison: 18 },
      { x: 320, y: 780, kind: 'turret', owner: 'neutral', garrison: 24 },
      { x: 540, y: 730, kind: 'airbase', owner: 'neutral', garrison: 18 },
      { x: 320, y: 560, kind: 'factory', owner: 'neutral', garrison: 20 },
      { x: 110, y: 380, kind: 'hq', owner: 'enemy', garrison: 11 },
      { x: 320, y: 430, kind: 'turret', owner: 'enemy', garrison: 6 },
      { x: 530, y: 380, kind: 'hq', owner: 'enemy', garrison: 11 },
      { x: 200, y: 170, kind: 'factory', owner: 'enemy', garrison: 6 },
      { x: 450, y: 170, kind: 'airbase', owner: 'enemy', garrison: 6 },
    ],
  }),
  level({
    id: 'last-stand',
    name: 'Last Stand',
    brief: 'Their whole command, dug in behind three gun lines. End it.',
    difficulty: 'legend',
    height: 1420,
    bases: [
      { x: 320, y: 1300, kind: 'hq', owner: 'player', garrison: 45, level: 3 },
      { x: 120, y: 1150, kind: 'factory', owner: 'player', garrison: 14, level: 2 },
      { x: 520, y: 1150, kind: 'airbase', owner: 'player', garrison: 18 },
      { x: 320, y: 1000, kind: 'turret', owner: 'player', garrison: 20 },
      { x: 110, y: 880, kind: 'barracks', owner: 'neutral', garrison: 20 },
      { x: 530, y: 880, kind: 'barracks', owner: 'neutral', garrison: 20 },
      { x: 200, y: 690, kind: 'factory', owner: 'neutral', garrison: 18 },
      { x: 440, y: 690, kind: 'airbase', owner: 'neutral', garrison: 20 },
      { x: 320, y: 560, kind: 'turret', owner: 'enemy', garrison: 13, level: 2 },
      { x: 100, y: 430, kind: 'turret', owner: 'enemy', garrison: 13, level: 2 },
      { x: 540, y: 430, kind: 'turret', owner: 'enemy', garrison: 8 },
      { x: 180, y: 240, kind: 'factory', owner: 'enemy', garrison: 9, level: 2 },
      { x: 460, y: 240, kind: 'airbase', owner: 'enemy', garrison: 16, level: 3 },
      { x: 320, y: 110, kind: 'hq', owner: 'enemy', garrison: 16 },
    ],
  }),
];

/** A mirrored map, used for a quick skirmish in game and as neutral ground
 *  whenever two commanders need comparing. Nothing here favours either side,
 *  so a result on it is about play rather than position. */
export const SKIRMISH: CampaignLevel = level({
  id: 'skirmish',
  name: 'Skirmish',
  brief: 'A mirrored valley. No advantages, no excuses.',
  difficulty: 'veteran',
  height: 1200,
  bases: [
    { x: 160, y: 1050, kind: 'barracks', owner: 'player', garrison: 27 },
    { x: 480, y: 1050, kind: 'factory', owner: 'player', garrison: 14 },
    { x: 320, y: 880, kind: 'hq', owner: 'player', garrison: 40 },
    { x: 120, y: 600, kind: 'barracks', owner: 'neutral', garrison: 16 },
    { x: 520, y: 600, kind: 'barracks', owner: 'neutral', garrison: 16 },
    { x: 320, y: 320, kind: 'hq', owner: 'enemy', garrison: 40 },
    { x: 160, y: 150, kind: 'barracks', owner: 'enemy', garrison: 27 },
    { x: 480, y: 150, kind: 'factory', owner: 'enemy', garrison: 14 },
  ],
});

export function levelIndex(id: string): number {
  return CAMPAIGN.findIndex((l) => l.id === id);
}
