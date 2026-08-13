/** Shared types for the BulkSift engine. */

/** One card, as the app uses it. Short keys keep the in-memory footprint down. */
export interface CardRecord {
  /** id, e.g. "base1-4" */
  i: string;
  /** name */
  n: string;
  /** printed collector number */
  u: string;
  /** set id */
  s: string;
  /** set name */
  S: string;
  /** rarity */
  r: string | null;
  /** release date */
  d: string | null;
  /** TCGplayer product id */
  p: number | null;
  /** TCGplayer product url */
  t: string | null;
}

/**
 * cards.json on disk: sets interned, cards as positional arrays.
 *
 * The expanded form repeats each set's name and release date on every one of
 * its cards and carries a full TCGplayer URL that is derivable from the product
 * id. That cost 4.13 MB inside the mobile bundle; this form is 1.06 MB for the
 * same information.
 */
export interface CompactCatalogue {
  /** [setId, setName, releaseDate] */
  sets: Array<[string, string, string | null]>;
  /** [id, name, number, rarity, setIndex, tcgplayerProductId] */
  cards: Array<[string, string, string, string | null, number, number | null]>;
}

export function expandCards(compact: CompactCatalogue): CardRecord[] {
  const out: CardRecord[] = new Array(compact.cards.length);
  for (let k = 0; k < compact.cards.length; k++) {
    const [i, n, u, r, gi, p] = compact.cards[k];
    const set = compact.sets[gi];
    out[k] = {
      i,
      n,
      u,
      s: set[0],
      S: set[1],
      r,
      d: set[2],
      p,
      // TCGplayer redirects /product/<id> to the full slug, so the slug does
      // not need shipping.
      t: p == null ? null : `https://www.tcgplayer.com/product/${p}`,
    };
  }
  return out;
}

/** Accepts either form, so a stale cards.json still loads. */
export function loadCards(data: CompactCatalogue | CardRecord[]): CardRecord[] {
  return Array.isArray(data) ? data : expandCards(data);
}

/** Prices for one printing variant, in USD. */
export interface VariantPrice {
  /** market price */
  m: number | null;
  /** lowest listing */
  l: number | null;
  /** highest listing */
  h: number | null;
}

export type CardPrices = Record<string, VariantPrice>;

export interface PriceBook {
  updated: string;
  currency: string;
  source: string;
  prices: Record<string, CardPrices>;
}

export interface PricedVariant {
  variant: string;
  market: number | null;
  low: number | null;
  high: number | null;
}

/** A card the scanner is confident about. */
export interface ScanHit {
  card: CardRecord;
  /** Hamming distance to the index row, lower is better. */
  distance: number;
  /** Bits separating this from the runner-up. */
  margin: number;
  /** 0..1 confidence derived from distance and margin. */
  confidence: number;
  variants: PricedVariant[];
  /** Highest market price across variants, the headline number. */
  topMarket: number | null;
  /**
   * Set when the runner-up is close enough to be a genuine alternative AND its
   * price differs materially. The UI must let the user choose rather than
   * silently pick - reprints like Jungle vs Base Set 2 sit inside camera noise
   * and cannot be separated reliably from a moving card.
   */
  ambiguity?: {
    alternatives: Array<{ card: CardRecord; distance: number; topMarket: number | null }>;
    reason: 'reprint-price-gap';
  };
}

export interface ScannerConfig {
  /** Above this Hamming distance the match is discarded as "no card". */
  maxDistance: number;
  /** Below this margin the top two candidates are treated as interchangeable. */
  ambiguousMargin: number;
  /** Price ratio between candidates that makes an ambiguity worth surfacing. */
  ambiguousPriceRatio: number;
  /** Frames a card must agree across before it is emitted. */
  confirmFrames: number;
  /** Frames without a detection before the scanner will re-emit the same card. */
  clearFrames: number;
  /**
   * Minimum frames between two emissions of the same card.
   *
   * Detection flickers on blurred or partly-out-of-frame moments, so "no card
   * detected" briefly is not proof the card left - without this guard a single
   * pass logged the same Mr. Mime three times, and a session total that double
   * counts is worse than useless to a seller. Two genuinely separate copies of
   * the same card are still counted twice, they just have to be separated by a
   * real gap rather than a flicker.
   */
  sameCardCooldownFrames: number;
  /** Detector working width used on every frame while tracking. */
  trackWorkWidth: number;
  /**
   * Detector working width for the frame that commits a card. Set equal to
   * trackWorkWidth to skip the second pass entirely.
   *
   * Corner accuracy is what limits match quality - a ground-truth quad matches
   * at a median Hamming distance of 26 where a sloppy one manages 115 - so this
   * used to run the commit frame at 1280 px. Sub-pixel edge refinement made that
   * pointless: refinement measures the edge in the full-resolution image no
   * matter what width the coarse search ran at, so 320 px now lands within
   * 1.5 px of truth, identical to 1280 px, for a seventh of the cost. Running
   * the coarse search wider is in fact slightly *worse* (91% vs 97% top-1), as
   * more fine detail means more competing components to lock onto.
   */
  confirmWorkWidth: number;
}

export const DEFAULT_CONFIG: ScannerConfig = {
  // Swept on 100 simulated frames against the full 20,444-card index
  // (median correct distance 37, p90 134, p99 275):
  //
  //   gate 150 -> 90% priced,  9% refused, 1% wrong
  //   gate 240 -> 96% priced,  3% refused, 1% wrong
  //   gate 300 -> 97% priced,  0% refused, 1% wrong
  //
  // 240 is chosen over 300 for the tail rather than the headline: past it the
  // gate stops rejecting anything, so a genuinely unrecognised card - a damaged
  // one, a language we do not index, a non-Pokemon card - gets a confident
  // answer instead of "rescan".
  //
  // The residual 1% is worth measuring in money, not percent: across those 100
  // scans the single unflagged mistake misquoted by $0.12 (a 72c Gardevoir read
  // as its 60c reprint). Expensive confusions are caught by ambiguousMargin and
  // handed to the user instead.
  maxDistance: 240,
  // Swept on 180 frames of cards that share artwork across sets with a >=2x
  // price gap - the only cases where picking the wrong printing costs anything:
  //
  //   margin 28 -> 2 prompts, $51.55 misquoted
  //   margin 40 -> 3 prompts,  $0.30 misquoted
  //   margin 80 -> 4 prompts,  $0.20 misquoted
  //
  // Widening the margin cannot improve identification, only whether a wrong
  // pick is shown as fact or asked about. One extra prompt buys back $51 of it;
  // the next one buys ten cents, so this stops at 40.
  ambiguousMargin: 40,
  ambiguousPriceRatio: 1.6,
  confirmFrames: 2,
  clearFrames: 6,
  // ~1 second at 30 fps: long enough that detection flicker inside one pass
  // cannot double-count, short enough that deliberately feeding a second copy
  // of the same card still registers.
  sameCardCooldownFrames: 30,
  trackWorkWidth: 320,
  confirmWorkWidth: 320,
};
