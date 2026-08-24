import type { Base } from '../core/types';
import type { Difficulty } from '../game/ai';
import type { World } from '../game/world';
import { CAMPAIGN } from '../game/levels';
import { BASES, MAX_LEVEL, UNITS } from '../game/balance';
import { BASE_LABEL, factionName } from '../render/bases';
import { furthestUnlocked, isUnlocked, parTime, totalStars, type Progress } from '../game/progress';

/** Builds the menus, the HUD and the dialogs. Everything here returns a plain
 *  element with its handlers already attached; the caller only decides what
 *  is on screen. */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

function stars(count: number, of = 3): HTMLElement {
  const wrap = el('div', { class: 'stars' });
  for (let i = 0; i < of; i++) {
    wrap.append(el('span', { class: i < count ? '' : 'off' }, '★'));
  }
  return wrap;
}

export interface TitleActions {
  onCampaign(): void;
  onSkirmish(): void;
  onHowTo(): void;
  onToggleSound(): void;
}

export function titleScreen(progress: Progress, actions: TitleActions): HTMLElement {
  const screen = el('div', { class: 'screen' });
  const brand = el('div', { class: 'brand' });
  brand.append(el('h1', {}, 'FRONTLINE'));
  brand.append(el('p', {}, 'Take the ground. Hold the ground.'));
  screen.append(brand);

  const earned = totalStars(progress);
  screen.append(
    el('p', { class: 'muted', style: 'text-align:center' }, `${earned} / ${CAMPAIGN.length * 3} stars earned`),
  );

  const menu = el('div', { class: 'menu' });
  // Name the mission they are up to, so the main button says where it goes.
  const next = furthestUnlocked(progress);
  const cleared = (progress.stars[CAMPAIGN[next].id] ?? 0) > 0;
  menu.append(
    button(
      cleared ? 'Campaign' : `Campaign · ${CAMPAIGN[next].name}`,
      'primary',
      actions.onCampaign,
    ),
  );
  menu.append(button('Quick skirmish', 'ghost', actions.onSkirmish));
  menu.append(button('How to play', 'ghost', actions.onHowTo));
  menu.append(
    button(progress.muted ? 'Sound: off' : 'Sound: on', 'ghost', actions.onToggleSound),
  );
  screen.append(menu);
  screen.append(el('div', { class: 'spacer' }));
  return screen;
}

export function howToScreen(onBack: () => void): HTMLElement {
  const screen = el('div', { class: 'screen' });
  const row = el('div', { class: 'row' });
  row.append(button('‹ Back', 'ghost', onBack));
  row.append(el('h2', { class: 'section' }, 'How to play'));
  screen.append(row);

  const card = el('div', { class: 'card', style: 'text-align:left' });
  const legend = el('div', { class: 'legend' });
  const item = (title: string, body: string) =>
    el('div', {}, el('b', {}, title), document.createTextNode(' ' + body));
  legend.append(item('Drag to attack.', 'Drag from a base you own onto another base to send half its garrison.'));
  legend.append(item('Tap to select.', 'Tap several of your bases, then drag from any of them to send them all at once.'));
  legend.append(item('Hold to inspect.', 'Press and hold one of your bases to see its details and spend troops on an upgrade.'));
  legend.append(item('Bases grow.', 'Every base makes troops up to a ceiling. Marching troops in can stack it higher, but the surplus drains away.'));
  legend.append(item('Rock, paper, scissors.', 'Tanks crush infantry, infantry shoot down helicopters, helicopters gut tanks.'));
  legend.append(item('Gun lines hurt.', 'Emplacements and headquarters shell anything hostile that comes near. Take them or go around them.'));
  legend.append(item('Dig-ins wear out.', 'A base defends best early on. Leave a siege long enough and its advantage fades.'));
  card.append(legend);
  screen.append(card);

  const table = el('div', { class: 'card', style: 'text-align:left' });
  table.append(el('h2', { class: 'section' }, 'Units'));
  for (const [kind, stats] of Object.entries(UNITS)) {
    table.append(
      el(
        'p',
        { class: 'muted' },
        `${stats.label} — ${stats.speed > 60 ? 'fast' : stats.speed > 40 ? 'steady' : 'slow'}, ` +
          `worth ${stats.weight.toFixed(1)} in a fight. ` +
          (kind === 'infantry'
            ? 'Cheap and quick to replace.'
            : kind === 'tank'
              ? 'Slow to build, hard to stop.'
              : 'Flies straight over the ground it crosses.'),
      ),
    );
  }
  screen.append(table);
  return screen;
}

export function levelScreen(
  progress: Progress,
  onPick: (index: number) => void,
  onBack: () => void,
): HTMLElement {
  const screen = el('div', { class: 'screen' });
  const row = el('div', { class: 'row' });
  row.append(button('‹ Back', 'ghost', onBack));
  row.append(el('h2', { class: 'section' }, 'Campaign'));
  screen.append(row);

  const grid = el('div', { class: 'levels' });
  CAMPAIGN.forEach((level, i) => {
    const unlocked = isUnlocked(progress, i);
    const card = el('button', {
      class: 'level-card',
      type: 'button',
      ...(unlocked ? {} : { disabled: 'true' }),
    });
    card.append(el('div', { class: 'no' }, `MISSION ${String(i + 1).padStart(2, '0')}`));
    card.append(el('div', { class: 'title' }, unlocked ? level.name : 'Locked'));
    card.append(el('div', { class: `tier tier-${level.difficulty}` }, level.difficulty));
    if (unlocked) {
      card.append(el('div', { class: 'brief' }, level.brief));
      card.append(stars(progress.stars[level.id] ?? 0));
    } else {
      card.append(el('div', { class: 'brief' }, 'Clear the mission before it to unlock.'));
    }
    if (unlocked) card.addEventListener('click', () => onPick(i));
    grid.append(card);
  });
  screen.append(grid);
  return screen;
}

export function skirmishScreen(
  onStart: (difficulty: Difficulty) => void,
  onBack: () => void,
): HTMLElement {
  const screen = el('div', { class: 'screen' });
  const row = el('div', { class: 'row' });
  row.append(button('‹ Back', 'ghost', onBack));
  row.append(el('h2', { class: 'section' }, 'Quick skirmish'));
  screen.append(row);

  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'muted' }, 'A mirrored valley. No advantages, no excuses — pick who you are up against.'));
  const tiers: { key: Difficulty; label: string; note: string }[] = [
    { key: 'recruit', label: 'Recruit', note: 'Slow to react, holds too much back.' },
    { key: 'veteran', label: 'Veteran', note: 'Expands steadily and defends what it takes.' },
    { key: 'elite', label: 'Elite', note: 'Attacks with a real margin and banks upgrades.' },
    { key: 'legend', label: 'Legend', note: 'Grabs every scrap of ground and commits hard.' },
  ];
  for (const tier of tiers) {
    const b = button(`${tier.label} — ${tier.note}`, tier.key === 'veteran' ? 'primary' : 'ghost', () =>
      onStart(tier.key),
    );
    b.style.textAlign = 'left';
    card.append(b);
  }
  screen.append(card);
  return screen;
}

export interface HudActions {
  onPause(): void;
  onToggleSpeed(): void;
}

export function hud(title: string, speed: number, actions: HudActions): {
  root: HTMLElement;
  update(world: World): void;
} {
  const root = el('div', { class: 'hud-top' });
  const tally = el('div', { class: 'tally' });
  const name = el('div', { class: 'name' }, title);
  const bar = el('div', { class: 'bar' });
  const mine = el('span', { class: 'mine' });
  const theirs = el('span', { class: 'theirs' });
  bar.append(mine, theirs);
  const counts = el('div', { class: 'counts' });
  tally.append(name, bar, counts);

  const speedButton = button(`${speed}×`, 'icon ghost', actions.onToggleSpeed);
  speedButton.setAttribute('aria-label', 'Change game speed');
  const pauseButton = button('❚❚', 'icon ghost', actions.onPause);
  pauseButton.setAttribute('aria-label', 'Pause');
  root.append(tally, speedButton, pauseButton);

  return {
    root,
    update(world: World) {
      const p = world.basesOf('player').length;
      const e = world.basesOf('enemy').length;
      const n = world.basesOf('neutral').length;
      const total = Math.max(1, p + e + n);
      mine.style.width = `${(p / total) * 100}%`;
      theirs.style.width = `${(e / total) * 100}%`;
      counts.replaceChildren(
        el('span', { class: 'mine' }, String(p)),
        document.createTextNode(' · '),
        el('span', { class: 'theirs' }, String(e)),
      );
      speedButton.textContent = `${speed}×`;
    },
  };
}

const ICON: Record<string, string> = {
  barracks: '⛺',
  factory: '🏭',
  airbase: '🚁',
  hq: '🏛',
  turret: '🎯',
};

export function inspector(
  world: World,
  base: Base,
  onUpgrade: () => void,
  onClose: () => void,
): HTMLElement {
  const root = el('div', { class: 'inspector' });
  const owner = base.owner;
  const colour = owner === 'player' ? '#25c25c' : owner === 'enemy' ? '#e8483f' : '#9aa5ad';
  root.append(
    el('div', { class: 'swatch', style: `background:${colour}22;color:${colour}` }, ICON[base.kind] ?? '⛺'),
  );

  const facts = el('div', { class: 'facts' });
  const stats = BASES[base.kind];
  // Keep the heading to one line on a narrow phone; the rest goes below it.
  facts.append(
    el('h3', {}, `${BASE_LABEL[base.kind]}${base.level > 1 ? ` · L${base.level}` : ''}`),
  );
  const cap = world.capacityOf(base);
  facts.append(
    el(
      'p',
      {},
      `${factionName(owner)} · ${world.displayCount(base)}/${cap} ${UNITS[stats.unit].label.toLowerCase()}` +
        (stats.turretRange > 0 ? ' · guns cover the approaches' : ''),
    ),
  );
  root.append(facts);

  if (owner === 'player') {
    if (base.level >= MAX_LEVEL) {
      root.append(button('Max level', 'ghost', onClose));
    } else {
      const cost = world.upgradeCost(base);
      const b = button(`Upgrade · ${cost}`, world.canUpgrade(base, 'player') ? 'primary' : 'ghost', onUpgrade);
      b.disabled = !world.canUpgrade(base, 'player');
      root.append(b);
    }
  } else {
    root.append(button('Close', 'ghost', onClose));
  }
  return root;
}

export function pauseSheet(actions: {
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
}): HTMLElement {
  const screen = el('div', { class: 'screen sheet' });
  const card = el('div', { class: 'card' });
  card.append(el('h2', { class: 'section' }, 'Paused'));
  card.append(button('Resume', 'primary', actions.onResume));
  card.append(button('Restart mission', 'ghost', actions.onRestart));
  card.append(button('Leave mission', 'danger', actions.onQuit));
  screen.append(card);
  return screen;
}

export interface ResultInfo {
  victory: boolean;
  levelIndex: number | null;
  stars: number;
  elapsed: number;
  taken: number;
  lost: number;
  hasNext: boolean;
}

export function resultSheet(
  info: ResultInfo,
  actions: { onNext(): void; onRetry(): void; onQuit(): void },
): HTMLElement {
  const screen = el('div', { class: 'screen sheet' });
  const card = el('div', { class: 'card' });
  card.append(
    el('h2', { class: `result-title ${info.victory ? 'win' : 'lose'}` }, info.victory ? 'Ground taken' : 'Position lost'),
  );

  if (info.victory && info.levelIndex !== null) {
    const big = el('div', { class: 'big-stars' });
    for (let i = 0; i < 3; i++) big.append(el('span', { class: i < info.stars ? '' : 'off' }, '★'));
    card.append(big);
    const par = parTime(info.levelIndex);
    card.append(
      el(
        'p',
        { class: 'muted' },
        info.stars === 3
          ? 'Clean and quick. Nothing left to prove here.'
          : info.lost > 0
            ? `Hold every base to earn the second star. Finish inside ${Math.round(par)}s for the third.`
            : `Finish inside ${Math.round(par)}s for the third star.`,
      ),
    );
  } else if (!info.victory) {
    card.append(el('p', { class: 'muted' }, 'They hold everything you had. Try a different opening.'));
  }

  const grid = el('div', { class: 'stat-grid' });
  const stat = (value: string, label: string) => {
    const s = el('div', { class: 'stat' });
    s.append(el('b', {}, value), el('span', {}, label));
    return s;
  };
  const minutes = Math.floor(info.elapsed / 60);
  const seconds = Math.round(info.elapsed % 60);
  grid.append(stat(`${minutes}:${String(seconds).padStart(2, '0')}`, 'Time'));
  grid.append(stat(String(info.taken), 'Bases taken'));
  grid.append(stat(String(info.lost), 'Bases lost'));
  card.append(grid);

  if (info.victory && info.hasNext) card.append(button('Next mission', 'primary', actions.onNext));
  card.append(button(info.victory ? 'Replay' : 'Try again', info.victory ? 'ghost' : 'primary', actions.onRetry));
  card.append(button('Back to menu', 'ghost', actions.onQuit));
  screen.append(card);
  return screen;
}

export function toast(message: string): HTMLElement {
  return el('div', { class: 'toast', role: 'status' }, message);
}
