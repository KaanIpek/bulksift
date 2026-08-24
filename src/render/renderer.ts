import type { Base, Faction, LevelDef, Squad, UnitKind, Vec2 } from '../core/types';
import type { World } from '../game/world';
import { UNITS } from '../game/balance';
import { Camera } from './camera';
import { Fx } from './fx';
import { FACTION, INK, SNOW } from './palette';
import { buildTerrain, MARGIN } from './terrain';
import { drawBase } from './bases';
import { roundRect, unitSprite } from './sprites';

/** Beyond this many figures a formation stops adding bodies and just reads
 *  its number off the badge. A hundred and twenty troops do not need a
 *  hundred and twenty draw calls to look like a lot of troops. */
const MAX_FIGURES = 44;

export interface ViewState {
  selected: Set<number>;
  hoverTarget: number | null;
  dragFrom: Vec2 | null;
  dragTo: Vec2 | null;
  time: number;
}

interface Drawable {
  depth: number;
  paint: () => void;
}

export class Renderer {
  readonly camera: Camera;
  readonly fx = new Fx();
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  private level: LevelDef;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    level: LevelDef,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.level = level;
    this.terrain = buildTerrain(level);
    this.camera = new Camera(level.width, level.height);
  }

  /** Swap in a new map without rebuilding the canvas or the context. */
  setLevel(level: LevelDef): void {
    this.level = level;
    this.terrain = buildTerrain(level);
    this.fx.clear();
    this.camera.setWorld(level.width, level.height);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Cap the pixel ratio: a 3x phone screen triples the fill cost for a
    // difference nobody can see on shapes this soft.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.camera.resize(rect.width, rect.height);
  }

  draw(world: World, view: ViewState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = SNOW.plateDark;
    ctx.fillRect(0, 0, this.camera.viewWidth, this.camera.viewHeight);

    // Ground, laid down in world space so it tilts with the map.
    ctx.save();
    this.camera.applyTo(ctx, this.dpr);
    ctx.drawImage(
      this.terrain,
      -MARGIN,
      -MARGIN,
      this.level.width + MARGIN * 2,
      this.level.height + MARGIN * 2,
    );
    ctx.restore();

    // Everything from here on is drawn upright in screen space.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawTrails(world);

    const scale = this.figureScale();
    const queue: Drawable[] = [];
    for (const base of world.bases) {
      const p = this.camera.project(base.x, base.y);
      queue.push({
        depth: p.y,
        paint: () =>
          drawBase(ctx, base, {
            x: p.x,
            y: p.y,
            scale: scale * 1.5,
            time: view.time,
            selected: view.selected.has(base.id),
            targeted: view.hoverTarget === base.id,
          }),
      });
    }
    for (const squad of world.squads) {
      const p = this.camera.project(squad.x, squad.y);
      queue.push({ depth: p.y, paint: () => this.drawSquad(squad, p, scale) });
    }
    // Painter's algorithm: things lower on the screen are nearer the camera.
    queue.sort((a, b) => a.depth - b.depth);
    for (const item of queue) item.paint();

    this.fx.draw(ctx, scale);

    for (const base of world.bases) {
      const p = this.camera.project(base.x, base.y);
      this.drawBadge(
        p.x,
        p.y - 58 * scale,
        world.displayCount(base),
        world.unitOf(base),
        base.owner,
        scale,
        base.garrison / Math.max(1, world.capacityOf(base)),
      );
    }
    for (const squad of world.squads) {
      const p = this.camera.project(squad.x, squad.y);
      // Lift the badge clear of the column, and clear of the base badge it
      // is still standing on the moment it sets off.
      const clearance = squad.travelled < 40 ? 34 * scale : 0;
      this.drawBadge(
        p.x,
        p.y - this.formationHeight(squad, scale) - 18 * scale - clearance,
        Math.round(squad.count),
        squad.unit,
        squad.owner,
        scale,
        null,
      );
    }

    if (view.dragFrom && view.dragTo) this.drawOrderArrow(view.dragFrom, view.dragTo, view.time);
  }

  /** A soft glow along every route currently carrying troops, so the shape of
   *  the fight is readable at a glance even zoomed out. */
  private drawTrails(world: World): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (const squad of world.squads) {
      const from = world.bases[squad.fromId];
      const to = world.bases[squad.toId];
      if (!from || !to) continue;
      const a = this.camera.project(from.x, from.y);
      const b = this.camera.project(to.x, to.y);
      ctx.strokeStyle = FACTION[squad.owner].trail;
      ctx.lineWidth = Math.max(3, 7 * this.figureScale());
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private figureScale(): number {
    return Math.max(0.55, Math.min(1.7, this.camera.zoom * 1.15));
  }

  private formationHeight(squad: Squad, scale: number): number {
    const sprite = unitSprite(squad.unit, squad.owner);
    const shown = Math.min(MAX_FIGURES, Math.max(1, Math.round(squad.count)));
    const cols = Math.max(1, Math.ceil(Math.sqrt(shown * 2.4)));
    const rows = Math.ceil(shown / cols);
    return (rows * sprite.height * 0.42 + sprite.height) * scale;
  }

  /** A column is drawn as a block of figures, wider than it is deep and
   *  square on to the direction of march — a battle line, not a queue. */
  private drawSquad(squad: Squad, at: Vec2, scale: number): void {
    const ctx = this.ctx;
    const sprite = unitSprite(squad.unit, squad.owner);
    const shown = Math.min(MAX_FIGURES, Math.max(1, Math.round(squad.count)));
    const cols = Math.max(1, Math.ceil(Math.sqrt(shown * 2.4)));
    const rows = Math.ceil(shown / cols);

    // Spread the line across the march direction.
    const dir = this.camera.project(squad.x + squad.dx, squad.y + squad.dy);
    let ax = dir.x - at.x;
    let ay = dir.y - at.y;
    const length = Math.hypot(ax, ay) || 1;
    ax /= length;
    ay /= length;
    const px = -ay;
    const py = ax;

    const gapX = sprite.width * 0.78 * scale;
    const gapY = sprite.height * 0.42 * scale;
    const w = sprite.width * scale;
    const h = sprite.height * scale;

    for (let i = 0; i < shown; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offset = (col - (cols - 1) / 2) * gapX;
      const back = (row - (rows - 1) / 2) * gapY;
      const x = at.x + px * offset - ax * back;
      const y = at.y + py * offset - ay * back - row * gapY * 0.35;

      ctx.fillStyle = SNOW.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y + 1, w * 0.34, w * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(sprite.canvas, x - w / 2, y - h * sprite.anchor, w, h);
    }

    if (squad.fighting) {
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(performance.now() / 60) * 0.15;
      ctx.fillStyle = FACTION[squad.owner].glow;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, cols * gapX * 0.6, rows * gapY * 0.9 + 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /** The count badge: a number in a white pill over a faction-coloured disc
   *  carrying the unit's silhouette. Always upright, always screen-sized. */
  private drawBadge(
    x: number,
    y: number,
    count: number,
    unit: UnitKind,
    owner: Faction,
    scale: number,
    fill: number | null,
  ): void {
    const ctx = this.ctx;
    const r = 13 * scale;
    const c = FACTION[owner];

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = INK.badgeShadow;
    ctx.beginPath();
    ctx.arc(x, y + 2 * scale, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.trim;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    if (fill !== null) {
      // How close the garrison is to its ceiling, as an arc around the disc.
      ctx.strokeStyle = c.bright;
      ctx.lineWidth = 3 * scale;
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5 * scale, -Math.PI / 2, -Math.PI / 2 + Math.min(1, fill) * Math.PI * 2);
      ctx.stroke();
    }

    drawUnitGlyph(ctx, unit, x, y, r * 0.78, c.trim);

    const label = String(count);
    ctx.font = `800 ${Math.round(17 * scale)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const textY = y - r - 10 * scale;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5 * scale;
    ctx.strokeStyle = INK.outline;
    ctx.strokeText(label, x, textY);
    ctx.fillStyle = INK.text;
    ctx.fillText(label, x, textY);
    ctx.restore();
  }

  /** The arrow the player drags to give an order. */
  private drawOrderArrow(from: Vec2, to: Vec2, time: number): void {
    const ctx = this.ctx;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 12) return;
    const ux = dx / length;
    const uy = dy / length;
    const head = Math.min(44, length * 0.42);
    const shaft = length - head;

    ctx.save();
    ctx.translate(from.x, from.y);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.globalAlpha = 0.82 + Math.sin(time * 8) * 0.1;

    ctx.beginPath();
    ctx.moveTo(0, -13);
    ctx.lineTo(shaft, -13);
    ctx.lineTo(shaft, -28);
    ctx.lineTo(length, 0);
    ctx.lineTo(shaft, 28);
    ctx.lineTo(shaft, 13);
    ctx.lineTo(0, 13);
    ctx.closePath();

    // A white rim keeps the arrow readable over snow as well as over troops.
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const grad = ctx.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, 'rgba(60,224,138,0.45)');
    grad.addColorStop(1, FACTION.player.bright);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  /** Where a base sits on the glass right now. */
  screenOf(base: Base): Vec2 {
    return this.camera.project(base.x, base.y);
  }

  /** Turn simulation events into things the eye can follow. */
  drainEvents(world: World): void {
    for (const event of world.fx) {
      switch (event.t) {
        case 'clash': {
          const p = this.camera.project(event.x, event.y);
          this.fx.clash(p.x, p.y, event.owner);
          break;
        }
        case 'tracer': {
          const a = this.camera.project(event.x0, event.y0);
          const b = this.camera.project(event.x1, event.y1);
          this.fx.tracer(a.x, a.y - 24 * this.figureScale(), b.x, b.y, event.owner);
          break;
        }
        case 'capture': {
          const p = this.camera.project(event.x, event.y);
          this.fx.capture(p.x, p.y, event.owner);
          break;
        }
        case 'upgrade': {
          const p = this.camera.project(event.x, event.y);
          this.fx.float(p.x, p.y - 60, 'UPGRADED', event.owner);
          break;
        }
        case 'depart':
          break;
      }
    }
    world.fx.length = 0;
  }

  /** Which base, if any, is under this point on the glass. Generous on
   *  purpose: a thumb is far wider than the building it is aiming at, and a
   *  missed order in this game means the camera pans instead. */
  pick(world: World, sx: number, sy: number): Base | null {
    let best: Base | null = null;
    let bestDist = Math.max(38, 62 * this.figureScale());
    for (const base of world.bases) {
      const p = this.camera.project(base.x, base.y);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < bestDist) {
        bestDist = d;
        best = base;
      }
    }
    return best;
  }
}

/** Small white silhouettes, matching the unit each badge is counting. */
export function drawUnitGlyph(
  ctx: CanvasRenderingContext2D,
  unit: UnitKind,
  x: number,
  y: number,
  r: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = colour;
  ctx.strokeStyle = colour;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (unit === 'infantry') {
    // A slung rifle.
    ctx.lineWidth = r * 0.3;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, r * 0.5);
    ctx.lineTo(r * 0.6, -r * 0.55);
    ctx.stroke();
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, r * 0.5);
    ctx.lineTo(-r * 0.3, r * 0.72);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.05, -r * 0.05);
    ctx.lineTo(r * 0.3, r * 0.3);
    ctx.stroke();
  } else if (unit === 'tank') {
    ctx.beginPath();
    roundRect(ctx, -r * 0.85, r * 0.05, r * 1.7, r * 0.5, r * 0.2);
    ctx.fill();
    roundRect(ctx, -r * 0.5, -r * 0.45, r * 0.85, r * 0.5, r * 0.15);
    ctx.fill();
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.22);
    ctx.lineTo(r * 0.95, -r * 0.35);
    ctx.stroke();
  } else {
    ctx.lineWidth = r * 0.2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.5);
    ctx.lineTo(r * 0.9, -r * 0.5);
    ctx.stroke();
    roundRect(ctx, -r * 0.55, -r * 0.3, r * 1.1, r * 0.6, r * 0.28);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, r * 0.05);
    ctx.lineTo(-r * 0.95, r * 0.3);
    ctx.stroke();
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, r * 0.45);
    ctx.lineTo(r * 0.55, r * 0.45);
    ctx.stroke();
  }
  ctx.restore();
}

export { UNITS };
