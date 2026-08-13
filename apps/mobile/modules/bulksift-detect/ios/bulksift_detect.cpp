#include "bulksift_detect.h"

#include <cmath>
#include <cstring>

namespace bulksift {

WorkGrid buildWorkGrid(const uint8_t* src, size_t len, const PixelLayout& layout,
                       int workWidth, int sampleStep) {
  WorkGrid out;
  const int w = layout.width;
  const int h = layout.height;
  const int bpp = layout.bytesPerPixel;
  const int stride = layout.bytesPerRow > 0 ? layout.bytesPerRow : w * bpp;
  if (w <= 0 || h <= 0) return out;
  if (len < static_cast<size_t>(stride) * static_cast<size_t>(h)) return out;

  // Same cell arithmetic as toWorkGrid, so the two grids line up exactly.
  int cell = static_cast<int>(std::lround(static_cast<double>(w) / workWidth / sampleStep))
             * sampleStep;
  if (cell < sampleStep) cell = sampleStep;
  const int gW = w / cell;
  const int gH = h / cell;
  const int taps = (cell / sampleStep) < 1 ? 1 : (cell / sampleStep);
  const double inv = 1.0 / (static_cast<double>(taps) * taps);

  out.gray.assign(static_cast<size_t>(gW) * gH, 0.0f);
  out.w = gW;
  out.h = gH;
  out.scale = cell;

  const int rowStep = stride * sampleStep;
  const int colStep = bpp * sampleStep;

  for (int cy = 0; cy < gH; cy++) {
    const int topRow = cy * cell * stride;
    for (int cx = 0; cx < gW; cx++) {
      int sum = 0;
      int rowBase = topRow;
      const int left = cx * cell * bpp;
      for (int ty = 0; ty < taps; ty++, rowBase += rowStep) {
        int p = rowBase + left;
        for (int tx = 0; tx < taps; tx++, p += colStep) {
          // Integer luma, exactly as the TypeScript does it: the >> 8 truncates
          // toward zero on a non-negative value, so this is the same number.
          sum += (77 * src[p + layout.rOff] + 150 * src[p + layout.gOff] +
                  29 * src[p + layout.bOff]) >> 8;
        }
      }
      out.gray[static_cast<size_t>(cy) * gW + cx] = static_cast<float>(sum * inv);
    }
  }
  return out;
}

std::vector<float> sobelMagnitude(const float* gray, int w, int h) {
  std::vector<float> mag(static_cast<size_t>(w) * h, 0.0f);
  for (int y = 1; y < h - 1; y++) {
    for (int x = 1; x < w - 1; x++) {
      const int i = y * w + x;
      // Read as double, as JavaScript does when it loads from a Float32Array.
      const double tl = gray[i - w - 1], t = gray[i - w], tr = gray[i - w + 1];
      const double l = gray[i - 1], r = gray[i + 1];
      const double bl = gray[i + w - 1], b = gray[i + w], br = gray[i + w + 1];
      const double gx = tr + 2 * r + br - tl - 2 * l - bl;
      const double gy = bl + 2 * b + br - tl - 2 * t - tr;
      mag[i] = static_cast<float>(std::abs(gx) + std::abs(gy));
    }
  }
  return mag;
}

std::vector<uint8_t> binarize(const float* mag, int w, int h, double k) {
  const size_t n = static_cast<size_t>(w) * h;
  // Sequential accumulation in double, matching the JavaScript loop exactly.
  double sum = 0;
  for (size_t i = 0; i < n; i++) sum += mag[i];
  const double mean = sum / static_cast<double>(n);
  double varSum = 0;
  for (size_t i = 0; i < n; i++) {
    const double d = mag[i] - mean;
    varSum += d * d;
  }
  const double sd = std::sqrt(varSum / static_cast<double>(n));
  const double thr = mean + k * sd;

  std::vector<uint8_t> bin(n, 0);
  for (size_t i = 0; i < n; i++) bin[i] = mag[i] > thr ? 1 : 0;

  // Dilate by one 3x3 step to close the gaps a thresholded edge leaves.
  std::vector<uint8_t> out(n, 0);
  for (int y = 1; y < h - 1; y++) {
    for (int x = 1; x < w - 1; x++) {
      const int i = y * w + x;
      if (bin[i] || bin[i - 1] || bin[i + 1] || bin[i - w] || bin[i + w] ||
          bin[i - w - 1] || bin[i - w + 1] || bin[i + w - 1] || bin[i + w + 1]) {
        out[i] = 1;
      }
    }
  }
  return out;
}

std::vector<Component> findComponents(const float* gray, int w, int h,
                                      int minSize, double k) {
  const std::vector<float> mag = sobelMagnitude(gray, w, h);
  const std::vector<uint8_t> bin = binarize(mag.data(), w, h, k);
  const size_t n = static_cast<size_t>(w) * h;

  std::vector<uint8_t> seen(n, 0);
  std::vector<int32_t> stack(n);
  std::vector<int32_t> minX(h), maxX(h);
  std::vector<int32_t> rowMark(h, -1);
  std::vector<Component> found;
  int compId = -1;

  for (size_t start = 0; start < n; start++) {
    if (!bin[start] || seen[start]) continue;
    compId++;
    int sp = 0;
    stack[sp++] = static_cast<int32_t>(start);
    seen[start] = 1;
    int size = 0;
    int y0 = h;
    int y1 = -1;

    while (sp > 0) {
      const int i = stack[--sp];
      size++;
      const int x = i % w;
      const int y = i / w;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (rowMark[y] != compId) {
        rowMark[y] = compId;
        minX[y] = x;
        maxX[y] = x;
      } else {
        if (x < minX[y]) minX[y] = x;
        if (x > maxX[y]) maxX[y] = x;
      }

      // Neighbours are visited in the same order as the port, because the
      // traversal order decides the stack order and therefore which pixel of a
      // tie ends up first - and the comparison is exact.
      for (int dy = -1; dy <= 1; dy++) {
        const int ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (int dx = -1; dx <= 1; dx++) {
          const int nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const int j = ny * w + nx;
          if (bin[j] && !seen[j]) {
            seen[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }

    if (size < minSize) continue;
    Component c;
    c.size = size;
    for (int y = y0; y <= y1; y++) {
      if (rowMark[y] != compId) continue;
      c.xs.push_back(minX[y]);
      c.ys.push_back(y);
      if (maxX[y] != minX[y]) {
        c.xs.push_back(maxX[y]);
        c.ys.push_back(y);
      }
    }
    found.push_back(std::move(c));
  }
  return found;
}

}  // namespace bulksift
