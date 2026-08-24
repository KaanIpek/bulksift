import './ui/styles.css';
import type { Base, Outcome } from './core/types';
import { World } from './game/world';
import { AiCommander, type Difficulty } from './game/ai';
import { CAMPAIGN, SKIRMISH } from './game/levels';
import {
  loadProgress,
  ratePerformance,
  saveProgress,
  type Progress,
} from './game/progress';
import { Renderer } from './render/renderer';
import { Input } from './ui/input';
import { sfx } from './audio/sfx';
import {
  hud,
  howToScreen,
  inspector,
  levelScreen,
  pauseSheet,
  resultSheet,
  skirmishScreen,
  titleScreen,
  toast,
} from './ui/screens';

type Mode = 'title' | 'levels' | 'skirmish' | 'howto' | 'playing' | 'paused' | 'result';

/** Never simulate more than a quarter second per frame: coming back to a
 *  backgrounded tab should not fast-forward the battle. */
const MAX_STEP = 0.25;

class Game {
  private canvas = document.getElementById('game') as HTMLCanvasElement;
  private ui = document.getElementById('ui') as HTMLDivElement;
  private renderer: Renderer;
  private input: Input;
  private world: World;
  private enemy: AiCommander;
  /** Only set while a demo battle is playing itself behind the menus. */
  private demo: AiCommander | null = null;

  private progress: Progress = loadProgress();
  private mode: Mode = 'title';
  private levelIndex: number | null = null;
  private difficulty: Difficulty = 'veteran';
  private speed = 1;
  private selected = new Set<number>();
  private inspecting: Base | null = null;
  private hudView: ReturnType<typeof hud> | null = null;
  private lastFrame = 0;
  private clock = 0;
  private toastTimer: number | null = null;

  constructor() {
    this.world = new World(SKIRMISH, 7);
    this.renderer = new Renderer(this.canvas, SKIRMISH);
    this.enemy = new AiCommander(this.world, 'veteran', 'enemy', 11);
    this.input = new Input(
      this.canvas,
      this.renderer,
      () => this.world,
      () => this.selected,
      {
        onOrder: (sources, to) => this.order(sources, to),
        onSelect: (base, additive) => this.select(base, additive),
        onInspect: (base) => this.inspect(base),
        onGesture: () => sfx.unlock(),
      },
    );

    sfx.setMuted(this.progress.muted);
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.pause();
    });

    this.renderer.resize();
    this.showTitle();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------- screens ----------

  private setScreen(...nodes: (HTMLElement | null)[]): void {
    this.ui.replaceChildren(...nodes.filter((n): n is HTMLElement => n !== null));
  }

  private showTitle(): void {
    this.mode = 'title';
    // The menu sits over a battle playing itself, so the game is never a
    // still image while somebody decides what to tap.
    this.startDemo();
    this.setScreen(
      titleScreen(this.progress, {
        onCampaign: () => this.showLevels(),
        onSkirmish: () => this.showSkirmish(),
        onHowTo: () => this.showHowTo(),
        onToggleSound: () => {
          this.progress.muted = !this.progress.muted;
          sfx.setMuted(this.progress.muted);
          saveProgress(this.progress);
          this.showTitle();
        },
      }),
    );
  }

  private showLevels(): void {
    this.mode = 'levels';
    sfx.play('tap');
    this.setScreen(
      levelScreen(
        this.progress,
        (index) => this.startCampaign(index),
        () => this.showTitle(),
      ),
    );
  }

  private showSkirmish(): void {
    this.mode = 'skirmish';
    sfx.play('tap');
    this.setScreen(
      skirmishScreen(
        (difficulty) => this.startSkirmish(difficulty),
        () => this.showTitle(),
      ),
    );
  }

  private showHowTo(): void {
    this.mode = 'howto';
    sfx.play('tap');
    this.setScreen(howToScreen(() => this.showTitle()));
  }

  // ---------- running a match ----------

  private startDemo(): void {
    this.levelIndex = null;
    const seed = Math.floor(Math.random() * 100000);
    this.world = new World(SKIRMISH, seed);
    this.renderer.setLevel(SKIRMISH);
    this.enemy = new AiCommander(this.world, 'elite', 'enemy', seed + 1);
    this.demo = new AiCommander(this.world, 'elite', 'player', seed + 2);
    this.selected.clear();
    this.inspecting = null;
    this.renderer.camera.focus(SKIRMISH.bases);
  }

  private startCampaign(index: number): void {
    const level = CAMPAIGN[index];
    this.levelIndex = index;
    this.difficulty = level.difficulty;
    this.beginMatch(index, level.name);
  }

  private startSkirmish(difficulty: Difficulty): void {
    this.levelIndex = null;
    this.difficulty = difficulty;
    this.beginMatch(null, `Skirmish · ${difficulty}`);
  }

  private beginMatch(index: number | null, title: string): void {
    const level = index === null ? SKIRMISH : CAMPAIGN[index];
    const seed = Math.floor(Math.random() * 100000);
    this.world = new World(level, seed);
    this.renderer.setLevel(level);
    this.enemy = new AiCommander(this.world, this.difficulty, 'enemy', seed + 1);
    this.demo = null;
    this.selected.clear();
    this.inspecting = null;
    this.speed = 1;
    this.mode = 'playing';
    // Open on the player's own ground, so the first thing on screen is
    // something they can act on.
    this.renderer.camera.focus(level.bases.filter((b) => b.owner === 'player'));

    this.hudView = hud(title, this.speed, {
      onPause: () => this.pause(),
      onToggleSpeed: () => {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
        this.refreshHud();
        sfx.play('tap');
      },
    });
    this.refreshHud();
  }

  private refreshHud(): void {
    if (!this.hudView) return;
    // Rebuild so the speed button label follows the current setting.
    const title = this.hudView.root.querySelector('.name')?.textContent ?? '';
    this.hudView = hud(title, this.speed, {
      onPause: () => this.pause(),
      onToggleSpeed: () => {
        this.speed = this.speed === 1 ? 2 : this.speed === 2 ? 3 : 1;
        this.refreshHud();
        sfx.play('tap');
      },
    });
    this.hudView.update(this.world);
    this.setScreen(this.hudView.root, this.inspectorNode());
  }

  private inspectorNode(): HTMLElement | null {
    if (!this.inspecting) return null;
    const live = this.world.bases[this.inspecting.id];
    if (!live) return null;
    return inspector(
      this.world,
      live,
      () => {
        if (this.world.upgrade(live.id, 'player')) {
          sfx.play('upgrade');
          this.buzz(20);
        }
        this.refreshHud();
      },
      () => {
        this.inspecting = null;
        this.refreshHud();
      },
    );
  }

  private pause(): void {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.setScreen(
      this.hudView?.root ?? null,
      pauseSheet({
        onResume: () => {
          this.mode = 'playing';
          this.refreshHud();
        },
        onRestart: () => {
          if (this.levelIndex !== null) this.startCampaign(this.levelIndex);
          else this.startSkirmish(this.difficulty);
        },
        onQuit: () => this.showTitle(),
      }),
    );
  }

  private finish(outcome: Outcome): void {
    this.mode = 'result';
    const victory = outcome === 'victory';
    sfx.play(victory ? 'victory' : 'defeat');
    this.buzz(victory ? 40 : 80);

    let earned = 0;
    if (victory && this.levelIndex !== null) {
      earned = ratePerformance(this.levelIndex, this.world.stats.elapsed, this.world.stats.basesLost);
      const id = CAMPAIGN[this.levelIndex].id;
      this.progress.stars[id] = Math.max(this.progress.stars[id] ?? 0, earned);
      saveProgress(this.progress);
    }

    const hasNext = this.levelIndex !== null && this.levelIndex + 1 < CAMPAIGN.length;
    this.setScreen(
      this.hudView?.root ?? null,
      resultSheet(
        {
          victory,
          levelIndex: this.levelIndex,
          stars: earned,
          elapsed: this.world.stats.elapsed,
          taken: this.world.stats.basesTaken,
          lost: this.world.stats.basesLost,
          hasNext,
        },
        {
          onNext: () => this.startCampaign((this.levelIndex ?? 0) + 1),
          onRetry: () => {
            if (this.levelIndex !== null) this.startCampaign(this.levelIndex);
            else this.startSkirmish(this.difficulty);
          },
          onQuit: () => this.showTitle(),
        },
      ),
    );
  }

  // ---------- player orders ----------

  private order(sources: number[], to: number): void {
    let sent = 0;
    for (const from of sources) {
      if (this.world.send(from, to, 'player')) sent++;
    }
    if (sent > 0) {
      sfx.play('send');
      this.buzz(12);
    } else {
      this.flash('Not enough troops to send');
    }
  }

  private select(base: Base | null, additive: boolean): void {
    if (!base) {
      if (this.selected.size > 0) sfx.play('deselect');
      this.selected.clear();
      this.inspecting = null;
      this.refreshHud();
      return;
    }
    if (base.owner !== 'player') {
      this.inspecting = base;
      sfx.play('tap');
      this.refreshHud();
      return;
    }
    if (!additive && !this.selected.has(base.id)) {
      // Tapping a fresh base replaces the selection; tapping one already in
      // it drops just that one, so building a group stays forgiving.
      this.selected.clear();
    }
    if (this.selected.has(base.id)) this.selected.delete(base.id);
    else this.selected.add(base.id);
    this.inspecting = this.selected.size === 1 ? base : null;
    sfx.play(this.selected.size > 0 ? 'select' : 'deselect');
    this.refreshHud();
  }

  private inspect(base: Base): void {
    this.inspecting = base;
    this.selected.clear();
    if (base.owner === 'player') this.selected.add(base.id);
    sfx.play('select');
    this.buzz(10);
    this.refreshHud();
  }

  private flash(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const node = toast(message);
    this.ui.append(node);
    this.toastTimer = window.setTimeout(() => node.remove(), 1600);
  }

  private buzz(ms: number): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // Vibration is a nicety; a device without it plays exactly the same.
    }
  }

  /** Screen position of a base, for the screenshot harness. */
  locate(id: number): { x: number; y: number } | null {
    const base = this.world.bases[id];
    return base ? this.renderer.screenOf(base) : null;
  }

  /** A short description of what is going on, for the screenshot harness. */
  snapshot(): Record<string, unknown> {
    return {
      mode: this.mode,
      outcome: this.world.outcome,
      player: this.world.basesOf('player').length,
      enemy: this.world.basesOf('enemy').length,
      squads: this.world.squads.length,
      elapsed: Math.round(this.world.stats.elapsed),
    };
  }

  // ---------- the loop ----------

  private loop(now: number): void {
    const dt = Math.min((now - this.lastFrame) / 1000 || 0, MAX_STEP);
    this.lastFrame = now;
    this.clock += dt;

    const running = this.mode === 'playing' || this.demo !== null;
    if (running) {
      const step = dt * (this.demo ? 1 : this.speed);
      this.enemy.update(step);
      this.demo?.update(step);
      const before = this.world.outcome;
      this.world.update(step);
      this.renderer.drainEvents(this.world);
      this.reactToEvents();
      if (this.mode === 'playing' && before === 'playing' && this.world.outcome !== 'playing') {
        this.finish(this.world.outcome);
      }
      if (this.demo && this.world.outcome !== 'playing') this.startDemo();
      this.hudView?.update(this.world);
    }

    this.renderer.fx.update(dt);
    this.renderer.draw(this.world, {
      selected: this.selected,
      hoverTarget: this.input.hoverTarget,
      dragFrom: this.input.dragFrom,
      dragTo: this.input.dragTo,
      time: this.clock,
    });

    requestAnimationFrame((t) => this.loop(t));
  }

  /** Sounds that follow from what just happened in the simulation. */
  private reactToEvents(): void {
    if (this.mode !== 'playing') return;
    for (const base of this.world.bases) {
      if (base.flashCapture > 0.85) {
        sfx.play(base.owner === 'player' ? 'capture' : 'lost');
        this.buzz(base.owner === 'player' ? 25 : 45);
      }
    }
  }
}

const game = new Game();

// Exposed so the screenshot harness in scripts/ can find a base on the glass
// and drive a real drag. Read-only from the outside, and harmless if nobody
// is looking.
(window as unknown as { frontline: unknown }).frontline = {
  baseAt: (id: number) => game.locate(id),
  state: () => game.snapshot(),
};
