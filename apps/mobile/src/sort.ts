/**
 * Which pile a scanned card belongs on.
 *
 * Scanning a bulk box answers "what do I own". Sorting one answers a different
 * question - "which of these do I take OUT of the box" - and it is the question
 * a seller is actually asking, because 95 cards in a hundred are worth less
 * than the time it takes to look at them. So the app says, per card and out
 * loud, one of three things:
 *
 *   bulk   below the keep line. Leave it in the box.
 *   keep   worth setting aside: at or above the keep line, or of unknown value.
 *   pull   at or above the pull line. Stop and sleeve it.
 *
 * The comparison this exists to win is not another phone app - it is the $799
 * hopper and the $3,000 sorting robot that do ~250 cards an hour, and the person
 * doing it by eye. Hands stay on the pile, eyes stay on the cards, and the ear
 * does the sorting.
 *
 * Pure arithmetic, no React Native: the rule that decides whether a $40 card
 * goes back in the box has to be testable without a phone.
 *
 * The one asymmetry everything here leans on: a bulk card on the keep pile
 * costs a second glance, a $40 card on the bulk pile costs $40. Every doubtful
 * case therefore resolves UPWARD - an unpriced card is kept, and every card is
 * judged by its dearest printing, not its plainest. One printing is left out of
 * that on purpose, the 1st Edition; `sortable` says why.
 * (The collection does the opposite and values a card at its plainest printing,
 * for the opposite reason: a total should not flatter. Both are right; they are
 * answering different questions.)
 */

export type Pile = 'bulk' | 'keep' | 'pull';

export interface SortRule {
  /** Off means every card sounds the same, exactly as before this existed. */
  on: boolean;
  /** Dollars. At or above this a card is set aside. */
  keepAt: number;
  /** Dollars. At or above this a card is pulled. Never below `keepAt`. */
  pullAt: number;
}

/**
 * The lines on offer.
 *
 * Steps rather than a free number field: this is set once, with a thumb, at
 * the start of a session, and nobody wants a keyboard for it. The ladders
 * follow how bulk is actually bought and sold - true bulk trades by the
 * thousand, "dollar cards" are the first thing anyone separates, and $5/$10/$20
 * are where people stop to sleeve.
 */
export const KEEP_STEPS = [0.25, 0.5, 1, 2, 5] as const;
export const PULL_STEPS = [5, 10, 20, 50, 100] as const;

export const DEFAULT_RULE: SortRule = { on: false, keepAt: 1, pullAt: 10 };

/** Repair whatever was on disk into a rule the scanner can run on. */
export function normaliseRule(raw: unknown): SortRule {
  if (!raw || typeof raw !== 'object') return DEFAULT_RULE;
  const r = raw as Partial<SortRule>;
  const pick = (v: unknown, steps: readonly number[], fallback: number) =>
    typeof v === 'number' && steps.includes(v) ? v : fallback;
  const keepAt = pick(r.keepAt, KEEP_STEPS, DEFAULT_RULE.keepAt);
  let pullAt = pick(r.pullAt, PULL_STEPS, DEFAULT_RULE.pullAt);
  // A pull line under the keep line would make "keep" unreachable. Both ladders
  // meet at 5, so this can only happen with a hand-edited file; lift, never drop.
  if (pullAt < keepAt) pullAt = keepAt;
  return { on: r.on === true, keepAt, pullAt };
}

/** The next value on a ladder, wrapping - what one tap on the row does. */
export function nextStep(steps: readonly number[], current: number): number {
  const i = steps.indexOf(current);
  return steps[(i + 1) % steps.length];
}

/** Move the keep line one step, keeping the pull line at or above it. */
export function cycleKeep(rule: SortRule): SortRule {
  const keepAt = nextStep(KEEP_STEPS, rule.keepAt);
  return { ...rule, keepAt, pullAt: Math.max(rule.pullAt, keepAt) };
}

/** Move the pull line one step, skipping any step below the keep line. */
export function cyclePull(rule: SortRule): SortRule {
  let pullAt = nextStep(PULL_STEPS, rule.pullAt);
  for (let i = 0; i < PULL_STEPS.length && pullAt < rule.keepAt; i++) {
    pullAt = nextStep(PULL_STEPS, pullAt);
  }
  return { ...rule, pullAt };
}

/**
 * The price a card is SORTED by, which is not the price it is valued at.
 *
 * `candidates` is every price this piece of cardboard could carry: each
 * printing of the card that was read (normal, holo, reverse holo) and, when the
 * engine could not settle between two reprints, the other card's prices too.
 *
 * The answer is the dearest of them, always - not only when the read is
 * flagged unsure. The camera matches artwork; it cannot see foil, so the
 * printing is never actually known from a scan. A reverse holo worth $30 and
 * the common worth $0.10 are the same picture until someone tilts the card,
 * and "tilt it" is exactly what the keep cue asks for.
 *
 * Returns null when nothing is priced at all.
 */
export function sortPrice(
  candidates: ReadonlyArray<number | null | undefined>,
): number | null {
  const known = candidates.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p),
  );
  return known.length ? Math.max(...known) : null;
}

/** A printing as the sorter sees it: what it is called and what it sells for. */
export interface Printing {
  variant?: string;
  market?: number | null;
}

const isPriced = (v: Printing) => typeof v.market === 'number' && Number.isFinite(v.market);
const isFirstEdition = (v: Printing) => (v.variant ?? '').startsWith('1st Edition');
const isUnlimited = (v: Printing) => (v.variant ?? '').startsWith('Unlimited');

/**
 * The printings a card is sorted by: all of them, except a 1st Edition that
 * has a priced Unlimited twin.
 *
 * "Dearest printing" was written with the reverse holo in mind - one in every
 * pack, so one card in ten really is the dear one. A 1st Edition stamp is not
 * like that. It exists on 935 cards in ten sets (Base to Neo Destiny), it sells
 * for about three times its Unlimited twin (median 2.9x), and almost nobody's
 * box has one. Judged by it, 201 of those sets' 568 commons and uncommons rang
 * "pull" at the default $10 line - a stop signal on every third card of a
 * childhood box, for a stamp that is not there. Judged by the Unlimited twin,
 * 49 do. (`test/_sort_eras.ts`, price book of 24 November 2026.)
 *
 * What it costs, and it is not nothing: a real 1st Edition now sounds like its
 * Unlimited twin. 223 printings stop ringing "pull"; 219 of them still ring
 * "keep", and 146 that were worth a dollar or more now pass as bulk (4 of them
 * worth $10 or more). The owner chose that trade on 28 November 2026, and
 * `firstEditionSetAside` is what softens it: the list flags every such card so
 * the stamp can be checked afterwards, at the table rather than mid-pile.
 *
 * When the Unlimited twin has no price the 1st Edition stays in - doubt still
 * resolves upward. Reverse holos and holos are untouched.
 */
export function sortable<T extends Printing>(variants: ReadonlyArray<T>): T[] {
  if (!variants.some((v) => isUnlimited(v) && isPriced(v))) return variants.slice();
  return variants.filter((v) => !isFirstEdition(v));
}

/** True when `sortable` left a 1st Edition out: the card to check for a stamp. */
export function firstEditionSetAside(variants: ReadonlyArray<Printing>): boolean {
  return sortable(variants).length !== variants.length;
}

/** The parts of a scan hit this file needs, so it need not import the engine. */
export interface SortableHit {
  variants: ReadonlyArray<Printing>;
  ambiguity?: { alternatives: ReadonlyArray<{ card: { i: string } }> };
}

/**
 * Every price a hit could carry: its own printings, and the printings of any
 * reprint the engine could not rule out.
 */
export function hitCandidates(
  hit: SortableHit,
  pricesFor: (cardId: string) => ReadonlyArray<Printing>,
): Array<number | null | undefined> {
  // Card by card: one reprint having an Unlimited twin says nothing about another.
  const out: Array<number | null | undefined> = sortable(hit.variants).map((v) => v.market);
  for (const alt of hit.ambiguity?.alternatives ?? []) {
    for (const v of sortable(pricesFor(alt.card.i))) out.push(v.market);
  }
  return out;
}

/** Which pile a scan hit goes on, or null when sorting is off. */
export function pileOfHit(
  hit: SortableHit,
  pricesFor: (cardId: string) => ReadonlyArray<Printing>,
  rule: SortRule,
): Pile | null {
  if (!rule.on) return null;
  return pileFor(sortPrice(hitCandidates(hit, pricesFor)), rule);
}

/** Which pile a card with this sort price goes on. */
export function pileFor(price: number | null, rule: SortRule): Pile {
  // Unknown value is never bulk. See the asymmetry at the top of the file.
  if (price == null || !Number.isFinite(price)) return 'keep';
  if (price >= rule.pullAt) return 'pull';
  if (price >= rule.keepAt) return 'keep';
  return 'bulk';
}

export interface Tally {
  bulk: { count: number; value: number };
  keep: { count: number; value: number };
  pull: { count: number; value: number };
}

export const emptyTally = (): Tally => ({
  bulk: { count: 0, value: 0 },
  keep: { count: 0, value: 0 },
  pull: { count: 0, value: 0 },
});

/**
 * Count one card onto a pile, or (n = -1) take it back off.
 *
 * `value` is the card's recorded value - the plain price - so the three piles
 * add up to the session total on the same screen. A pile cannot go negative: an
 * undo that arrives after a session reset has nothing to take back.
 */
export function tally(t: Tally, pile: Pile, value: number | null, n: 1 | -1 = 1): Tally {
  const v = value != null && Number.isFinite(value) ? value : 0;
  const cur = t[pile];
  const count = Math.max(0, cur.count + n);
  return {
    ...t,
    [pile]: { count, value: count === 0 ? 0 : Math.max(0, cur.value + n * v) },
  };
}

export const PILE_LABEL: Record<Pile, string> = { bulk: 'BULK', keep: 'KEEP', pull: 'PULL' };

const dollars = (n: number) => (n < 1 ? `${Math.round(n * 100)}¢` : `$${n}`);

/** One line saying what the rule does, for Settings and the scan screen. */
export function ruleLabel(rule: SortRule): string {
  if (!rule.on) return 'Off';
  return rule.pullAt === rule.keepAt
    ? `Pull ${dollars(rule.pullAt)}+`
    : `Keep ${dollars(rule.keepAt)}+ · Pull ${dollars(rule.pullAt)}+`;
}

export const stepLabel = dollars;
