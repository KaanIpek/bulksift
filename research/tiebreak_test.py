"""Stage-2 tiebreak: does a high-resolution re-rank fix the reprint confusions?

Stage 1 (coarse hash) narrows 20k cards to a handful of same-artwork candidates
in ~13 ms. Those candidates differ only in the set symbol and the collector
number, both of which live in known positions on a rectified card. Stage 2
re-ranks the shortlist by aligned normalised cross-correlation on exactly those
regions - run once per card, not once per frame.
"""
import json
import os

import cv2
import numpy as np

from recognize_test import (CANON_H, CANON_W, descriptor, pack, hamming_all,
                            make_scene, detect_and_rectify, order_quad)

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
HI_W, HI_H = 480, 672  # stage-2 working resolution

# Regions that carry print identity, as fractions of the card (x0,y0,x1,y1).
# Bottom strip = collector number + set total + rarity symbol on every era.
# Lower-right = set symbol on WotC/e-card/EX era.
REGIONS = [
    ("bottom", 0.00, 0.885, 1.00, 1.000),
    ("lower_right", 0.55, 0.60, 1.00, 0.80),
    ("full", 0.00, 0.00, 1.00, 1.00),
]
WEIGHTS = {"bottom": 3.0, "lower_right": 1.5, "full": 1.0}


def crop(img, r):
    _, x0, y0, x1, y1 = r
    h, w = img.shape[:2]
    return img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]


def prep(img):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(2.0, (8, 8)).apply(g)


def aligned_ncc(query_g, cand_g, pad=10):
    """Max NCC allowing +/-pad px misalignment from imperfect rectification."""
    if cand_g.shape[0] <= 2 * pad or cand_g.shape[1] <= 2 * pad:
        return 0.0
    tmpl = cand_g[pad:-pad, pad:-pad]
    if tmpl.shape[0] < 8 or tmpl.shape[1] < 8:
        return 0.0
    res = cv2.matchTemplate(query_g, tmpl, cv2.TM_CCOEFF_NORMED)
    return float(res.max())


def fine_score(q_hi, c_hi):
    s = 0.0
    for r in REGIONS:
        qg, cg = prep(crop(q_hi, r)), prep(crop(c_hi, r))
        s += WEIGHTS[r[0]] * aligned_ncc(qg, cg)
    return s


def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    idx_of = {m["id"]: i for i, m in enumerate(meta)}

    canon, hi, bits = [], [], []
    for m in meta:
        raw = cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png"))
        canon.append(cv2.resize(raw, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA))
        hi.append(cv2.resize(raw, (HI_W, HI_H), interpolation=cv2.INTER_CUBIC))
        bits.append(descriptor(canon[-1]))
    db = pack(np.array(bits))

    def rectify_hi(scene):
        """Same detection, but rectified straight to stage-2 resolution."""
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
                        quad, np.float32([[0, 0], [HI_W, 0], [HI_W, HI_H], [0, HI_H]]))
                    return cv2.warpPerspective(scene, M, (HI_W, HI_H))
        return None

    # ---- the specific pairs stage 1 got wrong, plus the tightest ones ----
    hard = [("base2-22", "base4-27"), ("base2-27", "base4-30"),
            ("base2-38", "base4-48"), ("base2-45", "base4-59"),
            ("base2-53", "base4-76"), ("base2-56", "base4-80"),
            ("base2-39", "base4-52"), ("base2-54", "base4-77"),
            ("swsh1-64", "swsh45-30"), ("swsh1-79", "swsh45-37"),
            ("swsh1-155", "swsh45-54"), ("dp1-119", "dp3-128")]
    hard = [(a, b) for a, b in hard if a in idx_of and b in idx_of]

    print("=" * 76)
    print("clean-image stage-2 separation on the hardest pairs")
    print("=" * 76)
    print(f"{'pair':<26}{'self':>8}{'other':>8}{'margin':>9}")
    for a, b in hard:
        ia, ib = idx_of[a], idx_of[b]
        ss, so = fine_score(hi[ia], hi[ia]), fine_score(hi[ia], hi[ib])
        print(f"{a+' vs '+b:<26}{ss:8.3f}{so:8.3f}{ss-so:9.3f}")

    # ---- end-to-end: stage 1 shortlist + stage 2 re-rank, under camera noise ----
    print("\n" + "=" * 76)
    print("end-to-end two-stage scan, 6 noisy frames per card")
    print("=" * 76)
    rng = np.random.default_rng(23)
    K = 8
    s1_hit = s2_hit = det = tot = 0
    fixed, broke = [], []
    targets = sorted({idx_of[a] for a, _ in hard} | {idx_of[b] for _, b in hard})
    for i in targets:
        for _ in range(6):
            tot += 1
            scene = make_scene(canon[i], rng)
            r_hi = rectify_hi(scene)
            if r_hi is None:
                continue
            det += 1
            r_lo = cv2.resize(r_hi, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)

            best = None
            for c_lo, c_hi_img in ((r_lo, r_hi),
                                   (cv2.rotate(r_lo, cv2.ROTATE_180),
                                    cv2.rotate(r_hi, cv2.ROTATE_180))):
                d = hamming_all(db, pack(descriptor(c_lo)))
                top = np.argpartition(d, K)[:K]
                top = top[np.argsort(d[top])]
                if best is None or d[top[0]] < best[0]:
                    best = (int(d[top[0]]), top, c_hi_img)
            _, top, q_hi = best
            if top[0] == i:
                s1_hit += 1
            scores = [fine_score(q_hi, hi[j]) for j in top]
            win = int(top[int(np.argmax(scores))])
            if win == i:
                s2_hit += 1
                if top[0] != i:
                    fixed.append((meta[i]["id"], meta[top[0]]["id"]))
            elif top[0] == i:
                broke.append((meta[i]["id"], meta[win]["id"]))

    print(f"{len(targets)} confusable cards x6 frames = {tot} scans, {det} detected")
    print(f"  stage 1 only (coarse hash)   : {s1_hit}/{det}  ({s1_hit/max(det,1)*100:.1f}%)")
    print(f"  stage 1 + stage 2 re-rank    : {s2_hit}/{det}  ({s2_hit/max(det,1)*100:.1f}%)")
    print(f"  stage 2 fixed {len(fixed)} wrong picks, broke {len(broke)} correct ones")
    for t, g in fixed[:8]:
        print(f"     FIXED  {g} -> {t}")
    for t, g in broke[:8]:
        print(f"     BROKE  {t} -> {g}")

    # ---- cost ----
    import time
    t0 = time.time()
    for _ in range(20):
        for j in range(K):
            fine_score(hi[targets[0]], hi[j])
    dt = (time.time() - t0) / 20
    print(f"\nstage-2 cost: {dt*1000:.1f} ms for K={K} candidates "
          f"(runs once per card, not per frame)")


if __name__ == "__main__":
    main()
