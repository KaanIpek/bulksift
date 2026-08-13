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
  detectCard, rectify, rotate180, sameView, scaleQuad,
  type Detection, type LumaSource, type WorkImage,
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

export interface FrameResult {
  /** Where the card is in the frame, for drawing an overlay. */
  detection: Detection | null;
  /** Set only on the frame where a card becomes confirmed. */
  hit: ScanHit | null;
  /** The current best guess, even before confirmation, for live feedback. */
  preview: { card: CardRecord; distance: number } | null;
  timings: { detect: number; describe: number; search: number; total: number; reused: number };
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
  private readonly book: PriceBook;
  private readonly config: ScannerConfig;

  private streak = 0;
  private streakIndex = -1;
  private emittedIndex = -1;
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
  }

  get priceUpdated(): string {
    return this.book.updated;
  }

  /** Raw index lookup, exposed for benchmarking the search stage on device. */
  searchFor(query: Uint8Array) {
    return this.index.search(query);
  }

  pricesFor(cardId: string): PricedVariant[] {
    return variantsOf(this.book.prices[cardId]);
  }

  /** Reset temporal state, e.g. when the user restarts a scanning session. */
  reset(): void {
    this.streak = 0;
    this.streakIndex = -1;
    this.emittedIndex = -1;
    this.missFrames = 0;
    this.frameNo = 0;
    this.preferFlipped = false;
    this.lastDetection = null;
    this.lastResult = null;
    this.lastQuery = null;
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
  ): FrameResult {
    const timings = { detect: 0, describe: 0, search: 0, total: 0, reused: 0 };
    this.frameNo++;

    const tDetect = performance.now();
    const detection = detectCard(rgba, width, height, {
      workWidth: this.config.trackWorkWidth,
      channels,
      work,
      refineSource,
    });
    timings.detect = performance.now() - tDetect;

    if (!detection) {
      this.missFrames++;
      if (this.missFrames >= this.config.clearFrames) {
        this.streak = 0;
        this.streakIndex = -1;
        this.emittedIndex = -1;
        this.streakBest = null;
      }
      timings.total = performance.now() - tDetect;
      return { detection: null, hit: null, preview: null, timings };
    }
    this.missFrames = 0;

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
      return this.track(detection, this.lastResult, this.lastQuery!, timings);
    }

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

    let upright = rectify(
      rgba, width, height, scaleQuad(detection.quad, biases[0]), CANON_W, CANON_H, channels,
    );
    let oriented = this.preferFlipped ? rotate180(upright, CANON_W, CANON_H) : upright;
    let canonical = oriented;
    let qa = describe(oriented);
    timings.describe = performance.now() - tDesc;

    if (calibrating) {
      const tCal = performance.now();
      let bestBias = biases[0];
      let bestD = this.index.search(qa).best.distance;
      for (let i = 1; i < biases.length; i++) {
        const up = rectify(
          rgba, width, height, scaleQuad(detection.quad, biases[i]), CANON_W, CANON_H, channels,
        );
        const or = this.preferFlipped ? rotate180(up, CANON_W, CANON_H) : up;
        const q = describe(or);
        const d = this.index.search(q).best.distance;
        if (d < bestD) {
          bestD = d;
          bestBias = biases[i];
          upright = up;
          oriented = or;
          canonical = or;
          qa = q;
        }
      }
      this.scaleBias = Math.max(-CALIBRATE_LIMIT, Math.min(CALIBRATE_LIMIT, bestBias));
      timings.describe += performance.now() - tCal;
    }

    // Read the orientation that worked last time, and only pay for the other
    // one if this read is not good enough to accept.
    const tSearch = performance.now();
    let result: MatchResult = this.index.search(qa);
    let query = qa;
    timings.search = performance.now() - tSearch;

    if (result.best.index < 0 || result.best.distance > this.config.maxDistance) {
      const t2 = performance.now();
      const other = this.preferFlipped ? upright : rotate180(upright, CANON_W, CANON_H);
      const qb = describe(other);
      timings.describe += performance.now() - t2;
      const t3 = performance.now();
      const rb = this.index.search(qb);
      timings.search += performance.now() - t3;
      if (rb.best.distance < result.best.distance) {
        result = rb;
        query = qb;
        canonical = other;
        this.preferFlipped = !this.preferFlipped;
      }
    }
    timings.total = timings.detect + timings.describe + timings.search;

    if (result.best.index < 0 || result.best.distance > this.config.maxDistance) {
      this.streak = 0;
      this.streakIndex = -1;
      this.lastDetection = null;
      this.lastResult = null;
      return { detection, hit: null, preview: null, timings };
    }

    // Always read the footer of an accepted card. It covers 36 rows against the
    // descriptor's 336, so it costs about a tenth of a describe - far too little
    // to be worth predicting whether it will be needed, and the previous
    // near-tie gate meant the eight cases that most needed it never got it.
    this.lastStrip = this.index.hasStrips ? describeStrip(canonical) : null;

    this.reusedRun = 0;
    this.lastDetection = detection;
    this.lastResult = result;
    this.lastQuery = query;
    return this.track(detection, result, query, timings);
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
    const confirmed =
      this.streak >= this.config.confirmFrames &&
      this.streakIndex !== this.emittedIndex &&
      this.frameNo - lastSeen >= cooldown;
    if (!confirmed) {
      return { detection, hit: null, preview, timings, sections };
    }

    this.emittedIndex = this.streakIndex;
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
    const upright = rectify(rgba, width, height, detection.quad, CANON_W, CANON_H, channels);
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
