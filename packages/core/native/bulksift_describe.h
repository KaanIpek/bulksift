// Rectify a card out of a camera frame and describe it, in C++.
//
// Rectification samples a fixed 240x336 grid through a homography, so its cost
// is its output size rather than the frame's - but that is still 80,640 points
// with a perspective divide and a bilinear fetch each, and on an interpreter it
// measured ~30 ms. The descriptor that follows walks the canonical card four
// more times.
//
// This must agree with descriptor.ts bit for bit, which in turn agrees with
// tools/descriptor.py - the index is built by one and searched by the other, so
// a single flipped bit becomes a silently wrong card rather than an error. The
// grids are therefore integer SUMS, never means: every cell covers the same
// pixel count so the comparisons are unchanged, but a sum of integers is exact
// while a mean's last bit depends on the order it was accumulated in.
#ifndef BULKSIFT_DESCRIBE_H
#define BULKSIFT_DESCRIBE_H

#include <cstdint>

#include "bulksift_detect.h"

namespace bulksift {

constexpr int CANON_W = 240;
constexpr int CANON_H = 336;
constexpr int DESC_BYTES = 96;   // 742 bits, padded to a 4-byte boundary
constexpr int STRIP_BYTES = 15;  // 116 bits

/** A quad in source coordinates: x0,y0, x1,y1, x2,y2, x3,y3. */
struct QuadF {
  double p[8];
};

/**
 * Rectify, then describe, writing 96 descriptor bytes and 15 footer bytes.
 *
 * `flipped` describes the card 180 degrees round, which is what the scanner
 * asks for when the preferred orientation reads poorly - doing it here avoids
 * moving a 322 KB canonical image across the bridge just to turn it over.
 *
 * Returns 0 on success, negative on bad arguments.
 */
int describeQuad(const PixelSourceC& src, const QuadF& quad, bool flipped,
                 uint8_t* outDesc, int32_t outDescLen,
                 uint8_t* outStrip, int32_t outStripLen);

}  // namespace bulksift

#endif
