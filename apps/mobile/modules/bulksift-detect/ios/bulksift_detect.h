// The per-pixel half of card detection, in C++.
//
// Only the stages whose cost scales with the number of pixels live here: the
// work grid, the Sobel magnitude, the threshold-and-dilate, and connected
// components. Everything after that - convex hull, quad fitting, sub-pixel edge
// refinement - stays in TypeScript, because it runs on a few hundred points
// rather than half a million and is where the interesting decisions are.
//
// This is a port, not a rewrite. It has to agree with the TypeScript
// implementation exactly, so it deliberately keeps the same loop order and the
// same arithmetic widths: JavaScript computes in binary64 and stores into
// Float32Array, so the accumulators here are `double` and the buffers `float`.
// Same order, same rounding, same answer. `tools/parity` proves it frame by
// frame rather than asserting it.
#ifndef BULKSIFT_DETECT_H
#define BULKSIFT_DETECT_H

#include <cstdint>
#include <vector>

namespace bulksift {

/** How the camera's bytes are arranged. Mirrors `layoutFor` in frame.ts. */
struct PixelLayout {
  int width = 0;
  int height = 0;
  int bytesPerRow = 0;
  int bytesPerPixel = 4;
  int rOff = 0;
  int gOff = 1;
  int bOff = 2;
};

/** An interleaved pixel buffer, however the camera arranged it. */
struct PixelSourceC {
  const uint8_t* data = nullptr;
  int32_t len = 0;
  int width = 0;
  int height = 0;
  int bytesPerRow = 0;
  int bytesPerPixel = 4;
  int rOff = 0;
  int gOff = 1;
  int bOff = 2;
};

struct WorkGrid {
  std::vector<float> gray;
  int w = 0;
  int h = 0;
  /** Camera pixels each cell spans, i.e. the coordinate scale. */
  int scale = 1;
};

/**
 * Build the detector's grid straight from the camera buffer.
 *
 * `sampleStep` is how many of each cell's pixels are actually read - 2 means
 * every second one, which is what the old subsample-then-average path came to.
 */
WorkGrid buildWorkGrid(const uint8_t* src, size_t len, const PixelLayout& layout,
                       int workWidth, int sampleStep);

/** One blob, reduced to the leftmost and rightmost pixel of each of its rows. */
struct Component {
  int size = 0;
  std::vector<int32_t> xs;  // paired with ys, in the same order as the port
  std::vector<int32_t> ys;
};

/**
 * Grid -> gradient -> threshold -> dilate -> components.
 *
 * Returns every blob at least `minSize` pixels, in discovery order, which is
 * the order the TypeScript produces so the two can be compared directly.
 */
std::vector<Component> findComponents(const float* gray, int w, int h,
                                      int minSize, double k);

/** Exposed for the parity harness; not part of the app's path. */
std::vector<float> sobelMagnitude(const float* gray, int w, int h);
std::vector<uint8_t> binarize(const float* mag, int w, int h, double k);

}  // namespace bulksift

#endif
