import type { Base, BaseKind, Faction } from '../core/types';
import { FACTION, SNOW } from './palette';
import { roundRect } from './sprites';

/** Bases are drawn with fresh path work rather than from a bitmap: there are
 *  never more than a handful on screen, and drawing them live is what lets
 *  the flags stream, the dishes turn and a contested base shake. */

export interface BaseView {
  x: number;
  y: number;
  scale: number;
  time: number;
  selected: boolean;
  targeted: boolean;
}

export function drawBase(ctx: CanvasRenderingContext2D, base: Base, view: BaseView): void {
  const c = FACTION[base.owner];
  const s = view.scale;
  // A base under assault flinches. The shake is in screen space so it reads
  // the same however the map is zoomed.
  const shake = base.contested > 0 ? Math.sin(view.time * 42) * 1.6 * s : 0;
  const x = view.x + shake;
  const y = view.y;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  ctx.fillStyle = SNOW.deepShadow;
  ctx.beginPath();
  ctx.ellipse(4, 4, 30, 13, 0, 0, Math.PI * 2);
  ctx.fill();

  if (view.selected) ring(ctx, c.bright, 1, view.time);
  else if (view.targeted) ring(ctx, c.bright, 0.55, view.time);

  switch (base.kind) {
    case 'barracks':
      barracks(ctx, c);
      break;
    case 'factory':
      factory(ctx, c);
      break;
    case 'airbase':
      airbase(ctx, c, view.time);
      break;
    case 'hq':
      headquarters(ctx, c, view.time);
      break;
    case 'turret':
      emplacement(ctx, c, view.time);
      break;
  }

  if (base.level > 1) pips(ctx, c, base.level);

  if (base.flashCapture > 0) {
    ctx.globalAlpha = Math.min(1, base.flashCapture) * 0.75;
    ctx.fillStyle = c.trim;
    ctx.beginPath();
    ctx.arc(0, -8, 46 * (1.4 - base.flashCapture), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function ring(ctx: CanvasRenderingContext2D, colour: string, alpha: number, time: number): void {
  const pulse = 1 + Math.sin(time * 4) * 0.05;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 3;
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -time * 22;
  ctx.beginPath();
  ctx.ellipse(0, 2, 40 * pulse, 19 * pulse, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function flag(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], x: number, y: number, time: number): void {
  ctx.strokeStyle = '#f2f6f9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 26);
  ctx.stroke();
  const wave = Math.sin(time * 5) * 2;
  ctx.fillStyle = c.bright;
  ctx.beginPath();
  ctx.moveTo(x, y - 26);
  ctx.lineTo(x + 15, y - 22 + wave);
  ctx.lineTo(x, y - 15);
  ctx.closePath();
  ctx.fill();
}

function hut(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], w: number, h: number): void {
  // Snow-covered pad the building stands on.
  ctx.fillStyle = '#eef3f8';
  roundRect(ctx, -w / 2 - 5, -2, w + 10, h * 0.5 + 8, 6);
  ctx.fill();
  // Curved roof.
  ctx.fillStyle = c.main;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 2);
  ctx.lineTo(-w / 2, -h * 0.45);
  ctx.quadraticCurveTo(0, -h * 1.25, w / 2, -h * 0.45);
  ctx.lineTo(w / 2, 2);
  ctx.closePath();
  ctx.fill();
  // Lit ridge.
  ctx.fillStyle = c.bright;
  ctx.beginPath();
  ctx.moveTo(-w * 0.32, -h * 0.62);
  ctx.quadraticCurveTo(0, -h * 1.12, w * 0.32, -h * 0.62);
  ctx.quadraticCurveTo(0, -h * 0.92, -w * 0.32, -h * 0.62);
  ctx.closePath();
  ctx.fill();
  // Doorway.
  ctx.fillStyle = c.deep;
  roundRect(ctx, -w * 0.12, -h * 0.42, w * 0.24, h * 0.42, 5);
  ctx.fill();
}

function barracks(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player']): void {
  hut(ctx, c, 46, 26);
}

function factory(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player']): void {
  hut(ctx, c, 58, 30);
  // Roller door, wide enough to drive something out of.
  ctx.fillStyle = c.deep;
  roundRect(ctx, -16, -22, 32, 22, 4);
  ctx.fill();
  ctx.fillStyle = c.dark;
  for (let i = 0; i < 4; i++) ctx.fillRect(-15, -20 + i * 5, 30, 2);
  // Chimney.
  ctx.fillStyle = c.dark;
  roundRect(ctx, 18, -40, 9, 20, 3);
  ctx.fill();
}

function airbase(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], time: number): void {
  // Landing circle.
  ctx.strokeStyle = '#dbe5ee';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(-22, 6, 20, 9, 0, 0, Math.PI * 2);
  ctx.stroke();
  hut(ctx, c, 42, 24);
  // A dish that sweeps, so the base looks alive.
  const sweep = Math.sin(time * 0.9) * 0.5;
  ctx.save();
  ctx.translate(16, -26);
  ctx.rotate(sweep);
  ctx.fillStyle = c.trim;
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 5, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.restore();
}

function headquarters(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], time: number): void {
  // Wider apron.
  ctx.fillStyle = '#eaf0f6';
  roundRect(ctx, -40, -4, 80, 22, 8);
  ctx.fill();
  // Main block.
  ctx.fillStyle = c.main;
  roundRect(ctx, -32, -34, 64, 38, 6);
  ctx.fill();
  ctx.fillStyle = c.bright;
  roundRect(ctx, -32, -34, 64, 11, 6);
  ctx.fill();
  ctx.fillStyle = c.deep;
  roundRect(ctx, -9, -20, 18, 24, 4);
  ctx.fill();
  // Upper storey.
  ctx.fillStyle = c.dark;
  roundRect(ctx, -18, -50, 36, 18, 5);
  ctx.fill();
  ctx.fillStyle = c.trim;
  roundRect(ctx, -12, -45, 8, 7, 2);
  ctx.fill();
  roundRect(ctx, 2, -45, 8, 7, 2);
  ctx.fill();
  // Mast with a blinking light.
  ctx.strokeStyle = '#eef3f8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, -34);
  ctx.lineTo(24, -62);
  ctx.stroke();
  ctx.fillStyle = Math.sin(time * 4) > 0 ? '#ffe27a' : c.dark;
  ctx.beginPath();
  ctx.arc(24, -64, 3, 0, Math.PI * 2);
  ctx.fill();
  flag(ctx, c, -26, -34, time);
}

function emplacement(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], time: number): void {
  // Armoured skirt.
  ctx.fillStyle = c.deep;
  roundRect(ctx, -34, -12, 68, 26, 8);
  ctx.fill();
  ctx.fillStyle = c.dark;
  roundRect(ctx, -30, -20, 60, 22, 7);
  ctx.fill();
  // Sandbag line.
  ctx.fillStyle = '#e7eef5';
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(i * 9, 10, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Rotating gun.
  const sweep = Math.sin(time * 0.7) * 0.45;
  ctx.save();
  ctx.translate(0, -24);
  ctx.rotate(sweep);
  ctx.fillStyle = c.main;
  roundRect(ctx, -16, -12, 32, 22, 7);
  ctx.fill();
  ctx.fillStyle = c.bright;
  roundRect(ctx, -12, -10, 24, 7, 3);
  ctx.fill();
  ctx.strokeStyle = c.deep;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -4);
  ctx.lineTo(0, -30);
  ctx.stroke();
  ctx.restore();
}

/** Chevrons showing how far a base has been upgraded. */
function pips(ctx: CanvasRenderingContext2D, c: (typeof FACTION)['player'], level: number): void {
  ctx.save();
  ctx.translate(0, 16);
  for (let i = 0; i < level - 1; i++) {
    const x = (i - (level - 2) / 2) * 11;
    ctx.fillStyle = c.trim;
    ctx.strokeStyle = c.deep;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 5, 3);
    ctx.lineTo(x, -3);
    ctx.lineTo(x + 5, 3);
    ctx.lineTo(x, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export const BASE_LABEL: Record<BaseKind, string> = {
  barracks: 'Barracks',
  factory: 'Factory',
  airbase: 'Airbase',
  hq: 'HQ',
  turret: 'Gun',
};

export function factionName(f: Faction): string {
  return f === 'player' ? 'Yours' : f === 'enemy' ? 'Hostile' : 'Neutral';
}
