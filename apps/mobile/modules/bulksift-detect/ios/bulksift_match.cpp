#include "bulksift_match.h"

#include <algorithm>
#include <cstring>
#include <vector>

namespace bulksift {
namespace {

// Mirrors matcher.ts. The probe compares the leading words of every row and
// only the survivors are compared in full; a partial Hamming distance can only
// grow, so a row rejected there could never have won.
constexpr int PROBE_WORDS = 8;
constexpr int PROBE_SLACK = 32;
constexpr int SHORTLIST = 512;

struct Index {
  std::vector<uint32_t> words;
  std::vector<uint8_t> strips;
  int32_t rows = 0;
  int32_t bytesPerRow = 0;
  int32_t wordsPerRow = 0;
  int32_t bits = 0;
  int32_t stripBytes = 0;
  // Scratch, allocated once. Searching must not allocate: it runs several times
  // a frame and this is the whole point of moving it here.
  std::vector<int32_t> probes;
  std::vector<int32_t> shortlist;
  std::vector<uint32_t> query;
};

Index g;

inline int popcount32(uint32_t v) {
  v = v - ((v >> 1) & 0x55555555u);
  v = (v & 0x33333333u) + ((v >> 2) & 0x33333333u);
  v = (v + (v >> 4)) & 0x0f0f0f0fu;
  v = (v + (v >> 8)) & 0x00ff00ffu;
  return static_cast<int>((v + (v >> 16)) & 0x3fu);
}

inline uint16_t readU16(const uint8_t* p) {
  return static_cast<uint16_t>(p[0] | (p[1] << 8));
}
inline uint32_t readU32(const uint8_t* p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
         (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

/** Load the query into the scratch word buffer, zero-padded like the port. */
bool loadQuery(const uint8_t* query, int32_t queryLen) {
  if (queryLen != g.bytesPerRow) return false;
  std::memcpy(g.query.data(), query, static_cast<size_t>(queryLen));
  return true;
}

inline int rowDistance(int32_t row, int words) {
  const uint32_t* w = g.words.data() + static_cast<size_t>(row) * g.wordsPerRow;
  const uint32_t* q = g.query.data();
  int d = 0;
  for (int i = 0; i < words; i++) d += popcount32(w[i] ^ q[i]);
  return d;
}

}  // namespace

int32_t indexLoad(const uint8_t* data, int32_t len) {
  if (len < 14) return -1;
  if (std::memcmp(data, "PKSC", 4) != 0) return -2;
  const uint16_t version = readU16(data + 4);
  if (version != 1 && version != 2) return -3;
  const uint16_t bits = readU16(data + 6);
  const uint16_t bytesPerRow = readU16(data + 8);
  const uint32_t rows = readU32(data + 10);
  if (bytesPerRow == 0 || (bytesPerRow % 4) != 0) return -4;

  const int32_t stripBits = version >= 2 ? readU16(data + 14) : 0;
  const int32_t stripBytes = version >= 2 ? readU16(data + 16) : 0;
  const int32_t headerBytes = version >= 2 ? 18 : 14;
  const int64_t need = static_cast<int64_t>(headerBytes) +
                       static_cast<int64_t>(rows) * bytesPerRow +
                       static_cast<int64_t>(rows) * stripBytes;
  if (len < need) return -1;
  (void)stripBits;

  g.rows = static_cast<int32_t>(rows);
  g.bits = bits;
  g.bytesPerRow = bytesPerRow;
  g.wordsPerRow = bytesPerRow / 4;
  g.stripBytes = stripBytes;

  g.words.assign(static_cast<size_t>(rows) * g.wordsPerRow, 0);
  std::memcpy(g.words.data(), data + headerBytes,
              static_cast<size_t>(rows) * bytesPerRow);

  if (stripBytes > 0) {
    g.strips.assign(static_cast<size_t>(rows) * stripBytes, 0);
    std::memcpy(g.strips.data(), data + headerBytes + static_cast<size_t>(rows) * bytesPerRow,
                static_cast<size_t>(rows) * stripBytes);
  } else {
    g.strips.clear();
  }

  g.probes.assign(rows, 0);
  g.shortlist.assign(SHORTLIST, 0);
  g.query.assign(g.wordsPerRow, 0);
  return g.rows;
}

int32_t indexRows() { return g.rows; }
int32_t indexStripBytes() { return g.stripBytes; }

SearchResult indexSearch(const uint8_t* query, int32_t queryLen) {
  SearchResult out{-1, -1, -1, -1};
  if (g.rows == 0 || !loadQuery(query, queryLen)) return out;

  const int probeWords = std::min(PROBE_WORDS, g.wordsPerRow);
  int32_t minProbe = 0x7fffffff;
  for (int32_t r = 0; r < g.rows; r++) {
    const int d = rowDistance(r, probeWords);
    g.probes[r] = d;
    if (d < minProbe) minProbe = d;
  }

  int32_t cutoff = minProbe + PROBE_SLACK;
  int32_t n = 0;
  for (;;) {
    n = 0;
    for (int32_t r = 0; r < g.rows; r++) {
      if (g.probes[r] <= cutoff) {
        if (n == SHORTLIST) break;
        g.shortlist[n++] = r;
      }
    }
    if (n < SHORTLIST || cutoff <= minProbe) break;
    cutoff = minProbe + ((cutoff - minProbe) >> 1);
  }

  int bestD = 0x7fffffff, secondD = 0x7fffffff;
  int32_t bestI = -1, secondI = -1;
  for (int32_t i = 0; i < n; i++) {
    const int32_t r = g.shortlist[i];
    const int d = rowDistance(r, g.wordsPerRow);
    if (d < bestD) {
      secondD = bestD;
      secondI = bestI;
      bestD = d;
      bestI = r;
    } else if (d < secondD) {
      secondD = d;
      secondI = r;
    }
  }

  out.bestIndex = bestI;
  out.bestDistance = bestI >= 0 ? bestD : -1;
  out.runnerUpIndex = secondI;
  out.runnerUpDistance = secondI >= 0 ? secondD : -1;
  return out;
}

int32_t indexStripDistance(int32_t row, const uint8_t* strip, int32_t stripLen) {
  if (g.strips.empty() || row < 0 || row >= g.rows) return -1;
  if (stripLen < g.stripBytes) return -1;
  const uint8_t* s = g.strips.data() + static_cast<size_t>(row) * g.stripBytes;
  int d = 0;
  for (int32_t i = 0; i < g.stripBytes; i++) d += popcount32(static_cast<uint32_t>(s[i] ^ strip[i]));
  return d;
}

int32_t indexTopK(const uint8_t* query, int32_t queryLen, int32_t k,
                  int32_t* outPairs, int32_t outLen) {
  if (g.rows == 0 || k <= 0 || outLen < k * 2) return 0;
  if (!loadQuery(query, queryLen)) return 0;

  // Same shape as the port: a small array kept sorted, so ties resolve the same
  // way - the earlier row wins, because a later equal distance is not "< worst".
  std::vector<std::pair<int32_t, int32_t>> heap;  // (distance, row)
  heap.reserve(static_cast<size_t>(k));
  int worst = 0x7fffffff;
  for (int32_t r = 0; r < g.rows; r++) {
    const int d = rowDistance(r, g.wordsPerRow);
    if (static_cast<int32_t>(heap.size()) < k) {
      heap.emplace_back(d, r);
      if (static_cast<int32_t>(heap.size()) == k) {
        std::stable_sort(heap.begin(), heap.end(),
                         [](const auto& a, const auto& b) { return a.first < b.first; });
        worst = heap[k - 1].first;
      }
    } else if (d < worst) {
      heap[k - 1] = {d, r};
      std::stable_sort(heap.begin(), heap.end(),
                       [](const auto& a, const auto& b) { return a.first < b.first; });
      worst = heap[k - 1].first;
    }
  }
  std::stable_sort(heap.begin(), heap.end(),
                   [](const auto& a, const auto& b) { return a.first < b.first; });

  int32_t written = 0;
  for (const auto& e : heap) {
    outPairs[written * 2] = e.second;
    outPairs[written * 2 + 1] = e.first;
    written++;
  }
  return written;
}

}  // namespace bulksift
