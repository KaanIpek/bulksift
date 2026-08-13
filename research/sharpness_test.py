"""OCR failed at 8% because heavy motion blur physically destroys 18px digits.
That points at the real product answer: don't scan a random frame, scan the
SHARPEST one. A card swiped past a lens yields 15-30 frames and they are not
equally good. This measures how much picking the best frame buys.
"""
import json
import os

import cv2
import numpy as np

from recognize_test import CANON_H, CANON_W, descriptor, pack, hamming_all
from realcam_test import make_frame, rectify_frame
from hires_test import norm_gray_hi, disc_rerank_hi, W2, H2

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
HIRES_DIR = os.path.join(HERE, "images_hires")


def sharpness(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(g, cv2.CV_64F).var())


def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    idx_of = {m["id"]: i for i, m in enumerate(meta)}

    canon, bits = [], []
    for m in meta:
        c = cv2.resize(cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png")),
                       (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(c)
        bits.append(descriptor(c))
    db = pack(np.array(bits))

    hard = [("base2-22", "base4-27"), ("base2-27", "base4-30"),
            ("base2-38", "base4-48"), ("base2-45", "base4-59"),
            ("base2-53", "base4-76"), ("base2-56", "base4-80"),
            ("base2-39", "base4-52"), ("base2-54", "base4-77"),
            ("swsh1-64", "swsh45-30"), ("swsh1-79", "swsh45-37"),
            ("swsh1-155", "swsh45-54"), ("dp1-119", "dp3-128")]
    hires, ghi = {}, {}
    for f in os.listdir(HIRES_DIR):
        cid = f[:-4]
        if cid in idx_of:
            img = cv2.imread(os.path.join(HIRES_DIR, f))
            if img is not None:
                hires[idx_of[cid]] = img
                ghi[idx_of[cid]] = norm_gray_hi(img)
    targets = sorted({idx_of[a] for a, b in hard if a in idx_of and idx_of[a] in hires} |
                     {idx_of[b] for a, b in hard if b in idx_of and idx_of[b] in hires})

    rng = np.random.default_rng(53)
    K = 8
    BURST = 12
    res = {"any": [0, 0, 0], "sharp": [0, 0, 0]}   # [n, stage1, stage1+disc]

    def evaluate(rect, truth):
        r_lo = cv2.resize(rect, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        best = None
        for c_lo, c_hi in ((r_lo, rect), (cv2.rotate(r_lo, cv2.ROTATE_180),
                                          cv2.rotate(rect, cv2.ROTATE_180))):
            d = hamming_all(db, pack(descriptor(c_lo)))
            top = np.argpartition(d, K)[:K]
            top = top[np.argsort(d[top])]
            if best is None or d[top[0]] < best[0]:
                best = (int(d[top[0]]), top, c_hi)
            _, top, q = best
        s1 = int(top[0]) == truth
        shortlist = [int(j) for j in top if int(j) in ghi]
        s2 = s1
        if shortlist:
            sc = disc_rerank_hi(norm_gray_hi(q), [ghi[j] for j in shortlist])
            s2 = shortlist[int(np.argmax(sc))] == truth
        return s1, s2

    sharp_vals = {"correct": [], "wrong": []}
    for i in targets:
        rects = []
        for _ in range(BURST):
            r = rectify_frame(make_frame(hires[i], rng), W2, H2)
            if r is not None:
                rects.append(r)
        if not rects:
            continue

        # (a) a single arbitrary frame, as before
        pick = rects[0]
        s1, s2 = evaluate(pick, i)
        res["any"][0] += 1
        res["any"][1] += s1
        res["any"][2] += s2

        # (b) the sharpest frame of the burst
        sh = [sharpness(r) for r in rects]
        best_r = rects[int(np.argmax(sh))]
        s1b, s2b = evaluate(best_r, i)
        res["sharp"][0] += 1
        res["sharp"][1] += s1b
        res["sharp"][2] += s2b

        for r, v in zip(rects, sh):
            ok, _ = evaluate(r, i)
            sharp_vals["correct" if ok else "wrong"].append(v)

    print("=" * 68)
    print(f"{len(targets)} hardest reprint cards, bursts of {BURST} frames")
    print("=" * 68)
    for k, label in (("any", "arbitrary frame"), ("sharp", "sharpest of burst")):
        n, a, b = res[k]
        print(f"  {label:<20} stage1 {a}/{n} ({a/max(n,1)*100:5.1f}%)   "
              f"+re-rank {b}/{n} ({b/max(n,1)*100:5.1f}%)")
    c, w = sharp_vals["correct"], sharp_vals["wrong"]
    if c and w:
        print(f"\n  sharpness of frames that matched   : median {np.median(c):7.0f}")
        print(f"  sharpness of frames that missed    : median {np.median(w):7.0f}")
        print(f"  -> a sharpness gate is a usable quality signal "
              f"({'separable' if np.median(c) > np.median(w) * 1.15 else 'weak'})")


if __name__ == "__main__":
    main()
