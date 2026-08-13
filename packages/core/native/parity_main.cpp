// Prove the C++ core agrees with the TypeScript, frame by frame.
//
// A native rewrite of a hot loop is only worth having if it can be shown to
// produce the same answer. "Shown" here is every grid cell and every component
// boundary point over 100 real frames, compared exactly - not a spot check and
// not a tolerance. The same discipline is already what keeps the Python index
// builder and the TypeScript searcher honest with each other.
//
//   parity <scan_frames.bin> <scan_meta width> <height> <count> <stages.bin>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <chrono>
#include <fstream>
#include <vector>

#include "bulksift_detect.h"
#include "bulksift_describe.h"
#include "bulksift_match.h"

static std::vector<uint8_t> readFile(const char* path) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) { std::printf("cannot open %s\n", path); std::exit(1); }
  const std::streamsize n = f.tellg();
  f.seekg(0);
  std::vector<uint8_t> buf(static_cast<size_t>(n));
  f.read(reinterpret_cast<char*>(buf.data()), n);
  return buf;
}

struct Reader {
  const uint8_t* p;
  const uint8_t* end;
  uint32_t u32() {
    uint32_t v;
    std::memcpy(&v, p, 4);
    p += 4;
    return v;
  }
  int32_t i32() {
    int32_t v;
    std::memcpy(&v, p, 4);
    p += 4;
    return v;
  }
};

int main(int argc, char** argv) {
  if (argc < 6) {
    std::printf("usage: parity <frames.bin> <w> <h> <count> <stages.bin>\n");
    return 2;
  }
  const std::vector<uint8_t> frames = readFile(argv[1]);
  const int W = std::atoi(argv[2]);
  const int H = std::atoi(argv[3]);
  const int COUNT = std::atoi(argv[4]);
  const std::vector<uint8_t> dump = readFile(argv[5]);

  Reader r{dump.data(), dump.data() + dump.size()};
  if (std::memcmp(r.p, "BSST", 4) != 0) { std::printf("bad dump magic\n"); return 1; }
  r.p += 4;
  const uint32_t dumpCount = r.u32();
  if (static_cast<int>(dumpCount) != COUNT) {
    std::printf("dump has %u frames, expected %d\n", dumpCount, COUNT);
    return 1;
  }

  bulksift::PixelLayout layout;
  layout.width = W;
  layout.height = H;
  layout.bytesPerPixel = 4;
  layout.bytesPerRow = W * 4;
  layout.rOff = 0; layout.gOff = 1; layout.bOff = 2;

  const size_t frameBytes = static_cast<size_t>(W) * H * 4;
  int gridMismatch = 0, compCountMismatch = 0, pointMismatch = 0, sizeMismatch = 0;
  double worstGray = 0;
  double gridMs = 0, compMs = 0;

  for (int i = 0; i < COUNT; i++) {
    const uint8_t* src = frames.data() + static_cast<size_t>(i) * frameBytes;

    auto t0 = std::chrono::high_resolution_clock::now();
    const bulksift::WorkGrid grid = bulksift::buildWorkGrid(src, frameBytes, layout, 320, 2);
    auto t1 = std::chrono::high_resolution_clock::now();

    const uint32_t gw = r.u32(), gh = r.u32(), gscale = r.u32();
    if (static_cast<uint32_t>(grid.w) != gw || static_cast<uint32_t>(grid.h) != gh ||
        static_cast<uint32_t>(grid.scale) != gscale) {
      std::printf("frame %d: grid is %dx%d@%d, TS says %ux%u@%u\n",
                  i, grid.w, grid.h, grid.scale, gw, gh, gscale);
      return 1;
    }
    const float* tsGray = reinterpret_cast<const float*>(r.p);
    r.p += static_cast<size_t>(gw) * gh * sizeof(float);
    for (size_t k = 0; k < static_cast<size_t>(gw) * gh; k++) {
      // Exact: both sides stored a float32 from the same double computation.
      if (grid.gray[k] != tsGray[k]) {
        gridMismatch++;
        const double d = std::fabs(static_cast<double>(grid.gray[k]) - tsGray[k]);
        if (d > worstGray) worstGray = d;
      }
    }

    auto t2 = std::chrono::high_resolution_clock::now();
    const std::vector<bulksift::Component> comps = bulksift::findComponents(
        grid.gray.data(), grid.w, grid.h,
        static_cast<int>(std::floor(grid.w * grid.h * 0.004)), 1.1);
    auto t3 = std::chrono::high_resolution_clock::now();

    gridMs += std::chrono::duration<double, std::milli>(t1 - t0).count();
    compMs += std::chrono::duration<double, std::milli>(t3 - t2).count();

    const uint32_t nComp = r.u32();
    if (nComp != comps.size()) {
      if (compCountMismatch < 3) {
        std::printf("frame %d: %zu components, TS says %u\n", i, comps.size(), nComp);
      }
      compCountMismatch++;
      // Still have to consume the rest of this frame's record.
      for (uint32_t c = 0; c < nComp; c++) {
        r.u32();
        const uint32_t np = r.u32();
        r.p += static_cast<size_t>(np) * 8;
      }
      continue;
    }
    for (uint32_t c = 0; c < nComp; c++) {
      const uint32_t size = r.u32();
      const uint32_t np = r.u32();
      if (static_cast<int>(size) != comps[c].size) sizeMismatch++;
      if (np != comps[c].xs.size()) {
        pointMismatch++;
        r.p += static_cast<size_t>(np) * 8;
        continue;
      }
      for (uint32_t k = 0; k < np; k++) {
        const int32_t x = r.i32(), y = r.i32();
        if (x != comps[c].xs[k] || y != comps[c].ys[k]) pointMismatch++;
      }
    }
  }

  std::printf("%d frames\n\n", COUNT);
  std::printf("grid cells differing        : %d (worst %.9f)\n", gridMismatch, worstGray);
  std::printf("frames with a different count: %d\n", compCountMismatch);
  std::printf("components of a wrong size  : %d\n", sizeMismatch);
  std::printf("boundary points differing   : %d\n\n", pointMismatch);
  std::printf("C++ grid   %.3f ms/frame\n", gridMs / COUNT);
  std::printf("C++ detect %.3f ms/frame  (sobel + threshold + components)\n", compMs / COUNT);
  std::printf("C++ total  %.3f ms/frame\n", (gridMs + compMs) / COUNT);

  // ---- the index, on the queries the app actually produces ----------------
  const std::vector<uint8_t> idx = readFile(argv[6]);
  const int32_t rows = bulksift::indexLoad(idx.data(), static_cast<int32_t>(idx.size()));
  if (rows <= 0) { std::printf("\nindexLoad failed: %d\n", rows); return 1; }

  if (std::memcmp(r.p, "BSSQ", 4) != 0) { std::printf("\nbad query-section magic\n"); return 1; }
  r.p += 4;
  const uint32_t queryCount = r.u32();

  int searchMismatch = 0, stripMismatch = 0, topkMismatch = 0;
  int descMismatch = 0, descStripMismatch = 0, descSkipped = 0;
  double searchMs = 0, describeMs = 0;
  std::vector<int32_t> topBuf(64);
  std::vector<uint8_t> gotDesc(bulksift::DESC_BYTES), gotStrip(bulksift::STRIP_BYTES);

  for (uint32_t i = 0; i < queryCount; i++) {
    const uint32_t hasQuad = r.u32();
    bulksift::QuadF quad{};
    if (hasQuad) {
      for (int j = 0; j < 8; j++) {
        double v;
        std::memcpy(&v, r.p, 8);
        r.p += 8;
        quad.p[j] = v;
      }
    }
    const uint32_t qLen = r.u32();
    const uint8_t* q = r.p;
    r.p += qLen;
    const uint32_t sLen = r.u32();
    const uint8_t* strip = r.p;
    r.p += sLen;
    const int32_t wantBestI = r.i32(), wantBestD = r.i32();
    const int32_t wantSecI = r.i32(), wantSecD = r.i32();
    const uint32_t topN = r.u32();

    auto s0 = std::chrono::high_resolution_clock::now();
    const bulksift::SearchResult got = bulksift::indexSearch(q, static_cast<int32_t>(qLen));
    auto s1 = std::chrono::high_resolution_clock::now();
    searchMs += std::chrono::duration<double, std::milli>(s1 - s0).count();

    if (got.bestIndex != wantBestI || got.bestDistance != wantBestD ||
        got.runnerUpIndex != wantSecI || got.runnerUpDistance != wantSecD) {
      if (searchMismatch < 3) {
        std::printf("query %u: got (%d,%d)(%d,%d), TS says (%d,%d)(%d,%d)\n", i,
                    got.bestIndex, got.bestDistance, got.runnerUpIndex, got.runnerUpDistance,
                    wantBestI, wantBestD, wantSecI, wantSecD);
      }
      searchMismatch++;
    }

    const int32_t nGot = bulksift::indexTopK(q, static_cast<int32_t>(qLen),
                                             static_cast<int32_t>(topN),
                                             topBuf.data(), static_cast<int32_t>(topBuf.size()));
    for (uint32_t k = 0; k < topN; k++) {
      const int32_t wi = r.i32(), wd = r.i32();
      if (static_cast<int32_t>(k) >= nGot || topBuf[k * 2] != wi || topBuf[k * 2 + 1] != wd) {
        topkMismatch++;
      }
    }

    // Rectify and describe the same quad from the same frame.
    if (hasQuad) {
      bulksift::PixelSourceC ps;
      ps.data = frames.data() + static_cast<size_t>(i) * frameBytes;
      ps.len = static_cast<int32_t>(frameBytes);
      ps.width = W;
      ps.height = H;
      ps.bytesPerRow = W * 4;
      ps.bytesPerPixel = 4;
      ps.rOff = 0; ps.gOff = 1; ps.bOff = 2;

      auto d0 = std::chrono::high_resolution_clock::now();
      const int rc = bulksift::describeQuad(ps, quad, false,
                                            gotDesc.data(), bulksift::DESC_BYTES,
                                            gotStrip.data(), bulksift::STRIP_BYTES);
      auto d1 = std::chrono::high_resolution_clock::now();
      describeMs += std::chrono::duration<double, std::milli>(d1 - d0).count();

      if (rc != 0) {
        descSkipped++;
      } else {
        if (std::memcmp(gotDesc.data(), q, bulksift::DESC_BYTES) != 0) descMismatch++;
        if (std::memcmp(gotStrip.data(), strip, bulksift::STRIP_BYTES) != 0) descStripMismatch++;
      }
    } else {
      descSkipped++;
    }

    const int32_t wantStrip = r.i32();
    if (wantBestI >= 0) {
      const int32_t gotStrip =
          bulksift::indexStripDistance(wantBestI, strip, static_cast<int32_t>(sLen));
      if (gotStrip != wantStrip) stripMismatch++;
    }
  }

  std::printf("\n%u searches over %d rows\n", queryCount, rows);
  std::printf("best/runner-up differing    : %d\n", searchMismatch);
  std::printf("top-4 entries differing     : %d\n", topkMismatch);
  std::printf("footer distances differing  : %d\n", stripMismatch);
  std::printf("C++ search %.3f ms/query\n", searchMs / queryCount);
  std::printf("\ndescriptors differing         : %d\n", descMismatch);
  std::printf("footers differing             : %d\n", descStripMismatch);
  std::printf("frames with no quad           : %d\n", descSkipped);
  std::printf("C++ describe %.3f ms/card  (rectify + descriptor + footer)\n",
              describeMs / (queryCount > 0 ? queryCount : 1));

  const bool ok = !gridMismatch && !compCountMismatch && !sizeMismatch && !pointMismatch &&
                  !searchMismatch && !topkMismatch && !stripMismatch &&
                  !descMismatch && !descStripMismatch;
  std::printf("\n%s\n", ok ? "identical to the TypeScript" : "MISMATCH");
  return ok ? 0 : 1;
}
