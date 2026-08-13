#include "bulksift_describe.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

namespace bulksift {
namespace {

constexpr int FULL_GRID = 16;
constexpr int ART_X0 = 30, ART_X1 = 210;
constexpr int ART_Y0 = 42, ART_Y1 = 168;
constexpr int ART_GX = 12, ART_GY = 14;
constexpr int COLOR_GRID = 6;
constexpr int N_BITS = FULL_GRID * (FULL_GRID - 1) * 2 + ART_GY * (ART_GX - 1) +
                       COLOR_GRID * COLOR_GRID * 3;
constexpr int STRIP_Y0 = 300, STRIP_Y1 = 336;
constexpr int STRIP_GX = 30, STRIP_GY = 4;
constexpr int STRIP_BITS = STRIP_GY * (STRIP_GX - 1);

/** Solve the homography mapping the four destination corners back to source. */
bool homographyToSource(const QuadF& quad, int outW, int outH, double* H) {
  const double dst[8] = {
      0, 0,
      static_cast<double>(outW), 0,
      static_cast<double>(outW), static_cast<double>(outH),
      0, static_cast<double>(outH)};

  double A[8][9];
  std::memset(A, 0, sizeof(A));
  for (int i = 0; i < 4; i++) {
    const double x = dst[i * 2], y = dst[i * 2 + 1];
    const double u = quad.p[i * 2], v = quad.p[i * 2 + 1];
    double* r0 = A[i * 2];
    r0[0] = x; r0[1] = y; r0[2] = 1;
    r0[6] = -x * u; r0[7] = -y * u; r0[8] = u;
    double* r1 = A[i * 2 + 1];
    r1[3] = x; r1[4] = y; r1[5] = 1;
    r1[6] = -x * v; r1[7] = -y * v; r1[8] = v;
  }

  // Gauss-Jordan with partial pivoting, in the same order as the port.
  for (int col = 0; col < 8; col++) {
    int piv = col;
    for (int r = col + 1; r < 8; r++) {
      if (std::fabs(A[r][col]) > std::fabs(A[piv][col])) piv = r;
    }
    if (std::fabs(A[piv][col]) < 1e-12) return false;
    if (piv != col) {
      for (int k = 0; k < 9; k++) std::swap(A[piv][k], A[col][k]);
    }
    const double d = A[col][col];
    for (int k = col; k < 9; k++) A[col][k] /= d;
    for (int r = 0; r < 8; r++) {
      if (r == col) continue;
      const double f = A[r][col];
      if (f == 0) continue;
      for (int k = col; k < 9; k++) A[r][k] -= f * A[col][k];
    }
  }
  for (int i = 0; i < 8; i++) H[i] = A[i][8];
  H[8] = 1.0;
  return true;
}

/** Exact box SUM of a plane onto a gx-by-gy grid, as boxGrid does. */
void boxGrid(const int32_t* plane, int planeW, int gx, int gy,
             int x0, int y0, int regionW, int regionH, double* out) {
  const int cw = regionW / gx;
  const int ch = regionH / gy;
  for (int cy = 0; cy < gy; cy++) {
    for (int cx = 0; cx < gx; cx++) {
      double sum = 0;
      const int yStart = y0 + cy * ch;
      const int xStart = x0 + cx * cw;
      for (int y = 0; y < ch; y++) {
        const int row = (yStart + y) * planeW + xStart;
        for (int x = 0; x < cw; x++) sum += plane[row + x];
      }
      out[cy * gx + cx] = sum;
    }
  }
}

double medianOf(const double* v, int n) {
  std::vector<double> s(v, v + n);
  std::sort(s.begin(), s.end());
  return (n % 2) ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/**
 * Store a bilinear result the way a Uint8ClampedArray does: clamp, then round
 * half to even.
 *
 * Written out rather than left to `std::nearbyint`, which honours the runtime
 * rounding mode and so cannot be reduced to a single instruction. It is called
 * three times per output pixel - 241,920 times per card - and using it made the
 * C++ describe *slower* than the JavaScript it replaced. That is the kind of
 * thing only a measurement catches.
 */
inline uint8_t clampedStore(double v) {
  if (!(v > 0)) return 0;  // also catches NaN
  if (v >= 255) return 255;
  // v is positive here, so a truncating cast is the floor and costs nothing.
  int i = static_cast<int>(v);
  const double diff = v - i;
  if (diff > 0.5) i++;
  else if (diff == 0.5 && (i & 1)) i++;
  return static_cast<uint8_t>(i);
}

}  // namespace

int describeQuad(const PixelSourceC& src, const QuadF& quad, bool flipped,
                 uint8_t* outDesc, int32_t outDescLen,
                 uint8_t* outStrip, int32_t outStripLen) {
  if (!src.data || !outDesc || outDescLen < DESC_BYTES) return -1;
  if (!outStrip || outStripLen < STRIP_BYTES) return -1;
  if (src.width < 2 || src.height < 2) return -1;

  double H[9];
  if (!homographyToSource(quad, CANON_W, CANON_H, H)) return -2;

  static thread_local std::vector<uint8_t> canonBuf(CANON_W * CANON_H * 4);
  uint8_t* const canon = canonBuf.data();
  /*
   * Every field is pulled into a local first.
   *
   * `canon` and `src.data` are both byte pointers, so the compiler cannot prove
   * that writing the canonical card does not modify the source struct, and
   * reloads the stride and channel offsets on every one of 80,640 iterations.
   * Hoisting them is worth more than any arithmetic change in this loop.
   */
  const uint8_t* const d = src.data;
  const int stride = src.bytesPerRow;
  const int bpp = src.bytesPerPixel;
  const int rOff = src.rOff, gOff = src.gOff, bOff = src.bOff;
  const int maxXi = src.width - 1;
  const int maxYi = src.height - 1;
  const double maxX = maxXi;
  const double maxY = maxYi;
  const double h0 = H[0], h1 = H[1], h2 = H[2];
  const double h3 = H[3], h4 = H[4], h5 = H[5];
  const double h6 = H[6], h7 = H[7], h8 = H[8];
  int o = 0;
  for (int y = 0; y < CANON_H; y++) {
    double nx = h1 * y + h2;
    double ny = h4 * y + h5;
    double nw = h7 * y + h8;
    for (int x = 0; x < CANON_W; x++, o += 4, nx += h0, ny += h3, nw += h6) {
      const double sx = nx / nw;
      const double sy = ny / nw;
      if (sx < 0 || sy < 0 || sx > maxX || sy > maxY) {
        canon[o] = canon[o + 1] = canon[o + 2] = 0;
        canon[o + 3] = 255;
        continue;
      }
      const int x0 = static_cast<int>(sx);
      const int y0 = static_cast<int>(sy);
      const int x1 = x0 < maxXi ? x0 + 1 : maxXi;
      const int y1 = y0 < maxYi ? y0 + 1 : maxYi;
      const double fx = sx - x0;
      const double fy = sy - y0;
      const double gx = 1 - fx;
      const int row0 = y0 * stride;
      const int row1 = y1 * stride;
      const int c0 = x0 * bpp;
      const int c1 = x1 * bpp;
      const int i00 = row0 + c0, i10 = row0 + c1, i01 = row1 + c0, i11 = row1 + c1;
      const double w00 = gx * (1 - fy), w10 = fx * (1 - fy);
      const double w01 = gx * fy, w11 = fx * fy;
      canon[o] = clampedStore(d[i00 + rOff] * w00 + d[i10 + rOff] * w10 +
                              d[i01 + rOff] * w01 + d[i11 + rOff] * w11);
      canon[o + 1] = clampedStore(d[i00 + gOff] * w00 + d[i10 + gOff] * w10 +
                                  d[i01 + gOff] * w01 + d[i11 + gOff] * w11);
      canon[o + 2] = clampedStore(d[i00 + bOff] * w00 + d[i10 + bOff] * w10 +
                                  d[i01 + bOff] * w01 + d[i11 + bOff] * w11);
      canon[o + 3] = 255;
    }
  }

  if (flipped) {
    const int n = CANON_W * CANON_H;
    for (int i = 0; i < n / 2; i++) {
      const int a = i * 4, b = (n - 1 - i) * 4;
      for (int c = 0; c < 4; c++) std::swap(canon[a + c], canon[b + c]);
    }
  }

  // BT.601 luma, floored, matching toGray.
  static thread_local std::vector<int32_t> grayBuf(CANON_W * CANON_H);
  int32_t* const gray = grayBuf.data();
  for (int i = 0, p = 0; i < CANON_W * CANON_H; i++, p += 4) {
    gray[i] = static_cast<int32_t>(std::floor(
        0.299 * canon[p] + 0.587 * canon[p + 1] + 0.114 * canon[p + 2]));
  }

  std::vector<uint8_t> bits(N_BITS, 0);
  int k = 0;

  std::vector<double> full(FULL_GRID * FULL_GRID);
  boxGrid(gray, CANON_W, FULL_GRID, FULL_GRID, 0, 0, CANON_W, CANON_H, full.data());
  for (int y = 0; y < FULL_GRID; y++) {
    for (int x = 1; x < FULL_GRID; x++) {
      bits[k++] = full[y * FULL_GRID + x] > full[y * FULL_GRID + x - 1] ? 1 : 0;
    }
  }
  for (int y = 1; y < FULL_GRID; y++) {
    for (int x = 0; x < FULL_GRID; x++) {
      bits[k++] = full[y * FULL_GRID + x] > full[(y - 1) * FULL_GRID + x] ? 1 : 0;
    }
  }

  std::vector<double> art(ART_GX * ART_GY);
  boxGrid(gray, CANON_W, ART_GX, ART_GY, ART_X0, ART_Y0,
          ART_X1 - ART_X0, ART_Y1 - ART_Y0, art.data());
  for (int y = 0; y < ART_GY; y++) {
    for (int x = 1; x < ART_GX; x++) {
      bits[k++] = art[y * ART_GX + x] > art[y * ART_GX + x - 1] ? 1 : 0;
    }
  }

  // Colour, summed straight out of the canonical card. The port walks channels
  // in the order 2,1,0 because the Python reference reads BGR from cv2.
  const int cw = CANON_W / COLOR_GRID;
  const int chh = CANON_H / COLOR_GRID;
  std::vector<double> cg(COLOR_GRID * COLOR_GRID);
  const int channels[3] = {2, 1, 0};
  for (int ci = 0; ci < 3; ci++) {
    std::fill(cg.begin(), cg.end(), 0.0);
    const int c = channels[ci];
    for (int y = 0; y < CANON_H; y++) {
      const int gy = y / chh;
      int p = (y * CANON_W) * 4 + c;
      for (int x = 0; x < CANON_W; x++, p += 4) {
        cg[gy * COLOR_GRID + (x / cw)] += canon[p];
      }
    }
    const double med = medianOf(cg.data(), static_cast<int>(cg.size()));
    for (size_t i = 0; i < cg.size(); i++) bits[k++] = cg[i] > med ? 1 : 0;
  }

  if (k != N_BITS) return -3;
  std::memset(outDesc, 0, DESC_BYTES);
  for (int i = 0; i < N_BITS; i++) {
    if (bits[i]) outDesc[i >> 3] |= static_cast<uint8_t>(0x80 >> (i & 7));
  }

  // The footer, from the same canonical card.
  std::vector<double> strip(STRIP_GX * STRIP_GY);
  boxGrid(gray, CANON_W, STRIP_GX, STRIP_GY, 0, STRIP_Y0,
          CANON_W, STRIP_Y1 - STRIP_Y0, strip.data());
  std::memset(outStrip, 0, STRIP_BYTES);
  int sk = 0;
  for (int y = 0; y < STRIP_GY; y++) {
    for (int x = 1; x < STRIP_GX; x++) {
      if (strip[y * STRIP_GX + x] > strip[y * STRIP_GX + x - 1]) {
        outStrip[sk >> 3] |= static_cast<uint8_t>(0x80 >> (sk & 7));
      }
      sk++;
    }
  }
  if (sk != STRIP_BITS) return -3;
  return 0;
}

}  // namespace bulksift
