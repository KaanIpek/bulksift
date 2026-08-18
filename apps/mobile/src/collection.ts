/**
 * The collection: what you own, what it is worth, and what you are missing.
 *
 * Scanning without this is a stopwatch - the numbers vanish when the app
 * closes. Every other screen reads from here.
 *
 * Pure functions only. Reading and writing the file lives in
 * `collectionStore.ts`, so the arithmetic that decides how many cards you own
 * can be tested without a device or a native module attached.
 *
 * An entry is keyed by card + variant + condition, because those are the three
 * things that change what a card is worth. Two Charizards in different sleeves
 * are one entry with quantity 2; a Near Mint and a Damaged one are not.
 */

import type { CardRecord, PricedVariant } from '@bulksift/core';
import type { Point as HistoryPoint } from './history';

/** TCGplayer's condition ladder, worst to best, with what the market pays. */
export const CONDITIONS = [
  { id: 'NM', label: 'Near Mint', multiplier: 1.0 },
  { id: 'LP', label: 'Lightly Played', multiplier: 0.85 },
  { id: 'MP', label: 'Moderately Played', multiplier: 0.7 },
  { id: 'HP', label: 'Heavily Played', multiplier: 0.5 },
  { id: 'DM', label: 'Damaged', multiplier: 0.35 },
] as const;

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export const conditionOf = (id: ConditionId) =>
  CONDITIONS.find((c) => c.id === id) ?? CONDITIONS[0];

/**
 * Condition multipliers are estimates, and are labelled as such in the UI.
 *
 * Real condition pricing is per-card and moves with demand; a single ladder
 * cannot be exact. It is still far better than pricing every played card as
 * Near Mint, which is what pretending the axis does not exist amounts to.
 */
export const CONDITION_NOTE =
  'Played conditions are estimated from the Near Mint price using standard ' +
  'market ratios. Near Mint prices come straight from TCGplayer.';

/**
 * Graded slabs, tracked but not priced.
 *
 * A graded card is a different asset from the raw one - a PSA 10 routinely goes
 * for several times the raw price - and every competitor either charges for
 * graded pricing or omits it. There is no graded price feed here, so inventing
 * a multiplier would be inventing money. Instead the grade is recorded, the
 * card is counted, and its value is shown as the raw price with the grade
 * beside it and a note that the slab is worth more than that.
 *
 * That is the honest version: the collection knows what you own, and does not
 * pretend to know what a slab sells for.
 */
export const GRADERS = ['PSA', 'BGS', 'CGC', 'SGC', 'ACE', 'TAG'] as const;
export type Grader = (typeof GRADERS)[number];

export interface Grade {
  grader: Grader;
  /** 1..10, in halves for BGS. Stored as a number so it sorts. */
  score: number;
}

export const gradeLabel = (g: Grade) =>
  `${g.grader} ${Number.isInteger(g.score) ? g.score : g.score.toFixed(1)}`;

export const GRADED_NOTE =
  'Graded slabs are counted at the raw market price. There is no graded price ' +
  'feed on the device, and a slab is usually worth considerably more.';

export interface Entry {
  /** Stable key: card id, variant and condition together. */
  key: string;
  cardId: string;
  /** Denormalised so the collection renders without the 20k catalogue loaded. */
  name: string;
  setName: string;
  setId: string;
  number: string;
  rarity: string | null;
  variant: string;
  condition: ConditionId;
  quantity: number;
  /** Near Mint market price for this variant when it was last refreshed. */
  unitPrice: number | null;
  /** Epoch ms of the first and most recent time this entry was touched. */
  addedAt: number;
  updatedAt: number;
  /** Set by the scanner when two printings could not be told apart. */
  needsPrinting?: boolean;
  /** Present when this pile is a graded slab rather than a raw card. */
  grade?: Grade;
}

export interface WishEntry {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  unitPrice: number | null;
  addedAt: number;
}

/** Add or remove a card from the want list. Toggling is the whole interaction. */
export function toggleWish(
  list: WishEntry[],
  card: CardRecord,
  price: number | null,
): WishEntry[] {
  const at = list.findIndex((w) => w.cardId === card.i);
  if (at >= 0) return list.filter((_, i) => i !== at);
  return [
    {
      cardId: card.i,
      name: card.n,
      setName: card.S,
      number: card.u,
      unitPrice: price,
      addedAt: Date.now(),
    },
    ...list,
  ];
}

/** What the want list would cost to buy at today's prices. */
export const wishlistValue = (list: WishEntry[]) =>
  list.reduce((sum, w) => sum + (w.unitPrice ?? 0), 0);

/** The whole file, as written to disk. */
export interface Persisted {
  version: 1;
  entries: Entry[];
  wishlist: WishEntry[];
  /** Daily value points, recorded from the day this shipped. See history.ts. */
  history?: HistoryPoint[];
}

export const entryKey = (
  cardId: string,
  variant: string,
  condition: ConditionId,
  grade?: Grade,
) => `${cardId}|${variant}|${condition}${grade ? `|${grade.grader}${grade.score}` : ''}`;

/**
 * What one entry is worth: price for the variant, scaled by condition.
 *
 * A graded slab is not discounted - the grade already describes its state, and
 * applying a played multiplier on top would be wrong twice over. It is also not
 * marked up, because nothing here knows what a slab sells for.
 */
export function entryValue(e: Entry): number {
  if (e.unitPrice == null) return 0;
  const multiplier = e.grade ? 1 : conditionOf(e.condition).multiplier;
  return e.unitPrice * multiplier * e.quantity;
}

export function totalValue(entries: Entry[]): number {
  let sum = 0;
  for (const e of entries) sum += entryValue(e);
  return sum;
}

export function totalCards(entries: Entry[]): number {
  let n = 0;
  for (const e of entries) n += e.quantity;
  return n;
}

/**
 * Re-price every pile against a fresher price book.
 *
 * A card's price is stored on the entry when it is scanned, because the
 * collection has to render and total itself without the 20k catalogue loaded.
 * The cost of that is a snapshot: a card scanned in March still says March's
 * price, and a collection is a list of prices from every date you ever scanned
 * on - which makes the headline total meaningless and the value chart a record
 * of when you scanned rather than what happened to the market.
 *
 * So a price refresh has to walk the collection too. Three rules:
 *
 *  - The variant and condition the user chose are never changed. Only the
 *    number attached to them moves.
 *  - A card the new book has no price for keeps the price it had. A refresh
 *    that silently zeroes a card because a feed dropped it for a day would
 *    take real money off the total.
 *  - Nothing else on the entry is touched, including `updatedAt`. A repricing
 *    is not the user handling the card, and stamping it would push every pile
 *    to the top of a "recent" sort and make the scan feed's undo point at the
 *    wrong thing.
 *
 * Returns the same array when no price moved, so an unchanged refresh costs no
 * render and no disk write.
 */
export function reprice(
  entries: Entry[],
  priceFor: (cardId: string, variant: string) => number | null,
): Entry[] {
  let changed = false;
  const next = entries.map((e) => {
    const fresh = priceFor(e.cardId, e.variant);
    if (fresh == null || fresh === e.unitPrice) return e;
    changed = true;
    return { ...e, unitPrice: fresh };
  });
  return changed ? next : entries;
}

/** The same, for the want list, which is priced the same way. */
export function repriceWishlist(
  list: WishEntry[],
  priceFor: (cardId: string) => number | null,
): WishEntry[] {
  let changed = false;
  const next = list.map((w) => {
    const fresh = priceFor(w.cardId);
    if (fresh == null || fresh === w.unitPrice) return w;
    changed = true;
    return { ...w, unitPrice: fresh };
  });
  return changed ? next : list;
}

/** The variant a scan should default to: the priciest one that has a price. */
/**
 * Printings in the order a bulk scan should assume, plainest first.
 *
 * A scan sees the picture, and the picture is identical across printings - the
 * difference is foil, which the descriptor deliberately does not encode because
 * it changes with every angle of the light. So the printing is a guess, and
 * this is the order that guess is made in.
 */
const PLAIN_FIRST = ['Normal', 'Unlimited', '1st Edition', 'Holofoil'];

/**
 * The printing to assume for a freshly scanned card, and what it is worth.
 *
 * This used to take the DEAREST printing, and that is the single most damaging
 * thing a scanner can do. Measured against this app's own price data, 13,793
 * cards - two thirds of the catalogue - have more than one priced printing, and
 * taking the maximum overstates the median card by 2.4x, the 90th percentile by
 * 10x, and one card by 323x. One of each card comes to $74,600 at the plain
 * printing and $231,098 at the dearest.
 *
 * That is not a hypothetical. The best-known competitor shipped exactly this
 * and its App Store reviews say so: "it heavily over values cards up front and
 * once you check it it's typically worth about 1/10th of what it tells you" -
 * the developer confirmed the app "defaulted to Holo/Reverse Card Prices". A
 * tenth is our 90th percentile. Their scanning is good and nobody believes
 * their numbers.
 *
 * So the plain printing wins, and where none is priced the CHEAPEST does. Both
 * directions are guesses; only one of them makes a collection total worth
 * acting on. A pile that is worth more than the app says is a good surprise,
 * and `needsPrinting` puts a PICK PRINTING badge on every card where the guess
 * was live, so it can be corrected in one tap.
 */
export function defaultVariant(variants: PricedVariant[]): { name: string; price: number | null } {
  const priced = variants.filter((v) => v.market != null);
  if (!priced.length) return { name: variants[0]?.variant ?? 'Normal', price: null };
  for (const want of PLAIN_FIRST) {
    const hit = priced.find((v) => v.variant === want);
    if (hit) return { name: hit.variant, price: hit.market ?? null };
  }
  const cheapest = priced.reduce((a, b) => ((b.market ?? 0) < (a.market ?? 0) ? b : a));
  return { name: cheapest.variant, price: cheapest.market ?? null };
}

/** Add one scanned card, merging into an existing entry when it matches. */
export function addScan(
  entries: Entry[],
  card: CardRecord,
  variant: string,
  price: number | null,
  condition: ConditionId,
  needsPrinting: boolean,
): Entry[] {
  const key = entryKey(card.i, variant, condition);
  const now = Date.now();
  const at = entries.findIndex((e) => e.key === key);
  if (at >= 0) {
    const next = entries.slice();
    next[at] = {
      ...next[at],
      quantity: next[at].quantity + 1,
      unitPrice: price ?? next[at].unitPrice,
      updatedAt: now,
      needsPrinting: next[at].needsPrinting || needsPrinting,
    };
    // Most recently touched first: during a bulk scan the card you just held
    // should be the one at the top, not buried under an hour of scanning.
    const [moved] = next.splice(at, 1);
    return [moved, ...next];
  }
  return [
    {
      key,
      cardId: card.i,
      name: card.n,
      setName: card.S,
      setId: card.s,
      number: card.u,
      rarity: card.r,
      variant,
      condition,
      quantity: 1,
      unitPrice: price,
      addedAt: now,
      updatedAt: now,
      needsPrinting,
    },
    ...entries,
  ];
}

export function setQuantity(entries: Entry[], key: string, quantity: number): Entry[] {
  if (quantity <= 0) return entries.filter((e) => e.key !== key);
  return entries.map((e) =>
    e.key === key ? { ...e, quantity, updatedAt: Date.now() } : e,
  );
}

/** Set or clear the grade on an entry, merging if that pile already exists. */
export function regrade(entries: Entry[], key: string, grade: Grade | null): Entry[] {
  const from = entries.find((e) => e.key === key);
  if (!from) return entries;
  const next = grade ?? undefined;
  const newKey = entryKey(from.cardId, from.variant, from.condition, next);
  if (newKey === from.key) return entries;

  const rest = entries.filter((e) => e.key !== key);
  const collide = rest.find((e) => e.key === newKey);
  const merged: Entry = {
    ...from,
    key: newKey,
    grade: next,
    quantity: from.quantity + (collide?.quantity ?? 0),
    updatedAt: Date.now(),
  };
  return [merged, ...rest.filter((e) => e.key !== newKey)];
}

/** Move an entry to a different variant or condition, merging on collision. */
export function reclassify(
  entries: Entry[],
  key: string,
  next: { variant?: string; condition?: ConditionId; unitPrice?: number | null },
): Entry[] {
  const from = entries.find((e) => e.key === key);
  if (!from) return entries;
  const variant = next.variant ?? from.variant;
  const condition = next.condition ?? from.condition;
  const unitPrice = next.unitPrice !== undefined ? next.unitPrice : from.unitPrice;
  const newKey = entryKey(from.cardId, variant, condition, from.grade);

  const rest = entries.filter((e) => e.key !== key);
  const collide = rest.find((e) => e.key === newKey);
  const merged: Entry = {
    ...from,
    key: newKey,
    variant,
    condition,
    unitPrice,
    quantity: from.quantity + (collide?.quantity ?? 0),
    needsPrinting: next.variant !== undefined ? false : from.needsPrinting,
    updatedAt: Date.now(),
  };
  return [merged, ...rest.filter((e) => e.key !== newKey)];
}

/** Replace the card an entry points at, for resolving an ambiguous printing. */
export function repoint(
  entries: Entry[],
  key: string,
  card: CardRecord,
  variant: string,
  price: number | null,
): Entry[] {
  const from = entries.find((e) => e.key === key);
  if (!from) return entries;
  const newKey = entryKey(card.i, variant, from.condition, from.grade);
  const rest = entries.filter((e) => e.key !== key);
  const collide = rest.find((e) => e.key === newKey);
  const merged: Entry = {
    ...from,
    key: newKey,
    cardId: card.i,
    name: card.n,
    setName: card.S,
    setId: card.s,
    number: card.u,
    rarity: card.r,
    variant,
    unitPrice: price,
    quantity: from.quantity + (collide?.quantity ?? 0),
    needsPrinting: false,
    updatedAt: Date.now(),
  };
  return [merged, ...rest.filter((e) => e.key !== newKey)];
}

/** Group entries by set, for completion tracking. */
export interface SetGroup {
  setId: string;
  setName: string;
  owned: number;
  distinct: Set<string>;
  value: number;
}

export function bySet(entries: Entry[]): SetGroup[] {
  const map = new Map<string, SetGroup>();
  for (const e of entries) {
    let g = map.get(e.setId);
    if (!g) {
      g = { setId: e.setId, setName: e.setName, owned: 0, distinct: new Set(), value: 0 };
      map.set(e.setId, g);
    }
    g.owned += e.quantity;
    g.distinct.add(e.cardId);
    g.value += entryValue(e);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

/**
 * A CSV a seller can actually use.
 *
 * Columns and condition names match what TCGplayer's mass-entry importer
 * expects, so a scanning session can go straight into a listing workflow
 * instead of being retyped. Anything with a comma or quote in it is quoted.
 */
export function toCsv(entries: Entry[]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [
    ['Quantity', 'Name', 'Set', 'Number', 'Rarity', 'Variant', 'Condition',
      'Grade', 'Unit Price (NM)', 'Line Value'].join(','),
  ];
  for (const e of entries) {
    rows.push([
      cell(e.quantity),
      cell(e.name),
      cell(e.setName),
      cell(e.number),
      cell(e.rarity),
      cell(e.variant),
      cell(e.grade ? 'Near Mint' : conditionOf(e.condition).label),
      cell(e.grade ? gradeLabel(e.grade) : ''),
      cell(e.unitPrice == null ? '' : e.unitPrice.toFixed(2)),
      cell(entryValue(e).toFixed(2)),
    ].join(','));
  }
  return rows.join('\n');
}
