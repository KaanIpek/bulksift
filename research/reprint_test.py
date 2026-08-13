"""The money question: can the descriptor tell apart the SAME artwork printed in
different sets, where prices differ by 10-100x?

Base Set 2 (base4) and Legendary Collection reprint Base/Jungle/Fossil art
verbatim, changing only the set symbol, card number and (sometimes) the border.
If the scanner confuses base1 Charizard with base4 Charizard it quotes a price
that is wrong by hundreds of dollars.
"""
import json
import os
from collections import defaultdict

import cv2
import numpy as np

from recognize_test import (CANON_H, CANON_W, descriptor, pack, hamming_all,
                            make_scene, detect_and_rectify)

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")


def market(m):
    p = m.get("tcgplayer") or {}
    vals = [v.get("market") for v in p.values() if isinstance(v, dict) and v.get("market")]
    return max(vals) if vals else None


def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]

    canon, bits = [], []
    for m in meta:
        img = cv2.resize(cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png")),
                         (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(img)
        bits.append(descriptor(img))
    arr = np.array(bits)
    db = pack(arr)

    # group by Pokemon name -> find cross-set duplicates
    by_name = defaultdict(list)
    for i, m in enumerate(meta):
        by_name[m["name"]].append(i)

    print("=" * 78)
    print("PART 1  clean-image separation of same-name cards across sets")
    print("=" * 78)
    pairs = []
    for name, idxs in by_name.items():
        if len(idxs) < 2:
            continue
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                i, j = idxs[a], idxs[b]
                if meta[i]["set_id"] == meta[j]["set_id"]:
                    continue
                d = int(np.unpackbits(np.bitwise_xor(db[i], db[j])).sum())
                pairs.append((d, i, j))
    pairs.sort()
    print(f"{len(pairs)} same-name cross-set pairs in the sample")
    print(f"\nthe 18 most similar pairs (lowest = hardest to tell apart):")
    print(f"{'dist':>5}  {'card A':<13}{'price':>9}   {'card B':<13}{'price':>9}   name")
    for d, i, j in pairs[:18]:
        pa, pb = market(meta[i]), market(meta[j])
        fa = f"${pa:,.2f}" if pa else "  n/a"
        fb = f"${pb:,.2f}" if pb else "  n/a"
        ratio = ""
        if pa and pb and min(pa, pb) > 0:
            r = max(pa, pb) / min(pa, pb)
            if r >= 3:
                ratio = f"   <-- {r:.0f}x price gap"
        print(f"{d:5d}  {meta[i]['id']:<13}{fa:>9}   {meta[j]['id']:<13}{fb:>9}   "
              f"{meta[i]['name'][:16]}{ratio}")

    dists = np.array([p[0] for p in pairs])
    print(f"\nsame-name cross-set distance: min={dists.min()} "
          f"p1={np.percentile(dists,1):.0f} median={np.median(dists):.0f}")

    # baseline: distance between a card and itself under camera noise
    print("\n" + "=" * 78)
    print("PART 2  distance between a card and its own noisy camera capture")
    print("=" * 78)
    rng = np.random.default_rng(11)
    self_d = []
    for i in rng.choice(len(meta), 220, replace=False):
        rect = detect_and_rectify(make_scene(canon[i], rng))
        if rect is None:
            continue
        self_d.append(int(np.unpackbits(np.bitwise_xor(pack(descriptor(rect)), db[i])).sum()))
    self_d = np.array(self_d)
    print(f"self-match distance: median={np.median(self_d):.0f} "
          f"p95={np.percentile(self_d,95):.0f} max={self_d.max()}")
    print(f"\nSEPARATION: noisy self-match p95 = {np.percentile(self_d,95):.0f}, "
          f"nearest different-print p1 = {np.percentile(dists,1):.0f}")
    if np.percentile(self_d, 95) < np.percentile(dists, 1):
        print("  -> clean gap: a threshold sits between them, reprints stay distinguishable")
    else:
        print("  -> OVERLAP: some reprints are inside camera-noise range, need OCR tiebreak")

    # PART 3: end-to-end on the actual expensive reprint families
    print("\n" + "=" * 78)
    print("PART 3  end-to-end scan of WotC-era reprint families (the costly ones)")
    print("=" * 78)
    fam = [i for i, m in enumerate(meta)
           if m["set_id"] in ("base1", "base2", "base3", "base4", "base5")
           and len(by_name[m["name"]]) > 1]
    rng = np.random.default_rng(23)
    hit = tot = det = 0
    errs = []
    for i in fam:
        for _ in range(3):
            tot += 1
            rect = detect_and_rectify(make_scene(canon[i], rng))
            if rect is None:
                continue
            det += 1
            best = None
            for c in (rect, cv2.rotate(rect, cv2.ROTATE_180)):
                d = hamming_all(db, pack(descriptor(c)))
                j = int(np.argmin(d))
                if best is None or d[j] < best[0]:
                    best = (int(d[j]), j)
            if best[1] == i:
                hit += 1
            else:
                errs.append((meta[i], meta[best[1]], best[0]))
    print(f"{len(fam)} reprint-family cards x3 frames = {tot} scans")
    print(f"detected {det} ({det/tot*100:.1f}%), correct set+number {hit} "
          f"({hit/max(det,1)*100:.2f}% of detected)")
    for t, g, d in errs[:12]:
        print(f"   MISS {t['id']:<11} {t['name'][:15]:<15} -> {g['id']:<11} "
              f"{g['name'][:15]:<15} d={d}")


if __name__ == "__main__":
    main()
