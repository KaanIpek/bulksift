import { CAMPAIGN } from './levels';

/** What the player has finished, kept in local storage. Nothing here is
 *  secret or worth defending, so it is stored plainly and any unreadable
 *  save is simply started over rather than crashing the game. */

const KEY = 'frontline.progress.v1';

export interface Progress {
  stars: Record<string, number>;
  muted: boolean;
}

const empty = (): Progress => ({ stars: {}, muted: false });

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return {
      stars: typeof parsed.stars === 'object' && parsed.stars ? parsed.stars : {},
      muted: parsed.muted === true,
    };
  } catch {
    return empty();
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    // A private window with storage blocked still plays; it just forgets.
  }
}

/** A level opens once the one before it has been cleared. */
export function isUnlocked(progress: Progress, index: number): boolean {
  if (index <= 0) return true;
  return (progress.stars[CAMPAIGN[index - 1].id] ?? 0) > 0;
}

export function furthestUnlocked(progress: Progress): number {
  let i = 0;
  while (i + 1 < CAMPAIGN.length && isUnlocked(progress, i + 1)) i++;
  return i;
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.stars).reduce((s, n) => s + n, 0);
}

/** Par time for three stars: a bigger map fairly takes longer. */
export function parTime(index: number): number {
  return 110 + CAMPAIGN[index].bases.length * 22;
}

/** One star for winning, one for keeping every base, one for speed. */
export function ratePerformance(index: number, elapsed: number, basesLost: number): number {
  let stars = 1;
  if (basesLost === 0) stars++;
  if (elapsed <= parTime(index)) stars++;
  return stars;
}
