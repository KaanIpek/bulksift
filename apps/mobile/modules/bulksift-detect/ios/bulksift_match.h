// Nearest-neighbour search over the packed card index, in C++.
//
// This is the stage an interpreter is worst at: 20,444 rows of 24 words, XORed
// and population-counted, with no floating point and nothing to inline away.
// On the phone it measured 79 ms of a 179 ms frame before a two-pass probe cut
// it; here the same two passes are a few hundred microseconds.
//
// Everything is integer, so agreement with the TypeScript is a property of the
// arithmetic rather than of the compiler. `check-parity.mjs` still proves it
// query by query, because "obviously exact" is how the last four bugs got in.
#ifndef BULKSIFT_MATCH_H
#define BULKSIFT_MATCH_H

#include <cstdint>

namespace bulksift {

struct SearchResult {
  int32_t bestIndex;
  int32_t bestDistance;
  int32_t runnerUpIndex;
  int32_t runnerUpDistance;
};

/**
 * Parse and keep an index.bin. Returns the row count, or a negative code:
 *   -1 too short   -2 bad magic   -3 unsupported version   -4 bad row width
 *
 * The bytes are copied, so the caller may free its buffer. Two megabytes held
 * once is cheaper than the alternative, which is handing the whole index across
 * the bridge on every query.
 */
int32_t indexLoad(const uint8_t* data, int32_t len);

/** Rows in the loaded index, or 0 if none is loaded. */
int32_t indexRows();

/** Width of the footer descriptor in bytes, or 0 for a v1 index. */
int32_t indexStripBytes();

/** Best and runner-up for one descriptor. Distances are -1 when nothing loaded. */
SearchResult indexSearch(const uint8_t* query, int32_t queryLen);

/** Hamming distance between a row's footer and a query footer, or -1. */
int32_t indexStripDistance(int32_t row, const uint8_t* strip, int32_t stripLen);

/**
 * The k nearest rows, written as (index, distance) pairs.
 * Returns how many pairs were written.
 */
int32_t indexTopK(const uint8_t* query, int32_t queryLen, int32_t k,
                  int32_t* outPairs, int32_t outLen);

}  // namespace bulksift

#endif
