import type { Base, Vec2 } from '../core/types';
import type { Renderer } from '../render/renderer';
import type { World } from '../game/world';

/** Touch handling for a game that has to work one-thumbed on a phone.
 *
 *  Three gestures and no menus in the way: drag from a base you own to point
 *  troops at somewhere, drag on open ground to pan, pinch to zoom. A tap
 *  selects, so several bases can be pointed at one target in a single drag. */

export interface InputHandlers {
  onOrder(from: number[], to: number): void;
  onSelect(base: Base | null, additive: boolean): void;
  onInspect(base: Base): void;
  onGesture(): void;
}

/** A press shorter than this that barely moves counts as a tap. */
const TAP_MS = 260;
const TAP_SLOP = 14;
/** Hold this long on one of your own bases to open its details. */
const HOLD_MS = 480;

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
  base: Base | null;
  moved: boolean;
}

export class Input {
  dragFrom: Vec2 | null = null;
  dragTo: Vec2 | null = null;
  hoverTarget: number | null = null;

  private pointers = new Map<number, Pointer>();
  private pinchDistance = 0;
  private holdTimer: number | null = null;
  private panning = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: Renderer,
    private getWorld: () => World,
    private getSelection: () => Set<number>,
    private handlers: InputHandlers,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Stop the browser hijacking drags for scroll or text selection.
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  private local(e: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.handlers.onGesture();
    const p = this.local(e);
    const base = this.renderer.pick(this.getWorld(), p.x, p.y);
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      x: p.x,
      y: p.y,
      startX: p.x,
      startY: p.y,
      startedAt: performance.now(),
      base,
      moved: false,
    });

    if (this.pointers.size === 2) {
      // A second finger cancels whatever the first was doing and starts a pinch.
      this.pinchDistance = this.spread();
      this.clearHold();
      this.dragFrom = null;
      this.dragTo = null;
      this.panning = false;
      return;
    }

    if (base && base.owner === 'player') {
      this.dragFrom = this.renderer.camera.project(base.x, base.y);
      this.dragTo = p;
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        this.dragFrom = null;
        this.dragTo = null;
        this.handlers.onInspect(base);
      }, HOLD_MS);
    } else {
      this.panning = true;
    }
  };

  private onMove = (e: PointerEvent): void => {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const p = this.local(e);
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    pointer.x = p.x;
    pointer.y = p.y;
    if (Math.hypot(p.x - pointer.startX, p.y - pointer.startY) > TAP_SLOP) {
      pointer.moved = true;
      this.clearHold();
    }

    if (this.pointers.size === 2) {
      const spread = this.spread();
      if (this.pinchDistance > 0 && spread > 0) {
        const centre = this.centre();
        this.renderer.camera.zoomAt(spread / this.pinchDistance, centre.x, centre.y);
      }
      this.pinchDistance = spread;
      return;
    }

    if (this.dragFrom) {
      this.dragTo = p;
      const target = this.renderer.pick(this.getWorld(), p.x, p.y);
      this.hoverTarget = target && target.id !== pointer.base?.id ? target.id : null;
      return;
    }

    if (this.panning) this.renderer.camera.panBy(dx, dy);
  };

  private onUp = (e: PointerEvent): void => {
    const pointer = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.clearHold();
    if (!pointer) return;

    if (this.pointers.size >= 1) {
      // Coming out of a pinch: nothing to commit.
      this.pinchDistance = this.pointers.size === 2 ? this.spread() : 0;
      this.dragFrom = null;
      this.dragTo = null;
      this.hoverTarget = null;
      return;
    }

    const quick = performance.now() - pointer.startedAt < TAP_MS;
    const still = !pointer.moved;

    if (this.dragFrom && pointer.base) {
      const target = this.renderer.pick(this.getWorld(), pointer.x, pointer.y);
      if (target && target.id !== pointer.base.id) {
        // Drag from a selected base and every selected base joins the order,
        // so a two-pronged attack is one gesture rather than three.
        const selection = this.getSelection();
        const sources = selection.has(pointer.base.id)
          ? [...selection].filter((id) => this.getWorld().bases[id]?.owner === 'player')
          : [pointer.base.id];
        this.handlers.onOrder(sources, target.id);
      } else if (quick && still) {
        this.handlers.onSelect(pointer.base, false);
      }
    } else if (quick && still && !pointer.base) {
      this.handlers.onSelect(null, false);
    } else if (quick && still && pointer.base) {
      this.handlers.onSelect(pointer.base, false);
    }

    this.dragFrom = null;
    this.dragTo = null;
    this.hoverTarget = null;
    this.panning = false;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    this.renderer.camera.zoomAt(
      e.deltaY < 0 ? 1.12 : 1 / 1.12,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private centre(): Vec2 {
    const [a, b] = [...this.pointers.values()];
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: 0, y: 0 };
  }

  private clearHold(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }
}
