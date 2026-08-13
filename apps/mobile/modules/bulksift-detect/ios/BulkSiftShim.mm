#import "BulkSiftShim.h"

#include <algorithm>
#include <vector>

#include "bulksift_detect.h"

int bulksift_detect_run(const uint8_t* src, int32_t srcLen,
                        const int32_t* params, int32_t paramCount,
                        float* outGray, int32_t outGrayLen,
                        int32_t* outMeta, int32_t outMetaLen,
                        int32_t* outComps, int32_t outCompsLen) {
  if (!src || !params || paramCount < 11 || !outGray || !outMeta || outMetaLen < 5) {
    return -1;
  }

  bulksift::PixelLayout layout;
  layout.width = params[0];
  layout.height = params[1];
  layout.bytesPerRow = params[2];
  layout.bytesPerPixel = params[3];
  layout.rOff = params[4];
  layout.gOff = params[5];
  layout.bOff = params[6];
  const int workWidth = params[7];
  const int sampleStep = params[8];
  const int minSize = params[9];
  // k arrives scaled by 1000 because the bridge carries integers. 1100/1000.0
  // and the literal 1.1 round to the same double, so the threshold is
  // unchanged - which the parity harness would catch if it were not.
  const double k = params[10] / 1000.0;

  const bulksift::WorkGrid grid =
      bulksift::buildWorkGrid(src, static_cast<size_t>(srcLen), layout, workWidth, sampleStep);
  if (grid.w == 0 || grid.h == 0) return -2;
  if (static_cast<int64_t>(grid.w) * grid.h > outGrayLen) return -3;

  std::copy(grid.gray.begin(), grid.gray.end(), outGray);

  const std::vector<bulksift::Component> comps =
      bulksift::findComponents(grid.gray.data(), grid.w, grid.h, minSize, k);

  int32_t written = 0;
  int32_t kept = 0;
  for (const bulksift::Component& c : comps) {
    const int32_t need = 2 + static_cast<int32_t>(c.xs.size()) * 2;
    if (written + need > outCompsLen) break;
    outComps[written++] = c.size;
    outComps[written++] = static_cast<int32_t>(c.xs.size());
    for (size_t i = 0; i < c.xs.size(); i++) {
      outComps[written++] = c.xs[i];
      outComps[written++] = c.ys[i];
    }
    kept++;
  }

  outMeta[0] = grid.w;
  outMeta[1] = grid.h;
  outMeta[2] = grid.scale;
  outMeta[3] = kept;
  outMeta[4] = written;
  return 0;
}
