import { Rng } from '../core/rng';
import type { LevelDef, Vec2 } from '../core/types';
import { SCENERY, SQUASH } from './camera';
import { ROAD, ROCK, SNOW, TREE } from './palette';

/** How far the scenery reaches beyond the playable map, so the edges of the
 *  world are mountains and trees rather than a cut-off rectangle. */
export const MARGIN = SCENERY + 120;

/** The terrain is painted flat and then squashed by the camera's tilt.
 *  Anything meant to stand up out of the ground - a tree, a boulder, a
 *  mountain - is drawn this much taller to survive that squash and come out
 *  upright, the way the units blitted in screen space already do. */
const STAND = 1 / SQUASH;

/** Drawn once per level into an offscreen canvas at world scale, then blitted
 *  under the camera transform every frame. Nothing here moves, so paying for
 *  it a second time would be waste — and doing it up front buys detail that
 *  would be far too expensive per frame. */
export function buildTerrain(level: LevelDef): HTMLCanvasElement {
  // One device pixel per world unit. The camera never magnifies the ground
  // by much, and the art is soft enough that going finer would cost tens of
  // megabytes of texture for a difference nobody can see on a phone.
  const scale = 1;
  const w = level.width + MARGIN * 2;
  const h = level.height + MARGIN * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.translate(MARGIN, MARGIN);

  const rng = new Rng(hash(level.id));
  ctx.fillStyle = SNOW.base;
  ctx.fillRect(-MARGIN, -MARGIN, w, h);

  drawPlates(ctx, level, rng);
  drawDrifts(ctx, level, rng);
  drawRoads(ctx, level);
  drawMountains(ctx, level, rng);
  drawScatter(ctx, level, rng);

  return canvas;
}

function hash(id: string): number {
  let n = 2166136261;
  for (let i = 0; i < id.length; i++) {
    n ^= id.charCodeAt(i);
    n = Math.imul(n, 16777619);
  }
  return n >>> 0;
}

/** The ground reads as slabs of packed snow with seams between them. A grid
 *  with every corner pushed around gives that without any real geometry. */
function drawPlates(ctx: CanvasRenderingContext2D, level: LevelDef, rng: Rng): void {
  const cell = 115;
  const cols = Math.ceil((level.width + MARGIN * 2) / cell) + 1;
  const rows = Math.ceil((level.height + MARGIN * 2) / cell) + 1;
  const points: Vec2[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: Vec2[] = [];
    for (let c = 0; c <= cols; c++) {
      row.push({
        x: -MARGIN + c * cell + rng.range(-cell * 0.3, cell * 0.3),
        y: -MARGIN + r * cell + rng.range(-cell * 0.3, cell * 0.3),
      });
    }
    points.push(row);
  }

  ctx.lineWidth = 1.6;
  ctx.strokeStyle = SNOW.seam;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = points[r][c];
      const b = points[r][c + 1];
      const d = points[r + 1][c + 1];
      const e = points[r + 1][c];
      const tone = rng.next();
      ctx.fillStyle = tone > 0.72 ? SNOW.plateLight : tone < 0.2 ? SNOW.plateDark : SNOW.base;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(d.x, d.y);
      ctx.lineTo(e.x, e.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Soft banks of wind-blown snow, to break up the grid. */
function drawDrifts(ctx: CanvasRenderingContext2D, level: LevelDef, rng: Rng): void {
  ctx.fillStyle = SNOW.drift;
  for (let i = 0; i < 26; i++) {
    const x = rng.range(-MARGIN * 0.5, level.width + MARGIN * 0.5);
    const y = rng.range(-MARGIN * 0.5, level.height + MARGIN * 0.5);
    const rx = rng.range(70, 190);
    const ry = rx * rng.range(0.4, 0.7);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rng.range(0, Math.PI), 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Roads are decoration, but they are the decoration that tells the player
 *  which bases sit next to which. Worn mud, wide and soft-edged. */
function drawRoads(ctx: CanvasRenderingContext2D, level: LevelDef): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [
    { width: 19, colour: ROAD.edge, alpha: 0.5 },
    { width: 13, colour: ROAD.fill, alpha: 1 },
  ]) {
    ctx.globalAlpha = pass.alpha;
    ctx.strokeStyle = pass.colour;
    ctx.lineWidth = pass.width;
    ctx.beginPath();
    for (const [a, b] of level.roads) {
      const from = level.bases[a];
      const to = level.bases[b];
      if (!from || !to) continue;
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** A range along the far edge, so the map has a horizon to push towards. */
function drawMountains(ctx: CanvasRenderingContext2D, level: LevelDef, rng: Rng): void {
  let x = -MARGIN;
  while (x < level.width + MARGIN) {
    const width = rng.range(150, 320);
    const height = rng.range(150, 300) * STAND;
    const peak = { x: x + width / 2, y: -MARGIN * 0.35 - height };
    const left = { x, y: -MARGIN * 0.35 + rng.range(0, 60) };
    const right = { x: x + width, y: -MARGIN * 0.35 + rng.range(0, 60) };

    ctx.fillStyle = ROCK.mid;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(peak.x, peak.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.fill();

    // A lit face on one side to give the peak some form.
    ctx.fillStyle = ROCK.light;
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(peak.x + width * 0.1, right.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = ROCK.dark;
    ctx.beginPath();
    ctx.moveTo(peak.x, peak.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(peak.x - width * 0.14, left.y);
    ctx.closePath();
    ctx.fill();

    x += width * rng.range(0.55, 0.8);
  }
}

/** Trees and boulders, kept clear of the bases and the roads. Woodland grows
 *  in stands rather than evenly, so the scatter is clustered: an even sprinkle
 *  across the whole map reads as texture, not as terrain. */
function drawScatter(ctx: CanvasRenderingContext2D, level: LevelDef, rng: Rng): void {
  const clearOf = (x: number, y: number, distance: number) => {
    for (const b of level.bases) {
      if (Math.hypot(b.x - x, b.y - y) < distance) return false;
    }
    for (const [a, b] of level.roads) {
      const from = level.bases[a];
      const to = level.bases[b];
      if (!from || !to) continue;
      if (pointToSegment(x, y, from.x, from.y, to.x, to.y) < 38) return false;
    }
    return true;
  };

  const area = (level.width + MARGIN * 2) * (level.height + MARGIN * 2);
  const stands = Math.round(area / 42000);
  for (let i = 0; i < stands; i++) {
    const cx = rng.range(-MARGIN * 0.92, level.width + MARGIN * 0.92);
    const cy = rng.range(-MARGIN * 0.7, level.height + MARGIN * 0.92);
    const spread = rng.range(45, 150);
    const trees = Math.round(rng.range(3, 11));
    for (let j = 0; j < trees; j++) {
      const x = cx + rng.range(-spread, spread);
      const y = cy + rng.range(-spread * 0.8, spread * 0.8);
      const outside = x < 0 || x > level.width || y < 0 || y > level.height;
      if (!clearOf(x, y, outside ? 46 : 105)) continue;
      if (rng.next() < 0.86) drawTree(ctx, x, y, rng.range(0.7, 1.3), rng.next());
      else drawRock(ctx, x, y, rng.range(0.7, 1.25));
    }
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, tint: number): void {
  // Height is pre-stretched so the camera's squash leaves a tree that stands
  // up rather than one that sits on the snow like a cap.
  const h = 52 * scale * STAND;
  const w = 12 * scale;

  ctx.fillStyle = SNOW.shadow;
  ctx.beginPath();
  ctx.ellipse(x + w * 0.7, y + 2, w * 1.05, w * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = TREE.trunk;
  ctx.fillRect(x - w * 0.11, y - h * 0.13, w * 0.22, h * 0.15);

  // Three cones, each narrower and further up than the last.
  const shades = tint > 0.42 ? [TREE.dark, TREE.mid, TREE.snow] : [TREE.mid, TREE.snow, '#ffffff'];
  for (let tier = 0; tier < 3; tier++) {
    const baseY = y - h * (0.1 + tier * 0.27);
    const halfW = w * (1 - tier * 0.26);
    ctx.fillStyle = shades[tier];
    ctx.beginPath();
    ctx.moveTo(x, baseY - h * 0.44);
    ctx.lineTo(x + halfW, baseY);
    ctx.lineTo(x - halfW, baseY);
    ctx.closePath();
    ctx.fill();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const r = 14 * scale;
  const t = r * STAND;
  ctx.fillStyle = SNOW.shadow;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.4, y + r * 0.24, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = ROCK.light;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x - r * 0.35, y - t * 1.05);
  ctx.lineTo(x + r * 0.55, y - t * 0.75);
  ctx.lineTo(x + r, y + r * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = ROCK.mid;
  ctx.beginPath();
  ctx.moveTo(x + r * 0.55, y - t * 0.75);
  ctx.lineTo(x + r, y + r * 0.1);
  ctx.lineTo(x - r * 0.1, y + r * 0.1);
  ctx.closePath();
  ctx.fill();
}

function pointToSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
