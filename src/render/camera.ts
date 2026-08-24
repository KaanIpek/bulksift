import type { Vec2 } from '../core/types';

/** How much the ground plane is squashed vertically. The map is drawn flat
 *  and then tilted away from the viewer, which is what sells the low camera
 *  angle without any actual 3D. */
export const SQUASH = 0.74;

/** How far the drawn scenery reaches past the map, and so how far the camera
 *  may drift vertically. Must stay in step with MARGIN in terrain.ts. */
export const SCENERY = 460;

/** How far past the edge of the playable map the camera may look. The terrain
 *  is drawn further out than this, so the slack is always filled with snow
 *  and trees rather than with nothing. */
const PAD = 40;

/** A small rotation, so the map reads as a place rather than a diagram.
 *  Kept modest: everything drawn in world space turns with it, and past
 *  about fifteen degrees the formations start to look like they are sliding
 *  downhill. Labels are drawn in screen space and never rotate. */
const TILT = (-9 * Math.PI) / 180;

/** Pans and zooms over the map, and converts between the two coordinate
 *  systems. Every transform here is exactly invertible, so a finger on the
 *  glass always lands on the same patch of ground it looks like it does. */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewWidth = 0;
  viewHeight = 0;

  private cos = Math.cos(TILT);
  private sin = Math.sin(TILT);
  private minZoom = 0.5;
  private maxZoom = 2.4;

  constructor(
    private worldWidth: number,
    private worldHeight: number,
  ) {}

  setWorld(width: number, height: number): void {
    this.worldWidth = width;
    this.worldHeight = height;
    if (this.viewWidth > 0) this.resize(this.viewWidth, this.viewHeight);
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    // Fit the map's *width*. A phone in portrait is far taller than these
    // maps are deep, so matching the height instead would crop the flanks
    // off the battlefield — the one thing a strategy game cannot do. The
    // spare height above and below is filled by the surrounding terrain.
    this.minZoom = width / (this.worldWidth + PAD * 2);
    this.maxZoom = this.minZoom * 3;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
    this.clamp();
  }

  /** Open on the whole battlefield, leaning towards the given points so the
   *  player's own ground is the part nearest the thumb. */
  focus(points: Vec2[]): void {
    this.zoom = this.minZoom;
    this.x = this.worldWidth / 2;
    this.y = this.worldHeight / 2;
    if (points.length > 0) {
      let sy = 0;
      for (const p of points) sy += p.y;
      this.y = this.worldHeight / 2 + (sy / points.length - this.worldHeight / 2) * 0.35;
    }
    this.clamp();
  }

  project(wx: number, wy: number): Vec2 {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const rx = dx * this.cos - dy * this.sin;
    const ry = dx * this.sin + dy * this.cos;
    return {
      x: this.viewWidth / 2 + rx * this.zoom,
      y: this.viewHeight / 2 + ry * this.zoom * SQUASH,
    };
  }

  unproject(sx: number, sy: number): Vec2 {
    const rx = (sx - this.viewWidth / 2) / this.zoom;
    const ry = (sy - this.viewHeight / 2) / (this.zoom * SQUASH);
    return {
      x: this.x + rx * this.cos + ry * this.sin,
      y: this.y - rx * this.sin + ry * this.cos,
    };
  }

  /** Apply the world transform to a context, so world-space drawing can just
   *  use world coordinates. Screen-space overlays are drawn after a reset.
   *
   *  The device pixel ratio has to be folded in here rather than assumed:
   *  this transform replaces whatever was on the context, and dropping the
   *  ratio silently draws the whole map at half size on a retina screen,
   *  leaving the ground out of step with everything drawn in screen space. */
  applyTo(ctx: CanvasRenderingContext2D, dpr: number): void {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.viewWidth / 2, this.viewHeight / 2);
    ctx.scale(this.zoom, this.zoom * SQUASH);
    ctx.rotate(TILT);
    ctx.translate(-this.x, -this.y);
  }

  panBy(dxScreen: number, dyScreen: number): void {
    const rx = dxScreen / this.zoom;
    const ry = dyScreen / (this.zoom * SQUASH);
    this.x -= rx * this.cos + ry * this.sin;
    this.y -= -rx * this.sin + ry * this.cos;
    this.clamp();
  }

  /** Zoom about a fixed point on the glass, so pinching feels anchored. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const before = this.unproject(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const after = this.unproject(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  /** Keep the view inside the map. The rotation is small enough that
   *  clamping the unrotated extents, with the terrain drawn well past the
   *  edge, leaves no way to see past the world. */
  private clamp(): void {
    const halfW = this.viewWidth / (2 * this.zoom);
    const halfH = this.viewHeight / (2 * this.zoom * SQUASH);
    const limit = (centre: number, half: number, size: number, pad: number) => {
      const low = -pad + half;
      const high = size + pad - half;
      // If the view is wider than what it is being held inside, park it in
      // the middle rather than fighting itself at both edges.
      return low > high ? size / 2 : Math.max(low, Math.min(high, centre));
    };
    this.x = limit(this.x, halfW, this.worldWidth, PAD);
    // Vertically the leash is longer, because the spare height has to go
    // somewhere and there is real scenery out there to look at.
    this.y = limit(this.y, halfH, this.worldHeight, SCENERY);
  }
}
