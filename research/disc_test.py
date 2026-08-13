"""Stage 2, done properly: a discriminative-region re-rank.

Plain NCC failed because 98% of the compared pixels are identical between a card
and its reprint - the shared artwork drowns out the set symbol and collector
number. Here stage 2 instead:

  1. aligns the query to the shortlist with ECC (rectification is never exact),
  2. builds a weight map from the per-pixel variance ACROSS the shortlist, which
     automatically zeroes the shared artwork and lights up exactly the pixels
     that separate the candidates - no hardcoded per-era region boxes,
  3. scores candidates by weighted correlation in the gradient domain.
"""
import json
import os
import time

import cv2
import numpy as np

from recognize_test import (CANON_H, CANON_W, descriptor, pack, hamming_all,
                            make_scene, order_quad)
from tiebreak_test import fine_score, HI_W, HI_H

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
W2, H2 = 320, 448  # stage-2 alignment/compare resolution


def grad(g):
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.magnitude(gx, gy)


def norm_gray(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(2.0, (8, 8)).apply(cv2.resize(g, (W2, H2), interpolation=cv2.INTER_AREA))


def align(query_g, ref_g):
    """ECC affine align query onto ref. Returns aligned query or None."""
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(
            ref_g, query_g, warp, cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 50, 1e-4), None, 5)
    except cv2.error:
        return None
    return cv2.warpAffine(query_g, warp, (W2, H2),
                          flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_REPLICATE)


def wcorr(a, b, w):
    ws = w.sum() + 1e-9
    ma, mb = (a * w).sum() / ws, (b * w).sum() / ws
    da, dbb = a - ma, b - mb
    va = np.sqrt((da * da * w).sum() / ws) + 1e-6
    vb = np.sqrt((dbb * dbb * w).sum() / ws) + 1e-6
    return float((da * dbb * w).sum() / ws / (va * vb))


def disc_rerank(q_gray, cand_grays):
    """Return score per candidate, higher is better."""
    stack = np.stack([grad(c) for c in cand_grays])
    W = stack.std(axis=0)
    W = cv2.GaussianBlur(W, (0, 0), 1.5)
    if W.max() < 1e-6:
        return [0.0] * len(cand_grays)          # candidates truly identical
    W = W / W.max()
    W = np.where(W > np.percentile(W, 92), W, 0.0)  # keep only the top 8% pixels

    aligned = align(q_gray, cand_grays[0])
    if aligned is None:
        aligned = q_gray
    qg = grad(aligned)
    return [wcorr(qg, cg, W) for cg in stack]


def rectify(scene, w, h):
    small = cv2.resize(scene, None, fx=0.5, fy=0.5)
    gray = cv2.bilateralFilter(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), 5, 60, 60)
    edges = cv2.dilate(cv2.Canny(gray, 30, 110), np.ones((3, 3), np.uint8), iterations=2)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fa = small.shape[0] * small.shape[1]
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:10]:
        if cv2.contourArea(c) < 0.06 * fa:
            break
        peri = cv2.arcLength(c, True)
        for eps in (0.02, 0.035, 0.05):
            ap = cv2.approxPolyDP(c, eps * peri, True)
            if len(ap) == 4 and cv2.isContourConvex(ap):
                quad = order_quad(ap.reshape(4, 2).astype(np.float32)) / 0.5
                M = cv2.getPerspectiveTransform(
                    quad, np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
                return cv2.warpPerspective(scene, M, (w, h))
    return None


def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    idx_of = {m["id"]: i for i, m in enumerate(meta)}

    canon, hi, g2, bits = [], [], [], []
    for m in meta:
        raw = cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png"))
        c = cv2.resize(raw, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(c)
        hi.append(cv2.resize(raw, (HI_W, HI_H), interpolation=cv2.INTER_CUBIC))
        g2.append(norm_gray(raw))
        bits.append(descriptor(c))
    db = pack(np.array(bits))

    hard = [("base2-22", "base4-27"), ("base2-27", "base4-30"),
            ("base2-38", "base4-48"), ("base2-45", "base4-59"),
            ("base2-53", "base4-76"), ("base2-56", "base4-80"),
            ("base2-39", "base4-52"), ("base2-54", "base4-77"),
            ("swsh1-64", "swsh45-30"), ("swsh1-79", "swsh45-37"),
            ("swsh1-155", "swsh45-54"), ("dp1-119", "dp3-128")]
    targets = sorted({idx_of[a] for a, b in hard if a in idx_of} |
                     {idx_of[b] for a, b in hard if b in idx_of})

    rng = np.random.default_rng(23)
    K = 8
    s1 = s_ncc = s_disc = det = tot = 0
    t_disc = 0.0
    still_wrong = []

    for i in targets:
        for _ in range(6):
            tot += 1
            scene = make_scene(canon[i], rng)
            r_hi = rectify(scene, HI_W, HI_H)
            if r_hi is None:
                continue
            det += 1
            r_lo = cv2.resize(r_hi, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)

            best = None
            for c_lo, c_hi in ((r_lo, r_hi),
                               (cv2.rotate(r_lo, cv2.ROTATE_180),
                                cv2.rotate(r_hi, cv2.ROTATE_180))):
                d = hamming_all(db, pack(descriptor(c_lo)))
                top = np.argpartition(d, K)[:K]
                top = top[np.argsort(d[top])]
                if best is None or d[top[0]] < best[0]:
                    best = (int(d[top[0]]), top, c_hi)
            _, top, q_hi = best

            if top[0] == i:
                s1 += 1
            if int(top[int(np.argmax([fine_score(q_hi, hi[j]) for j in top]))]) == i:
                s_ncc += 1

            t = time.time()
            q_g = norm_gray(q_hi)
            sc = disc_rerank(q_g, [g2[j] for j in top])
            t_disc += time.time() - t
            win = int(top[int(np.argmax(sc))])
            if win == i:
                s_disc += 1
            else:
                still_wrong.append((meta[i]["id"], meta[win]["id"]))

    print("=" * 72)
    print(f"{len(targets)} hardest reprint cards x6 frames = {tot} scans, {det} detected")
    print("=" * 72)
    print(f"  stage 1 only  (coarse hash)      : {s1:3d}/{det}  ({s1/max(det,1)*100:5.1f}%)")
    print(f"  + plain NCC re-rank              : {s_ncc:3d}/{det}  ({s_ncc/max(det,1)*100:5.1f}%)")
    print(f"  + discriminative re-rank         : {s_disc:3d}/{det}  ({s_disc/max(det,1)*100:5.1f}%)")
    print(f"\n  discriminative stage-2 cost: {t_disc/max(det,1)*1000:.0f} ms/card (K={K})")
    if still_wrong:
        from collections import Counter
        print(f"\n  remaining {len(still_wrong)} errors:")
        for (t_, g_), n in Counter(still_wrong).most_common(10):
            print(f"     {t_:<12} -> {g_:<12}  x{n}")


if __name__ == "__main__":
    main()
