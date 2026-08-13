// A plain C door into the C++ core.
//
// Swift cannot call C++ directly in this toolchain, and the Expo module is
// Swift, so everything crosses through this one function. Keeping it C also
// keeps the C++ free of any platform or framework knowledge - the same
// bulksift_detect.cpp compiles on Windows for the parity harness.
#ifndef BULKSIFT_SHIM_H
#define BULKSIFT_SHIM_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Detect blobs in one frame, writing into buffers the caller already owns.
 *
 * `params` (int32): width, height, bytesPerRow, bytesPerPixel, rOff, gOff,
 * bOff, workWidth, sampleStep, minSize, kTimes1000.
 *
 * `outMeta` (int32, >= 5) receives: gridW, gridH, scale, componentCount,
 * intsWrittenToOutComps.
 *
 * `outComps` receives, per component: size, pointCount, then x,y pairs. It is
 * filled until full; the count in outMeta says how much is real.
 *
 * Returns 0 on success, or a negative code:
 *   -1 bad arguments   -2 source buffer too small   -3 output grid too small
 */
int bulksift_detect_run(const uint8_t* src, int32_t srcLen,
                        const int32_t* params, int32_t paramCount,
                        float* outGray, int32_t outGrayLen,
                        int32_t* outMeta, int32_t outMetaLen,
                        int32_t* outComps, int32_t outCompsLen);

/**
 * Parse and keep an index.bin. Returns the row count, or a negative code.
 * The bytes are copied, so the caller may release its buffer afterwards.
 */
int32_t bulksift_index_load(const uint8_t* data, int32_t len);

/** Best and runner-up for one descriptor, as (index, distance) x2 in `out4`. */
void bulksift_index_search(const uint8_t* query, int32_t queryLen, int32_t* out4);

/** Hamming distance between a row's footer and a query footer, or -1. */
int32_t bulksift_index_strip_distance(int32_t row, const uint8_t* strip, int32_t stripLen);

/** The k nearest rows as (index, distance) pairs. Returns how many were written. */
int32_t bulksift_index_topk(const uint8_t* query, int32_t queryLen, int32_t k,
                            int32_t* outPairs, int32_t outLen);

/**
 * Rectify a quad out of the frame and describe it.
 *
 * `params` is the same eleven-entry layout as bulksift_detect_run, of which
 * only the first seven (geometry and channel offsets) are read. `quad` is eight
 * doubles: x0,y0 .. x3,y3 in source coordinates. `flipped` describes the card
 * 180 degrees round, which avoids moving a 322 KB canonical image across the
 * bridge merely to turn it over.
 *
 * Writes 96 descriptor bytes and 15 footer bytes. Returns 0 on success.
 */
int32_t bulksift_describe_quad(const uint8_t* src, int32_t srcLen,
                               const int32_t* params, int32_t paramCount,
                               const double* quad, int32_t quadCount,
                               int32_t flipped,
                               uint8_t* outDesc, int32_t outDescLen,
                               uint8_t* outStrip, int32_t outStripLen);

#ifdef __cplusplus
}
#endif

#endif
