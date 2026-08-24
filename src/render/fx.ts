import type { Faction } from '../core/types';
import { Rng } from '../core/rng';
import { FACTION } from './palette';

/** Short-lived visual noise: sparks where columns meet, tracers from the gun
 *  lines, a ring when a base changes hands, and floating numbers so losses
 *  and gains are readable without watching the badges. */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  life: number;
  colour: string;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  colour: string;
}

interface Floater {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  colour: string;
}

export class Fx {
  private sparks: Spark[] = [];
  private tracers: Tracer[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private rng = new Rng(0xf00d);

  clash(x: number, y: number, owner: Faction): void {
    // A clash fires every tick while two columns are in contact, so keep the
    // per-event cost tiny and let the density do the work.
    if (this.sparks.length > 260) return;
    const c = FACTION[owner];
    for (let i = 0; i < 2; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(18, 62);
      this.sparks.push({
        x: x + this.rng.range(-6, 6),
        y: y + this.rng.range(-6, 6),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: 0.42,
        maxLife: 0.42,
        size: this.rng.range(1.4, 3),
        colour: this.rng.next() > 0.5 ? c.bright : '#ffe9a8',
      });
    }
  }

  tracer(x0: number, y0: number, x1: number, y1: number, owner: Faction): void {
    this.tracers.push({ x0, y0, x1, y1, life: 0.16, colour: FACTION[owner].bright });
  }

  capture(x: number, y: number, owner: Faction): void {
    this.rings.push({ x, y, life: 0.85, maxLife: 0.85, colour: FACTION[owner].bright });
    const c = FACTION[owner];
    for (let i = 0; i < 22; i++) {
      const angle = (i / 22) * Math.PI * 2;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * 120,
        vy: Math.sin(angle) * 70 - 30,
        life: 0.7,
        maxLife: 0.7,
        size: 3,
        colour: c.bright,
      });
    }
  }

  float(x: number, y: number, text: string, owner: Faction): void {
    this.floaters.push({ x, y, life: 1.1, maxLife: 1.1, text, colour: FACTION[owner].bright });
  }

  update(dt: number): void {
    for (const s of this.sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 150 * dt;
    }
    for (const t of this.tracers) t.life -= dt;
    for (const r of this.rings) r.life -= dt;
    for (const f of this.floaters) {
      f.life -= dt;
      f.y -= 26 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    this.tracers = this.tracers.filter((t) => t.life > 0);
    this.rings = this.rings.filter((r) => r.life > 0);
    this.floaters = this.floaters.filter((f) => f.life > 0);
  }

  clear(): void {
    this.sparks.length = 0;
    this.tracers.length = 0;
    this.rings.length = 0;
    this.floaters.length = 0;
  }

  /** Drawn in screen space; the caller has already projected the positions
   *  it handed in, so this just paints. */
  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.save();
    ctx.lineCap = 'round';

    for (const t of this.tracers) {
      ctx.globalAlpha = Math.max(0, t.life / 0.16);
      ctx.strokeStyle = t.colour;
      ctx.lineWidth = 2.5 * scale;
      ctx.beginPath();
      ctx.moveTo(t.x0, t.y0);
      ctx.lineTo(t.x1, t.y1);
      ctx.stroke();
    }

    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = 4 * scale * (1 - t);
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 20 + t * 90 * scale, (20 + t * 90 * scale) * 0.45, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of this.sparks) {
      ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
      ctx.fillStyle = s.colour;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(15 * scale)}px system-ui, -apple-system, sans-serif`;
    for (const f of this.floaters) {
      const t = f.life / f.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.6);
      ctx.lineWidth = 3.5 * scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.colour;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }
}
