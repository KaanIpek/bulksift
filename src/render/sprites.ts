import type { Faction, UnitKind } from '../core/types';
import { FACTION } from './palette';

/** Units are drawn from small pre-rendered bitmaps rather than with fresh
 *  path work every frame. A busy front can have several hundred figures on
 *  screen at once, and at that count one drawImage per figure is the
 *  difference between a smooth phone and a slideshow.
 *
 *  They are blitted upright in screen space, not through the camera's world
 *  transform: the ground tilts, the soldiers standing on it do not. */

const SUPERSAMPLE = 3;

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, c: (typeof FACTION)['player']) => void;

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Logical size, before the supersample factor. */
  width: number;
  height: number;
  /** Where the figure's feet sit, as a fraction of the height. */
  anchor: number;
}

function make(width: number, height: number, faction: Faction, anchor: number, paint: Painter): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = width * SUPERSAMPLE;
  canvas.height = height * SUPERSAMPLE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  paint(ctx, width, height, FACTION[faction]);
  return { canvas, width, height, anchor };
}

function soldier(ctx: CanvasRenderingContext2D, w: number, h: number, c: (typeof FACTION)['player']): void {
  const cx = w / 2;
  // Legs
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = w * 0.15;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.13, h * 0.98);
  ctx.lineTo(cx - w * 0.08, h * 0.62);
  ctx.moveTo(cx + w * 0.13, h * 0.98);
  ctx.lineTo(cx + w * 0.08, h * 0.62);
  ctx.stroke();
  // Torso
  ctx.fillStyle = c.main;
  roundRect(ctx, cx - w * 0.24, h * 0.3, w * 0.48, h * 0.4, w * 0.16);
  ctx.fill();
  // Pack
  ctx.fillStyle = c.dark;
  roundRect(ctx, cx - w * 0.3, h * 0.36, w * 0.16, h * 0.26, w * 0.07);
  ctx.fill();
  // Rifle
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = w * 0.09;
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.06, h * 0.66);
  ctx.lineTo(cx + w * 0.38, h * 0.34);
  ctx.stroke();
  // Head under a helmet
  ctx.fillStyle = c.bright;
  ctx.beginPath();
  ctx.arc(cx, h * 0.2, w * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.arc(cx, h * 0.18, w * 0.21, Math.PI, Math.PI * 2);
  ctx.fill();
}

function tank(ctx: CanvasRenderingContext2D, w: number, h: number, c: (typeof FACTION)['player']): void {
  // Tracks
  ctx.fillStyle = c.deep;
  roundRect(ctx, w * 0.06, h * 0.58, w * 0.88, h * 0.3, h * 0.1);
  ctx.fill();
  // Hull
  ctx.fillStyle = c.main;
  roundRect(ctx, w * 0.12, h * 0.4, w * 0.76, h * 0.3, h * 0.08);
  ctx.fill();
  // Deck highlight
  ctx.fillStyle = c.bright;
  roundRect(ctx, w * 0.18, h * 0.42, w * 0.64, h * 0.1, h * 0.05);
  ctx.fill();
  // Turret
  ctx.fillStyle = c.dark;
  roundRect(ctx, w * 0.32, h * 0.2, w * 0.36, h * 0.24, h * 0.08);
  ctx.fill();
  // Barrel
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = h * 0.09;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h * 0.3);
  ctx.lineTo(w * 0.96, h * 0.16);
  ctx.stroke();
}

function heli(ctx: CanvasRenderingContext2D, w: number, h: number, c: (typeof FACTION)['player']): void {
  // Rotor disc
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = h * 0.05;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.2, w * 0.46, h * 0.09, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Tail boom
  ctx.strokeStyle = c.main;
  ctx.lineWidth = h * 0.1;
  ctx.beginPath();
  ctx.moveTo(w * 0.42, h * 0.55);
  ctx.lineTo(w * 0.06, h * 0.42);
  ctx.stroke();
  ctx.fillStyle = c.dark;
  roundRect(ctx, w * 0.02, h * 0.3, w * 0.08, h * 0.2, h * 0.04);
  ctx.fill();
  // Cabin
  ctx.fillStyle = c.main;
  roundRect(ctx, w * 0.36, h * 0.36, w * 0.5, h * 0.38, h * 0.16);
  ctx.fill();
  ctx.fillStyle = c.bright;
  roundRect(ctx, w * 0.62, h * 0.42, w * 0.2, h * 0.16, h * 0.07);
  ctx.fill();
  // Mast
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = h * 0.06;
  ctx.beginPath();
  ctx.moveTo(w * 0.55, h * 0.36);
  ctx.lineTo(w * 0.52, h * 0.22);
  ctx.stroke();
  // Skid
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = h * 0.05;
  ctx.beginPath();
  ctx.moveTo(w * 0.4, h * 0.86);
  ctx.lineTo(w * 0.84, h * 0.86);
  ctx.stroke();
}

const PAINTERS: Record<UnitKind, { painter: Painter; w: number; h: number; anchor: number }> = {
  infantry: { painter: soldier, w: 13, h: 17, anchor: 1 },
  tank: { painter: tank, w: 26, h: 20, anchor: 0.92 },
  heli: { painter: heli, w: 30, h: 22, anchor: 0.9 },
};

const cache = new Map<string, Sprite>();

export function unitSprite(unit: UnitKind, faction: Faction): Sprite {
  const key = `${unit}:${faction}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = PAINTERS[unit];
  const sprite = make(spec.w, spec.h, faction, spec.anchor, spec.painter);
  cache.set(key, sprite);
  return sprite;
}

/** Called when the page is restored and canvases may have been dropped. */
export function clearSpriteCache(): void {
  cache.clear();
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
