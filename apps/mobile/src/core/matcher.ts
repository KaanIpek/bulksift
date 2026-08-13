/**
 * Nearest-neighbour search over the packed card index.
 *
 * The whole 20k-card index is ~2.3 MB, so it lives in memory and the search is
 * a linear Hamming scan - a k-d tree or LSH would add failure modes for no
 * useful gain at this size. What it did need was a cheap first pass: on the
 * phone this stage was 79 ms of a 179 ms frame, against 13% of the time on a
 * laptop, because iOS runs JavaScript without a JIT.
 */

import { N_BYTES, STRIP_BYTES } from './descriptor.ts';

/**
 * Words of each row compared in the cheap first pass, and how far behind the
 * best probe a row may be and still be worth comparing in full.
 *
 * 8 words is 256 of the descriptor's 742 bits. A correct read lands near 211
 * bits over the whole descriptor, so ~73 over the probe; an unrelated card
 * lands near 371, so ~128, with a standard deviation of about 8. A slack of 32
 * therefore keeps the answer and a few dozen neighbours while discarding
 * essentially everything else - and because a partial Hamming distance can only
 * grow, a row rejected here could never have won.
 */
const PROBE_WORDS = 8;
const PROBE_SLACK = 32;
const SHORTLIST = 512;

/**
 * SWAR population count of a 32-bit word.
 *
 * Kept for the cold paths. The scan loop in `search` inlines this by hand
 * instead: it runs 490,000 times per frame, and iOS has no JIT - Hermes
 * interprets bytecode, so a call that a JIT would have inlined away is paid
 * in full every single time. The final byte-sum is done with shifts rather
 * than `Math.imul` for the same reason.
 */
function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  v = (v + (v >>> 8)) & 0x00ff00ff;
  return (v + (v >>> 16)) & 0x3f;
}

export interface Candidate {
  /** Row in the index, which is also the row in cards.json. */
  index: number;
  distance: number;
}

export interface MatchResult {
  best: Candidate;
  runnerUp: Candidate | null;
  /** best.distance normalised to 0..1 over the descriptor width. */
  normalised: number;
  /** Gap to the runner-up in bits. Small gap means an ambiguous match. */
  margin: number;
}

/**
 * A native implementation of the three index lookups.
 *
 * Optional and interchangeable: when one is attached the searches go to it,
 * and when none is the TypeScript below runs exactly as it always has. The
 * TypeScript is the reference the C++ is checked against - see
 * packages/core/native/check-parity.mjs, which compares both on the queries
 * the app actually produces - so it stays alive rather than becoming dead code
 * behind a flag.
 */
export interface IndexAccelerator {
  search(query: Uint8Array): { best: Candidate; runnerUp: Candidate | null } | null;
  topK(query: Uint8Array, k: number): Candidate[] | null;
  stripDistance(row: number, strip: Uint8Array): number;
}

export class CardIndex {
  readonly rows: number;
  readonly bytesPerRow: number;
  readonly bits: number;
  /**
   * The index as 32-bit words - the only copy kept. Holding the original
   * Uint8Array as well would double the resident cost of a 2 MB index for
   * nothing, since every read goes through the word view.
   */
  private readonly words: Uint32Array;
  private readonly wordsPerRow: number;
  /** Scratch for the two-pass search, allocated once rather than per frame. */
  private readonly probeScores: Int32Array;
  private readonly shortlist = new Int32Array(SHORTLIST);
  /**
   * Footer descriptors, one per row, or null for a v1 index.
   *
   * Held as bytes rather than words: they are read a handful at a time to break
   * a near-tie, never scanned, so the alignment that pays for itself in the
   * main loop would only cost memory here.
   */
  private strips: Uint8Array | null = null;
  private stripBytes = 0;
  /** Width of the footer descriptor in bits, for normalising a distance. */
  stripBits = 0;
  private accel: IndexAccelerator | null = null;

  /** Route lookups through a native implementation. Pass null to go back. */
  useAccelerator(accel: IndexAccelerator | null): void {
    this.accel = accel;
  }

  private constructor(data: Uint8Array, rows: number, bytesPerRow: number, bits: number) {
    this.rows = rows;
    this.bytesPerRow = bytesPerRow;
    this.bits = bits;
    this.wordsPerRow = bytesPerRow >> 2;
    // Copy rather than alias: a Uint32Array view needs a 4-byte-aligned offset
    // into the buffer, which the 14-byte header does not give us.
    const aligned = new Uint8Array(data.length);
    aligned.set(data);
    this.words = new Uint32Array(aligned.buffer);
    this.probeScores = new Int32Array(rows);
  }

  /** Parse the index.bin produced by tools/build_index.py. */
  static parse(buffer: ArrayBuffer): CardIndex {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(
      view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
    );
    if (magic !== 'PKSC') throw new Error(`bad index magic: ${magic}`);
    const version = view.getUint16(4, true);
    if (version !== 1 && version !== 2) {
      throw new Error(`unsupported index version ${version}`);
    }
    const bits = view.getUint16(6, true);
    const bytesPerRow = view.getUint16(8, true);
    const rows = view.getUint32(10, true);
    if (bytesPerRow % 4 !== 0) {
      throw new Error(`index rows must be 4-byte aligned, got ${bytesPerRow}`);
    }
    if (bytesPerRow !== N_BYTES) {
      throw new Error(
        `index was built with ${bytesPerRow}-byte descriptors but this build ` +
        `expects ${N_BYTES} - rebuild the index or update the descriptor`,
      );
    }

    // v1: header, then the rows. v2 adds two header fields and a second block
    // of footer descriptors after the rows.
    const stripBits = version >= 2 ? view.getUint16(14, true) : 0;
    const stripBytes = version >= 2 ? view.getUint16(16, true) : 0;
    const headerBytes = version >= 2 ? 18 : 14;

    const expected = headerBytes + rows * bytesPerRow + rows * stripBytes;
    if (buffer.byteLength < expected) {
      throw new Error(`index truncated: ${buffer.byteLength} < ${expected}`);
    }
    const index = new CardIndex(
      new Uint8Array(buffer, headerBytes, rows * bytesPerRow), rows, bytesPerRow, bits,
    );
    if (stripBytes > 0) {
      if (stripBytes !== STRIP_BYTES) {
        throw new Error(
          `index footer is ${stripBytes} bytes but this build expects ` +
          `${STRIP_BYTES} - rebuild the index or update the descriptor`,
        );
      }
      const at = headerBytes + rows * bytesPerRow;
      index.strips = new Uint8Array(buffer.slice(at, at + rows * stripBytes));
      index.stripBytes = stripBytes;
      index.stripBits = stripBits;
    }
    return index;
  }

  /**
   * Where a read disagrees with the card it matched, by descriptor section.
   *
   * A total distance says how bad a read is; this says what kind of bad. The
   * four sections fail for different physical reasons, so the shape of the
   * answer names the cause:
   *   - colour alone near half its bits -> the channels are swapped or the
   *     white balance is off, and the picture itself is fine
   *   - art much worse than the full grid -> the quad is misaligned, so the
   *     illustration window lands on the wrong pixels
   *   - all four alike and moderate -> optics: blur, glare, or too few pixels
   * Guessing between those from a single number wasted several device builds.
   */
  /** One bit of one index row, MSB-first, as the descriptor packs them. */
  bitAt(row: number, bit: number): number {
    const bytes = new Uint8Array(this.words.buffer);
    return (bytes[row * this.bytesPerRow + (bit >> 3)] >> (7 - (bit & 7))) & 1;
  }

  sections(query: Uint8Array, row: number): Array<{ name: string; d: number; of: number }> {
    const spans: Array<[string, number, number]> = [
      ['gridH', 0, 240],
      ['gridV', 240, 240],
      ['art', 480, 154],
      ['colour', 634, 108],
    ];
    const off = row * this.bytesPerRow;
    const bytes = new Uint8Array(this.words.buffer);
    return spans.map(([name, start, len]) => {
      let d = 0;
      for (let i = start; i < start + len; i++) {
        const qb = (query[i >> 3] >> (7 - (i & 7))) & 1;
        const rb = (bytes[off + (i >> 3)] >> (7 - (i & 7))) & 1;
        if (qb !== rb) d++;
      }
      return { name, d, of: len };
    });
  }

  /**
   * Hamming distance between a row's footer and a query footer.
   * Returns -1 when the index carries no footers (a v1 index).
   */
  stripDistance(row: number, query: Uint8Array): number {
    if (this.accel) {
      const d = this.accel.stripDistance(row, query);
      if (d >= 0) return d;
    }
    if (!this.strips || row < 0 || row >= this.rows) return -1;
    let d = 0;
    const off = row * this.stripBytes;
    for (let i = 0; i < this.stripBytes; i++) d += popcount32(this.strips[off + i] ^ query[i]);
    return d;
  }

  get hasStrips(): boolean {
    return this.strips !== null;
  }

  /** Reinterpret a padded query as 32-bit words. */
  private queryWords(query: Uint8Array): Uint32Array {
    if (query.length !== this.bytesPerRow) {
      throw new Error(`query is ${query.length} bytes, index rows are ${this.bytesPerRow}`);
    }
    const copy = new Uint8Array(query.length);
    copy.set(query);
    return new Uint32Array(copy.buffer);
  }

  /**
   * Best and runner-up for one query descriptor.
   *
   * Two passes. The first compares only the leading `PROBE_WORDS` of every row
   * and keeps the closest few hundred; the second compares those in full. The
   * phone said why: on an interpreter with no JIT this scan was 79 ms of a
   * 179 ms frame - by far the most expensive stage, where on a laptop with a
   * JIT it had looked like 13%.
   *
   * A partial distance can only grow, so it is a lower bound on the full one,
   * and the separation is wide: a correct read sits near 211 bits of 742, which
   * is ~73 over the probe, while an unrelated card sits near 371, which is ~128.
   * It is still a shortlist rather than a proof, so it is measured, not
   * assumed: top-1 on the fixture suite is unchanged at 96%, reprints at 92%,
   * and the same four cards are missed as before.
   */
  search(query: Uint8Array): MatchResult {
    if (this.accel) {
      const r = this.accel.search(query);
      if (r) {
        return {
          best: r.best,
          runnerUp: r.runnerUp,
          normalised: r.best.distance / this.bits,
          margin: r.runnerUp ? r.runnerUp.distance - r.best.distance : this.bits,
        };
      }
    }
    const { words, rows, wordsPerRow } = this;
    const q = this.queryWords(query);
    const probe = Math.min(PROBE_WORDS, wordsPerRow);

    // Pass 1: probe every row, remembering each score and the best of them.
    const probes = this.probeScores;
    let minProbe = 0x7fffffff;
    for (let r = 0, off = 0; r < rows; r++, off += wordsPerRow) {
      let d = 0;
      for (let w = 0; w < probe; w++) {
        let v = words[off + w] ^ q[w];
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        v = (v + (v >>> 4)) & 0x0f0f0f0f;
        v = (v + (v >>> 8)) & 0x00ff00ff;
        d += (v + (v >>> 16)) & 0x3f;
      }
      probes[r] = d;
      if (d < minProbe) minProbe = d;
    }

    // Anything more than `PROBE_SLACK` behind the best probe cannot be the
    // answer. If an unusually flat frame lets too many through - a picture of
    // nothing matches everything equally badly - tighten until it fits, rather
    // than truncating and possibly dropping the row that mattered.
    let cutoff = minProbe + PROBE_SLACK;
    let nCand = 0;
    const cand = this.shortlist;
    for (;;) {
      nCand = 0;
      for (let r = 0; r < rows; r++) {
        if (probes[r] <= cutoff) {
          if (nCand === SHORTLIST) break;
          cand[nCand++] = r;
        }
      }
      if (nCand < SHORTLIST || cutoff <= minProbe) break;
      cutoff = minProbe + ((cutoff - minProbe) >> 1);
    }

    // Pass 2: the shortlist, in full.
    let bestD = Infinity;
    let bestI = -1;
    let secondD = Infinity;
    let secondI = -1;
    for (let i = 0; i < nCand; i++) {
      const r = cand[i];
      const off = r * wordsPerRow;
      let d = 0;
      for (let w = 0; w < wordsPerRow; w++) {
        let v = words[off + w] ^ q[w];
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        v = (v + (v >>> 4)) & 0x0f0f0f0f;
        v = (v + (v >>> 8)) & 0x00ff00ff;
        d += (v + (v >>> 16)) & 0x3f;
      }
      if (d < bestD) {
        secondD = bestD;
        secondI = bestI;
        bestD = d;
        bestI = r;
      } else if (d < secondD) {
        secondD = d;
        secondI = r;
      }
    }

    return {
      best: { index: bestI, distance: bestD },
      runnerUp: secondI >= 0 ? { index: secondI, distance: secondD } : null,
      normalised: bestD / this.bits,
      margin: secondI >= 0 ? secondD - bestD : this.bits,
    };
  }


  /** Top-k nearest rows, used to build a disambiguation shortlist. */
  topK(query: Uint8Array, k: number): Candidate[] {
    if (this.accel) {
      const r = this.accel.topK(query, k);
      if (r) return r;
    }
    const { words, rows, wordsPerRow } = this;
    const q = this.queryWords(query);
    const heap: Candidate[] = [];
    let worst = Infinity;
    for (let r = 0, off = 0; r < rows; r++, off += wordsPerRow) {
      let d = 0;
      for (let w = 0; w < wordsPerRow; w++) d += popcount32(words[off + w] ^ q[w]);
      if (heap.length < k) {
        heap.push({ index: r, distance: d });
        if (heap.length === k) {
          heap.sort((a, z) => a.distance - z.distance);
          worst = heap[k - 1].distance;
        }
      } else if (d < worst) {
        heap[k - 1] = { index: r, distance: d };
        heap.sort((a, z) => a.distance - z.distance);
        worst = heap[k - 1].distance;
      }
    }
    return heap.sort((a, z) => a.distance - z.distance);
  }

  /** Hamming distance between two index rows, for offline diagnostics. */
  distanceBetween(a: number, b: number): number {
    let d = 0;
    const oa = a * this.wordsPerRow;
    const ob = b * this.wordsPerRow;
    for (let i = 0; i < this.wordsPerRow; i++) d += popcount32(this.words[oa + i] ^ this.words[ob + i]);
    return d;
  }
}
