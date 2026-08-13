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

#ifdef __cplusplus
}
#endif

#endif
