/**
 * The per-frame scan loop.
 *
 * Designed for the fixed-camera workflow: the lens stays put and cards are
 * swiped past it. That means the scanner has to (a) run inside a frame budget,
 * (b) emit each card exactly once no matter how many frames it appears in, and
 * (c) notice when a card leaves so the next one can be emitted.
 */

import { CANON_H, CANON_W, describe, describeStrip } from './descriptor.ts';
import {
  detectCard, rectifyFrom, rotate180, sameView, scaleQuad, sourceOf,
  type Component, type Detection, type LumaSource, type PixelSource, type Quad,
  type WorkImage,
} from './detect.ts';
import { CardIndex, type Candidate, type MatchResult } from './matcher.ts';
import {
  DEFAULT_CONFIG,
  type CardPrices,
  type CardRecord,
  type PriceBook,
  type PricedVariant,
  type ScanHit,
  type ScannerConfig,
} from './types.ts';

/**
 * Above this distance a still image's upright read is doubted enough to try the
 * flip. Only used by `identify`, which sees one frame and has no history; the
 * live loop learns the orientation instead (see `preferFlipped`).
 */
const FLIP_RETRY_DISTANCE = 150;

/**
 * When a frame may reuse the previous frame's recognition.
 *
 * `REUSE_SIZE_TOL` is a fractional area change and `REUSE_LEVEL` a brightness
 * difference out of 0..255 over a 6x6 grid: a different illustration moves
 * several blocks by far more, while auto-exposure drift moves them all by one
 * or two. Position is not part of it - see `sameView`.
 *
 * `REUSE_MAX_FRAMES` forces a real read periodically no matter how convincing
 * the resemblance. It bounds how long a mistaken reuse could persist, and costs
 * one recognised frame in twelve.
 */
const REUSE_SIZE_TOL = 0.12;
const REUSE_LEVEL = 6;
const REUSE_MAX_FRAMES = 12;

/**
 * How much closer the winning footer has to be before it overrules the picture.
 *
 * A camera read sits ~8 bits from its own reference footer while two printings
 * sit ~28 apart, so a real decision clears this comfortably and a coin flip
 * does not. Tuned on the reprint suite against dollars misquoted.
 */
const STRIP_DECISIVE = 6;

/**
 * How deep to look for a rival with a different name.
 *
 * Sixteen covers the largest reprint families - a basic energy runs to about a
 * dozen printings - and the index's scan cost is the same whatever K is, since
 * every row is compared either way; only the small heap grows.
 */
const NAME_MARGIN_K = 16;

/**
 * How many frames of one view are voted together.
 *
 * Five is where the measured recovery flattens - a seventh frame buys under a
 * bit - and it is a sixth of a second at 30 fps, short enough that the ring
 * refreshes before a card can be swapped without the geometry test noticing.
 */
const VOTE_FRAMES = 5;

/**
 * Per-bit majority over several descriptors of the same view.
 *
 * With an odd count there is no tie to break. With an even one a tie falls to
 * zero, which is the same way `describe` resolves an exact comparison.
 */
function majority(descs: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(descs[0].length);
  const need = descs.length / 2;
  for (let byte = 0; byte < out.length; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      const mask = 0x80 >> bit;
      let ones = 0;
      for (let i = 0; i < descs.length; i++) if (descs[i][byte] & mask) ones++;
      if (ones > need) out[byte] |= mask;
    }
  }
  return out;
}

/**
 * A card's name without the parenthetical the catalogue uses to separate
 * printings of it: "Professor's Research (Professor Sada)" -> "Professor's
 * Research". Two rows sharing this are the same card in different clothes, and
 * must not count as rivals when deciding whether a card is there at all.
 */
export const baseName = (name: string): string => {
  const at = name.indexOf(' (');
  return at > 0 ? name.slice(0, at) : name;
};

/**
 * How far behind the winner a rival printing can be and still be worth putting
 * to the footer. Wider than the margin that prompts the user, because a wrong
 * printing that wins clearly is exactly the case the picture cannot fix.
 */
const FOOTER_BAND = 90;

/**
 * How the crop is calibrated: how often to re-test, by how much, and how far
 * the standing bias may wander. Three scales cost two extra reads, so testing
 * one fresh frame in eight adds about a quarter to those frames and nothing to
 * the rest. The limit keeps a run of bad frames from walking the crop off the
 * card entirely.
 */
const CALIBRATE_EVERY = 8;
const CALIBRATE_STEP = 0.02;
const CALIBRATE_LIMIT = 0.08;

/**
 * A native rectify-and-describe, when one is available.
 *
 * Returns null to mean "not this time", and the scanner falls back to
 * rectifying and describing in TypeScript. Taking the quad and the orientation
 * rather than a canonical image is what keeps a 322 KB buffer out of the
 * crossing - it exists only to become 96 bytes.
 */
export type Describer = (
  quad: Quad,
  flipped: boolean,
) => { desc: Uint8Array; strip: Uint8Array } | null;

export interface FrameResult {
  /** Where the card is in the frame, for drawing an overlay. */
  detection: Detection | null;
  /** Set only on the frame where a card becomes confirmed. */
  hit: ScanHit | null;
  /** The current best guess, even before confirmation, for live feedback. */
  preview: { card: CardRecord; distance: number } | null;
  timings: { detect: number; describe: number; search: number; total: number; reused: number };
  /**
   * Bits by which the winner beat the nearest differently-named card.
   *
   * Reported so the number that decides acceptance can be read off a real
   * device rather than inferred from frames rendered on a desktop - which is
   * how the distance gate came to be set where an empty table passes it.
   */
  nameMargin?: number;
  /** Per-section disagreement for the winning read, for on-device diagnosis. */
  sections?: Array<{ name: string; d: number; of: number }>;
}

function variantsOf(prices: CardPrices | undefined): PricedVariant[] {
  if (!prices) return [];
  return Object.entries(prices)
    .map(([variant, p]) => ({ variant, market: p.m, low: p.l, high: p.h }))
    .sort((a, b) => (b.market ?? 0) - (a.market ?? 0));
}

function topMarketOf(variants: PricedVariant[]): number | null {
  const withPrice = variants.filter((v) => v.market != null);
  return withPrice.length ? Math.max(...withPrice.map((v) => v.market as number)) : null;
}

export class Scanner {
  private readonly index: CardIndex;
  private readonly cards: CardRecord[];
  /**
   * Card names with any trailing parenthetical removed, one per row.
   *
   * The catalogue uses that parenthetical to tell apart printings of the SAME
   * card that carry different subtitle art - "Professor's Research (Professor
   * Sada)" against "(Professor Turo)". Compared literally they are different
   * cards, so the acceptance rule measured its margin between two printings of
   * one card and found 10 bits, making both unscannable. Normalised, the worst
   * card in the catalogue sits at 33.
   *
   * Computed once. It is read up to sixteen times a frame.
   */
  private readonly baseNames: string[];
  private book: PriceBook;
  private readonly config: ScannerConfig;

  private streak = 0;
  private streakIndex = -1;
  private emittedIndex = -1;
  /**
   * Every row emitted since reads last went quiet.
   *
   * `emittedIndex` remembers only the most recent one, which is what let a
   * single card be logged four or five times: it lay under the lens, a blurred
   * frame in between read as something else and moved `emittedIndex` off it,
   * and the card was free to be counted again. Remembering the whole
   * presentation closes that without the blunter rule of one card per
   * presentation, which the 25-card fixture stream showed refuses 24 of them -
   * a stream of cards passed by hand never goes quiet between two of them.
   */
  private emittedThisPass = new Set<number>();
  private missFrames = 0;
  private frameNo = 0;
  private lastEmitFrame = new Map<number, number>();
  /**
   * Which way up the last good read was.
   *
   * A fixed camera sees every card the same way up, so testing both
   * orientations on every frame doubles the two most expensive stages to learn
   * something that does not change. The threshold this replaced was calibrated
   * on clean fixtures, where correct reads sit at distance 37; through a real
   * lens they sit near 210, so it fired on literally every frame. Now the
   * preferred orientation is tried alone, and the other only when that read is
   * not good enough to accept - which is also exactly when a genuinely
   * upside-down card would show up, so it still finds one within a frame or two.
   */
  private preferFlipped = false;
  /** The last frame that was actually recognised, and what it came to. */
  private lastDetection: Detection | null = null;
  private lastResult: MatchResult | null = null;
  private lastQuery: Uint8Array | null = null;
  /** The margin of the last accepted read, for frames that reuse it. */
  private lastNameMargin = 0;
  /**
   * Recent descriptors of what looks like the same card in the same pose.
   *
   * A shiny card is the hard case, and the device says so plainly: full arts
   * never read, holos rarely, matte cards fine. The perturbation table measured
   * at the start named glare as the largest single term - 210 bits against 86
   * for triple blur - and the distances coming off the device, 203 to 230, sit
   * right on it.
   *
   * But a highlight does not stay put. The hand moves, the card tilts, and the
   * blown-out band slides across the surface, so the bits it destroys are
   * different on every frame while the bits it misses are the same. A per-bit
   * majority over a handful of frames therefore recovers a read that no single
   * frame contains. Measured on 40 fixture cards with a highlight moving over
   * them each frame:
   *
   *              one frame          five-frame vote
   *   90% glare  d=109 m=103        d=78 m=124
   *   75% glare  d=105 m=104        d=78 m=124
   *   no glare   d=73  m=127        d=73 m=127
   *
   * which is most of the way back to a clean card, for an accumulator and no
   * index rebuild. Masking the glare was tried before and rejected: it throws
   * away the bits it covers, and this throws away nothing.
   */
  private recent: Uint8Array[] = [];
  /** Footer of the last recognised card, kept only when it was a near-tie. */
  private lastStrip: Uint8Array | null = null;
  /** Consecutive frames answered from `lastResult` without recognising again. */
  private reusedRun = 0;
  /** Standing correction between the detected card edge and the reference crop. */
  private scaleBias = 0;
  private sinceCalibration = CALIBRATE_EVERY;
  /** The sharpest read seen since the current streak began. */
  private streakBest: {
    result: MatchResult; query: Uint8Array; strip: Uint8Array | null;
  } | null = null;

  constructor(
    index: CardIndex,
    cards: CardRecord[],
    book: PriceBook,
    config: Partial<ScannerConfig> = {},
  ) {
    if (index.rows !== cards.length) {
      throw new Error(
        `index has ${index.rows} rows but cards.json has ${cards.length} entries - ` +
        `they must be built together`,
      );
    }
    this.index = index;
    this.cards = cards;
    this.book = book;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.baseNames = cards.map((c) => baseName(c.n));
  }

  get priceUpdated(): string {
    return this.book.updated;
  }

  /** The book in use, so a caller can tell whether a fetched one is newer. */
  get priceBook(): PriceBook {
    return this.book;
  }

  /**
   * Swap in a newer price book.
   *
   * Prices are the only part of the engine that goes out of date - the index
   * and the catalogue are fixed for a build - so this exists rather than
   * rebuilding a Scanner, which would throw away the index, the accelerator and
   * every bit of temporal state mid-scan.
   *
   * Recognition is untouched by it. What a card *is* does not depend on what it
   * costs.
   */
  usePrices(book: PriceBook): void {
    this.book = book;
  }

  /** Raw index lookup, exposed for benchmarking the search stage on device. */
  searchFor(query: Uint8Array) {
    return this.index.search(query);
  }

  pricesFor(cardId: string): PricedVariant[] {
    return variantsOf(this.book.prices[cardId]);
  }

  /**
   * Record that a card has been counted by something other than a scan.
   *
   * The scan screen lets the user confirm the card the engine is currently
   * showing rather than waiting for it to be sure. Without this the engine
   * would keep tracking that same card and commit it again the moment it
   * satisfied the accept rule on its own.
   *
   * Takes a card id rather than a row so the caller does not have to know the
   * index's internal numbering.
   */
  noteEmitted(cardId: string): void {
    const row = this.cards.findIndex((c) => c.i === cardId);
    if (row < 0) return;
    this.emittedThisPass.add(row);
    this.lastEmitFrame.set(row, this.frameNo);
    this.emittedIndex = row;
  }

  /** Reset temporal state, e.g. when the user restarts a scanning session. */
  reset(): void {
    this.streak = 0;
    this.streakIndex = -1;
    this.emittedIndex = -1;
    this.emittedThisPass.clear();
    this.missFrames = 0;
    this.frameNo = 0;
    this.preferFlipped = false;
    this.lastDetection = null;
    this.lastResult = null;
    this.lastQuery = null;
    this.lastNameMargin = 0;
    this.lastStrip = null;
    this.reusedRun = 0;
    this.streakBest = null;
    this.scaleBias = 0;
    this.sinceCalibration = CALIBRATE_EVERY;
    this.lastEmitFrame.clear();
  }

  /**
   * Process one camera frame. `rgba` is the raw frame at `width` x `height`.
   * Returns a hit only on the frame where a new card becomes confirmed.
   */
  processFrame(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    channels: 3 | 4 = 4,
    work?: WorkImage,
    refineSource?: LumaSource & { scale: number },
    pixels?: PixelSource,
    blobs?: Component[],
    describer?: Describer,
  ): FrameResult {
    // Where the card's own pixels are read from. A caller that already has the
    // frame in some interleaved layout hands it over as-is; anything else is
    // treated as a tidy RGB/RGBA buffer.
    const src = pixels ?? sourceOf(rgba, width, height, channels);
    const timings = { detect: 0, describe: 0, search: 0, total: 0, reused: 0 };
    this.frameNo++;

    const tDetect = performance.now();
    const detection = detectCard(rgba, width, height, {
      workWidth: this.config.trackWorkWidth,
      channels,
      work,
      refineSource,
      blobs,
    });
    timings.detect = performance.now() - tDetect;

    if (!detection) {
      this.endOfPresentation();
      timings.total = performance.now() - tDetect;
      return { detection: null, hit: null, preview: null, timings };
    }

    // A card sitting in front of a fixed lens is recognised once, then looked
    // at for another twenty frames that can only reach the same answer. When
    // the quad has not moved and the card looks the same, reuse the last
    // result: everything below this point - rectify, describe, and a scan of
    // 20,444 rows - is skipped, and the frame costs detection alone.
    if (
      this.lastDetection &&
      this.lastResult &&
      this.reusedRun < REUSE_MAX_FRAMES &&
      sameView(this.lastDetection, detection, REUSE_SIZE_TOL, REUSE_LEVEL)
    ) {
      this.reusedRun++;
      this.lastDetection = detection;
      timings.total = timings.detect;
      timings.reused = 1;
      // A reused frame inherits the margin of the read it is reusing, which
      // is the read that passed the gate in the first place.
      return this.track(
        detection, this.lastResult, this.lastQuery!, timings, this.lastNameMargin,
      );
    }

    /**
     * Describe the card at `bias`, natively when there is a native core.
     *
     * The TypeScript path is not an alternative implementation - it is the
     * reference the C++ was checked against, and it runs whenever nothing
     * native answered.
     */
    const describeAt = (bias: number, flip: boolean) => {
      const q = scaleQuad(detection.quad, bias);
      if (describer) {
        const got = describer(q, flip);
        if (got) return { desc: got.desc, strip: got.strip, canonical: null };
      }
      const up = rectifyFrom(src, q, CANON_W, CANON_H);
      const oriented = flip ? rotate180(up, CANON_W, CANON_H) : up;
      return { desc: describe(oriented), strip: null, canonical: oriented };
    };

    const tDesc = performance.now();
    // Occasionally re-ask where the card really ends.
    //
    // The detector finds the physical edge; the reference images were cropped
    // by whoever scanned them, and a systematic disagreement of a few percent
    // is worth ~50 bits on a 73-bit baseline - more than blur and white balance
    // together, both of which turned out to cost almost nothing. So the cut is
    // calibrated instead of assumed: every so often the frame is rectified at
    // three scales and the one that matches best becomes the standing bias.
    const calibrating = this.sinceCalibration >= CALIBRATE_EVERY;
    const biases = calibrating
      ? [this.scaleBias - CALIBRATE_STEP, this.scaleBias, this.scaleBias + CALIBRATE_STEP]
      : [this.scaleBias];
    this.sinceCalibration = calibrating ? 0 : this.sinceCalibration + 1;

    let read = describeAt(biases[0], this.preferFlipped);
    let qa = read.desc;
    timings.describe = performance.now() - tDesc;

    if (calibrating) {
      const tCal = performance.now();
      let bestBias = biases[0];
      let bestD = this.index.search(qa).best.distance;
      for (let i = 1; i < biases.length; i++) {
        const trial = describeAt(biases[i], this.preferFlipped);
        const d = this.index.search(trial.desc).best.distance;
        if (d < bestD) {
          bestD = d;
          bestBias = biases[i];
          read = trial;
          qa = trial.desc;
        }
      }
      this.scaleBias = Math.max(-CALIBRATE_LIMIT, Math.min(CALIBRATE_LIMIT, bestBias));
      timings.describe += performance.now() - tCal;
    }

    /*
     * Keep this frame's descriptor with the last few of the same view, and
     * search with their majority rather than with this frame alone.
     *
     * The ring is cleared whenever the card moves enough that the frames are no
     * longer of the same pose, because voting across two different geometries
     * averages two different cards into neither of them. `sameView` is the same
     * test the reuse path uses, and it is about the quad rather than the match,
     * so it does not depend on the answer this is trying to improve.
     */
    if (!this.lastDetection
        || !sameView(this.lastDetection, detection, REUSE_SIZE_TOL, REUSE_LEVEL)) {
      this.recent.length = 0;
    }
    this.recent.push(qa);
    if (this.recent.length > VOTE_FRAMES) this.recent.shift();
    const voted = this.recent.length >= 3 ? majority(this.recent) : qa;

    // Read the orientation that worked last time, and only pay for the other
    // one if this read is not good enough to accept.
    const tSearch = performance.now();
    let result: MatchResult = this.index.search(voted);
    let query = voted;
    timings.search = performance.now() - tSearch;

    if (result.best.index < 0 || result.best.distance > this.config.maxDistance) {
      const t2 = performance.now();
      const other = describeAt(this.scaleBias, !this.preferFlipped);
      timings.describe += performance.now() - t2;
      const t3 = performance.now();
      const rb = this.index.search(other.desc);
      timings.search += performance.now() - t3;
      if (rb.best.distance < result.best.distance) {
        result = rb;
        query = other.desc;
        read = other;
        this.preferFlipped = !this.preferFlipped;
        // The ring holds the other orientation's descriptors; they cannot be
        // voted with these.
        this.recent.length = 0;
      }
    }
    timings.total = timings.detect + timings.describe + timings.search;

    const margin = result.best.index < 0 ? 0 : this.nameMargin(query);
    if (
      result.best.index < 0
      || result.best.distance > this.config.maxDistance
      || margin < this.config.minNameMargin
    ) {
      /*
       * A refused frame counts towards the card having gone.
       *
       * It used to be the detector's job to say when the frame was empty, and
       * the detector is not able to: pointed at a bedsheet it found a quad in
       * 3,297 of 3,421 frames. So "the card has left" never fired, one card
       * stayed one presentation for as long as it lay there, and a single card
       * was logged four or five times.
       */
      this.streak = 0;
      this.streakIndex = -1;
      this.lastDetection = null;
      this.lastResult = null;
      this.missFrames++;
      if (this.missFrames >= this.config.clearFrames) this.endOfPresentation();
      return { detection, hit: null, preview: null, timings, nameMargin: margin };
    }
    this.missFrames = 0;

    // Always read the footer of an accepted card. It covers 36 rows against the
    // descriptor's 336, so it costs about a tenth of a describe - far too little
    // to be worth predicting whether it will be needed, and the previous
    // near-tie gate meant the eight cases that most needed it never got it.
    // The footer comes back with the descriptor when a native core produced
    // it; otherwise it is taken from the canonical card the fallback built.
    this.lastStrip = !this.index.hasStrips
      ? null
      : read.strip ?? (read.canonical ? describeStrip(read.canonical) : null);

    this.reusedRun = 0;
    this.lastDetection = detection;
    this.lastResult = result;
    this.lastQuery = query;
    this.lastNameMargin = margin;
    return this.track(detection, result, query, timings, margin);
  }

  /**
   * The card has gone: forget what was emitted, so the next one may be.
   *
   * Called when reads stop landing, from either cause - no quad at all, or a
   * run of quads that nothing believable could be read from.
   */
  private endOfPresentation(): void {
    this.streak = 0;
    this.streakIndex = -1;
    this.emittedIndex = -1;
    this.emittedThisPass.clear();
    this.streakBest = null;
    this.missFrames = 0;
    this.recent.length = 0;
  }

  /**
   * How far the winner is ahead of the first rival that is a *different card*.
   *
   * This is what tells "there is no card here" apart from "there is a card and
   * its printing is genuinely hard to pin down", and nothing else does.
   *
   * Distance alone cannot. The gate was set at 240 from frames rendered off the
   * reference images, where a correct read sits at 37; through a real lens a
   * correct read sits far higher, and so does an empty desk - a device build
   * pointed at a bare table answered at 232 on every one of 216 frames and
   * logged twelve cards that were never there.
   *
   * A plain margin to the runner-up cannot either. An empty desk ties with its
   * runner-up because nothing in a featureless surface prefers one of 20,444
   * rows over another - but a Basic Lightning Energy also ties with its runner
   * up, because that runner-up is the same card printed in another set and the
   * two really are near-identical. Refusing both would leave the app unable to
   * count energies, which is a good part of what bulk is.
   *
   * So reprints of the winner are skipped and the margin is measured to the
   * first genuinely different card. Measured over 100 frames and six surfaces
   * with no card in them:
   *
   *   margin >= 20   4 of 100 cards refused, 0 of 6 surfaces accepted
   *
   * and three of those four refusals were reads that had been *wrong*. The
   * surfaces never managed better than 16, while the cards' 10th percentile is
   * 70, so the threshold sits in a wide empty band rather than on a cliff.
   *
   * The band is why this is worth doing at all: distance had no such band left.
   */
  private nameMargin(query: Uint8Array): number {
    if (this.config.minNameMargin <= 0) return Number.POSITIVE_INFINITY;
    const top = this.index.topK(query, NAME_MARGIN_K);
    if (top.length < 2) return Number.POSITIVE_INFINITY;
    const winner = this.baseNames[top[0].index];
    for (let i = 1; i < top.length; i++) {
      if (this.baseNames[top[i].index] === winner) continue;
      return top[i].distance - top[0].distance;
    }
    // Every one of the K is the same card under different set symbols. That is
    // a reprint family, not an empty table: accept, and let the footer and the
    // ambiguity prompt settle which printing it is.
    return Number.POSITIVE_INFINITY;
  }

  /**
   * The temporal half of a frame: streaks, cooldowns, and emitting a hit.
   *
   * Split out because a reused read has to walk exactly the same path as a
   * fresh one - a card that is recognised once and then skipped for twenty
   * frames still has to confirm, and still has to be counted only once.
   */
  private track(
    detection: Detection,
    result: MatchResult,
    query: Uint8Array,
    timings: FrameResult['timings'],
    nameMargin: number,
  ): FrameResult {
    const preview = { card: this.cards[result.best.index], distance: result.best.distance };
    const sections =
      timings.reused === 0 ? this.index.sections(query, result.best.index) : undefined;

    // Track a card by its ambiguity GROUP, not by the winning row.
    //
    // Two printings of the same artwork sit a few bits apart, so which one wins
    // flips from frame to frame. Keyed on the raw row that reads as "a new
    // card" every flip: one Mr. Mime held in front of the lens was logged seven
    // times, alternating between Jungle and Base Set 2. Collapsing a near-tie
    // onto a single identity makes the flapping invisible to the counter, while
    // the ambiguity itself is still surfaced to the user on the hit.
    const trackId =
      result.runnerUp && result.margin < this.config.ambiguousMargin
        ? Math.min(result.best.index, result.runnerUp.index)
        : result.best.index;

    if (trackId === this.streakIndex) {
      this.streak++;
    } else {
      this.streakIndex = trackId;
      this.streak = 1;
      this.streakBest = null;
    }

    // Commit on the sharpest frame of the run, not the latest one.
    //
    // Through a real lens a card is read at distance ~210 where a fixture reads
    // at 39, and at that quality the winner genuinely flickers between frames:
    // whichever frame happens to be least blurred, least angled and least
    // glared is markedly better than its neighbours. The old code answered with
    // whatever frame tripped the counter, which is an arbitrary one. Keeping the
    // best read of the run costs one comparison per frame and is the same idea
    // as sharpest-frame selection, which was worth 8 points on reprints when it
    // was measured on its own.
    if (
      timings.reused === 0 &&
      (!this.streakBest || result.best.distance < this.streakBest.result.best.distance)
    ) {
      this.streakBest = { result, query, strip: this.lastStrip };
    }

    // Cool down on every row this read could plausibly be, not just the one
    // that happens to be winning.
    //
    // One Patrat held in front of the lens was logged three times, because a
    // near-tie makes `trackId` alternate between the winning row and the group
    // key - and each alternation looked like a different card to a cooldown
    // keyed on a single index. Asking whether *either* candidate was emitted
    // recently closes that door without weakening the real "next card" case,
    // where both candidates are new.
    const cooldown = this.config.sameCardCooldownFrames;
    const rivalIndex =
      result.runnerUp && result.margin < this.config.ambiguousMargin
        ? result.runnerUp.index
        : -1;
    const lastSeen = Math.max(
      this.lastEmitFrame.get(this.streakIndex) ?? -Infinity,
      this.lastEmitFrame.get(result.best.index) ?? -Infinity,
      rivalIndex >= 0 ? (this.lastEmitFrame.get(rivalIndex) ?? -Infinity) : -Infinity,
    );
    /*
     * One card per presentation, not one card per row.
     *
     * `streakIndex !== emittedIndex` only remembers the *last* card emitted, so
     * a single card lying under the lens was logged again every time a blurred
     * frame in between read as something else and moved `emittedIndex` off it.
     * With a card held for five seconds and the odd misread, that is four or
     * five copies of one card - which is what a device build did.
     *
     * A pass of the hand puts one card under the camera. So: nothing has been
     * emitted since the last time reads went quiet, or nothing is emitted.
     * Two genuinely separate copies are still counted twice; they just have to
     * be separated by the moment of lifting one and laying the next, which is
     * about a third of a second and unavoidable.
     */
    const confirmed =
      this.streak >= this.config.confirmFrames &&
      !this.emittedThisPass.has(this.streakIndex) &&
      !this.emittedThisPass.has(result.best.index) &&
      this.frameNo - lastSeen >= cooldown;
    if (!confirmed) {
      return { detection, hit: null, preview, timings, sections, nameMargin };
    }

    this.emittedIndex = this.streakIndex;
    this.emittedThisPass.add(this.streakIndex);
    this.emittedThisPass.add(result.best.index);
    if (rivalIndex >= 0) this.emittedThisPass.add(rivalIndex);
    this.lastEmitFrame.set(this.streakIndex, this.frameNo);
    this.lastEmitFrame.set(result.best.index, this.frameNo);
    if (rivalIndex >= 0) this.lastEmitFrame.set(rivalIndex, this.frameNo);

    // No second, more careful pass on confirmation.
    //
    // There used to be one, gated on `confirmWorkWidth > trackWorkWidth`. Both
    // are 320: sub-pixel edge refinement made the coarse localisation good
    // enough that a wider pass stopped paying for itself, and the ground-truth
    // comparison says why - reads off the detected quad land at distance 43
    // against 26 off a perfect quad, a gap another detection pass cannot close.
    // `confirmWorkWidth` still applies to `identify`, which sees a still image
    // and has no frames to average over.
    const commit = this.streakBest ?? { result, query, strip: this.lastStrip };
    return {
      detection,
      hit: this.buildHit(commit.result, commit.query, commit.strip),
      preview,
      timings,
      sections,
      nameMargin,
    };
  }

  /** Identify a single still image, bypassing the temporal logic. */
  identify(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    channels: 3 | 4 = 4,
  ): ScanHit | null {
    const detection = detectCard(rgba, width, height, {
      workWidth: this.config.confirmWorkWidth,
      channels,
    });
    if (!detection) return null;
    const upright = rectifyFrom(
      sourceOf(rgba, width, height, channels), detection.quad, CANON_W, CANON_H,
    );
    const qa = describe(upright);
    let result = this.index.search(qa);
    let query = qa;
    let canonical = upright;
    if (result.best.index < 0 || result.best.distance > FLIP_RETRY_DISTANCE) {
      const flipped = rotate180(upright, CANON_W, CANON_H);
      const qb = describe(flipped);
      const rb = this.index.search(qb);
      if (rb.best.distance < result.best.distance) {
        result = rb;
        query = qb;
        canonical = flipped;
      }
    }
    if (result.best.index < 0 || result.best.distance > this.config.maxDistance) return null;
    // A still image gets the same protection as the live loop: a photo of a
    // table must not come back as a card either.
    if (this.nameMargin(query) < this.config.minNameMargin) return null;
    const strip = this.index.hasStrips ? describeStrip(canonical) : null;
    return this.buildHit(result, query, strip);
  }

  /**
   * When two printings of one illustration are close enough to be confused,
   * ask the footer which it is.
   *
   * Returns the row the footer chose, or -1 if it did not have an opinion
   * worth acting on. Deciding requires the winner's footer to be clearly
   * closer than the next one's - `STRIP_DECISIVE` bits, measured on the
   * reprint suite - because a footer that is merely fractionally better is a
   * coin flip, and the user is better served by being asked than by a
   * confident wrong price.
   */
  private resolveByFooter(shortlist: Candidate[], strip: Uint8Array): number {
    if (shortlist.length < 2) return -1;
    const scored = shortlist
      .map((c) => ({ index: c.index, d: this.index.stripDistance(c.index, strip) }))
      .filter((c) => c.d >= 0)
      .sort((a, b) => a.d - b.d);
    if (scored.length < 2) return -1;
    if (scored[1].d - scored[0].d < STRIP_DECISIVE) return -1;
    return scored[0].index;
  }

  private buildHit(result: MatchResult, query: Uint8Array, strip: Uint8Array | null): ScanHit {
    // Everything below hangs off the shortlist, so build it once.
    //
    // The band is wider than `ambiguousMargin`, which decides whether to bother
    // the user. A reprint can beat its twin by more than that and still be the
    // wrong printing - eight of the reprint suite's frames do exactly that - and
    // those are precisely the ones worth asking the footer about. Asking is
    // cheap and, when it answers, right 80 times out of 81 on real frames.
    const band = Math.max(this.config.ambiguousMargin, FOOTER_BAND);
    const near =
      result.margin < band
        ? this.index.topK(query, 4).filter((c) => c.distance - result.best.distance < band)
        : [];

    // The picture says these are the same card. The footer is where they differ.
    let winner = result.best.index;
    let resolvedByFooter = false;
    if (strip && near.length > 1) {
      const chosen = this.resolveByFooter(near, strip);
      if (chosen >= 0) {
        resolvedByFooter = true;
        winner = chosen;
      }
    }

    const card = this.cards[winner];
    const variants = variantsOf(this.book.prices[card.i]);
    const topMarket = topMarketOf(variants);
    const winnerDistance = near.find((c) => c.index === winner)?.distance ?? result.best.distance;

    const norm = winnerDistance / this.index.bits;
    const marginPart = resolvedByFooter
      ? 1
      : Math.min(1, result.margin / this.config.ambiguousMargin);
    const confidence = Math.max(0, Math.min(1, (1 - norm * 2.2) * (0.55 + 0.45 * marginPart)));

    const hit: ScanHit = {
      card,
      distance: winnerDistance,
      margin: result.margin,
      confidence,
      variants,
      topMarket,
    };

    /*
     * The next best answers, for the user rather than for the engine.
     *
     * `near` above is only filled when the winner's margin is inside the footer
     * band, because that is when the engine has a decision to make. The feed's
     * "not this one" needs candidates on every hit, so this asks for its own
     * shortlist - which costs nothing, the scan over every row having already
     * happened; only the small heap is larger.
     */
    hit.runnersUp = this.index
      .topK(query, 4)
      .filter((c) => c.index !== winner)
      .map((c) => {
        const alt = this.cards[c.index];
        return {
          card: alt,
          distance: c.distance,
          topMarket: topMarketOf(variantsOf(this.book.prices[alt.i])),
        };
      });

    // Only ask the user about a printing the footer could not settle, and only
    // when getting it wrong would actually cost them money.
    if (!resolvedByFooter && near.length) {
      const alternatives = near
        .filter((c) => c.index !== winner)
        .filter((c) => c.distance - result.best.distance < this.config.ambiguousMargin)
        .map((c) => {
          const alt = this.cards[c.index];
          return {
            card: alt,
            distance: c.distance,
            topMarket: topMarketOf(variantsOf(this.book.prices[alt.i])),
          };
        })
        .filter((a) => {
          if (topMarket == null || a.topMarket == null) return false;
          const hi = Math.max(topMarket, a.topMarket);
          const lo = Math.min(topMarket, a.topMarket);
          return lo > 0 && hi / lo >= this.config.ambiguousPriceRatio;
        });
      if (alternatives.length) {
        hit.ambiguity = { alternatives, reason: 'reprint-price-gap' };
      }
    }

    return hit;
  }
}
