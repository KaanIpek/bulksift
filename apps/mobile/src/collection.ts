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
}

export interface WishEntry {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  unitPrice: number | null;
  addedAt: number;
}

/** The whole file, as written to disk. */
export interface Persisted {
  version: 1;
  entries: Entry[];
  wishlist: WishEntry[];
}

export const entryKey = (cardId: string, variant: string, condition: ConditionId) =>
  `${cardId}|${variant}|${condition}`;

/** What one entry is worth: price for the variant, scaled by condition. */
export function entryValue(e: Entry): number {
  if (e.unitPrice == null) return 0;
  return e.unitPrice * conditionOf(e.condition).multiplier * e.quantity;
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

/** The variant a scan should default to: the priciest one that has a price. */
export function defaultVariant(variants: PricedVariant[]): { name: string; price: number | null } {
  const priced = variants.filter((v) => v.market != null);
  if (!priced.length) return { name: variants[0]?.variant ?? 'Normal', price: null };
  const best = priced.reduce((a, b) => ((b.market ?? 0) > (a.market ?? 0) ? b : a));
  return { name: best.variant, price: best.market ?? null };
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
  const newKey = entryKey(from.cardId, variant, condition);

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
  const newKey = entryKey(card.i, variant, from.condition);
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
      'Unit Price (NM)', 'Line Value'].join(','),
  ];
  for (const e of entries) {
    rows.push([
      cell(e.quantity),
      cell(e.name),
      cell(e.setName),
      cell(e.number),
      cell(e.rarity),
      cell(e.variant),
      cell(conditionOf(e.condition).label),
      cell(e.unitPrice == null ? '' : e.unitPrice.toFixed(2)),
      cell(entryValue(e).toFixed(2)),
    ].join(','));
  }
  return rows.join('\n');
}
