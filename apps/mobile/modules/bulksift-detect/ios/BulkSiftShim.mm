#import "BulkSiftShim.h"

#include <algorithm>
#include <vector>

#include "bulksift_detect.h"
#include "bulksift_describe.h"
#include "bulksift_match.h"

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

int32_t bulksift_index_load(const uint8_t* data, int32_t len) {
  if (!data || len <= 0) return -1;
  return bulksift::indexLoad(data, len);
}

void bulksift_index_search(const uint8_t* query, int32_t queryLen, int32_t* out4) {
  if (!out4) return;
  const bulksift::SearchResult r = bulksift::indexSearch(query, queryLen);
  out4[0] = r.bestIndex;
  out4[1] = r.bestDistance;
  out4[2] = r.runnerUpIndex;
  out4[3] = r.runnerUpDistance;
}

int32_t bulksift_index_strip_distance(int32_t row, const uint8_t* strip, int32_t stripLen) {
  return bulksift::indexStripDistance(row, strip, stripLen);
}

int32_t bulksift_index_topk(const uint8_t* query, int32_t queryLen, int32_t k,
                            int32_t* outPairs, int32_t outLen) {
  if (!outPairs) return 0;
  return bulksift::indexTopK(query, queryLen, k, outPairs, outLen);
}

int32_t bulksift_describe_quad(const uint8_t* src, int32_t srcLen,
                               const int32_t* params, int32_t paramCount,
                               const double* quad, int32_t quadCount,
                               int32_t flipped,
                               uint8_t* outDesc, int32_t outDescLen,
                               uint8_t* outStrip, int32_t outStripLen) {
  if (!src || !params || paramCount < 7 || !quad || quadCount < 8) return -1;

  bulksift::PixelSourceC ps;
  ps.data = src;
  ps.len = srcLen;
  ps.width = params[0];
  ps.height = params[1];
  ps.bytesPerRow = params[2];
  ps.bytesPerPixel = params[3];
  ps.rOff = params[4];
  ps.gOff = params[5];
  ps.bOff = params[6];
  if (static_cast<int64_t>(ps.bytesPerRow) * ps.height > srcLen) return -2;

  bulksift::QuadF q;
  for (int i = 0; i < 8; i++) q.p[i] = quad[i];

  return bulksift::describeQuad(ps, q, flipped != 0,
                                outDesc, outDescLen, outStrip, outStripLen);
}
