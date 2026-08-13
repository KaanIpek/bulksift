"""Does stage 2 fail because the REFERENCE is too low-res to hold the evidence?

The stage-1 index uses the 245x342 'small' images, where the collector number is
~6 px tall - the pixels that separate a card from its reprint barely exist. This
retests the discriminative re-rank using the 734x1024 'hires' references, where
the same text is ~18 px tall.
"""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

from recognize_test import (CANON_H, CANON_W, descriptor, pack, hamming_all,
                            make_scene)
from disc_test import rectify, grad, wcorr, align

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
HIRES_DIR = os.path.join(HERE, "images_hires")
os.makedirs(HIRES_DIR, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (BulkSift research)"}

# stage-2 resolution, ~3x the old one
W2, H2 = 640, 896


def norm_gray_hi(bgr):
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.createCLAHE(2.0, (8, 8)).apply(
        cv2.resize(g, (W2, H2), interpolation=cv2.INTER_AREA))


def align_hi(q, ref):
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(
            cv2.resize(ref, (W2 // 2, H2 // 2)), cv2.resize(q, (W2 // 2, H2 // 2)),
            warp, cv2.MOTION_AFFINE,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), None, 5)
    except cv2.error:
        return q
    warp[0, 2] *= 2
    warp[1, 2] *= 2
    return cv2.warpAffine(q, warp, (W2, H2),
                          flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_REPLICATE)


def disc_rerank_hi(q_gray, cand_grays, keep_pct=96):
    stack = np.stack([grad(c) for c in cand_grays])
    W = cv2.GaussianBlur(stack.std(axis=0), (0, 0), 1.2)
    if W.max() < 1e-6:
        return [0.0] * len(cand_grays)
    W = W / W.max()
    W = np.where(W > np.percentile(W, keep_pct), W, 0.0)
    qg = grad(align_hi(q_gray, cand_grays[0]))
    return [wcorr(qg, cg, W) for cg in stack]


def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    idx_of = {m["id"]: i for i, m in enumerate(meta)}

    hard = [("base2-22", "base4-27"), ("base2-27", "base4-30"),
            ("base2-38", "base4-48"), ("base2-45", "base4-59"),
            ("base2-53", "base4-76"), ("base2-56", "base4-80"),
            ("base2-39", "base4-52"), ("base2-54", "base4-77"),
            ("swsh1-64", "swsh45-30"), ("swsh1-79", "swsh45-37"),
            ("swsh1-155", "swsh45-54"), ("dp1-119", "dp3-128")]
    targets = sorted({idx_of[a] for a, b in hard if a in idx_of} |
                     {idx_of[b] for a, b in hard if b in idx_of})

    # stage-1 index over the whole sample (unchanged, 'small' images)
    canon, bits = [], []
    for m in meta:
        c = cv2.resize(cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png")),
                       (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(c)
        bits.append(descriptor(c))
    db = pack(np.array(bits))

    # hires references: only needed for cards that ever reach a shortlist.
    # fetch for the targets plus their coarse neighbours.
    need = set(targets)
    for i in targets:
        d = hamming_all(db, db[i])
        need.update(int(j) for j in np.argsort(d)[:12])
    need = sorted(need)
    print(f"fetching {len(need)} hires references...")

    def dl(i):
        p = os.path.join(HIRES_DIR, meta[i]["id"] + ".png")
        if os.path.exists(p) and os.path.getsize(p) > 5000:
            return
        url = meta[i]["img"].replace(".png", "_hires.png")
        for a in range(4):
            try:
                with open(p, "wb") as f:
                    f.write(urllib.request.urlopen(
                        urllib.request.Request(url, headers=UA), timeout=60).read())
                return
            except Exception:
                time.sleep(1.0 * (a + 1))

    with ThreadPoolExecutor(max_workers=16) as ex:
        list(ex.map(dl, need))

    ghi = {}
    for i in need:
        p = os.path.join(HIRES_DIR, meta[i]["id"] + ".png")
        if os.path.exists(p) and os.path.getsize(p) > 5000:
            ghi[i] = norm_gray_hi(cv2.imread(p))
    print(f"hires refs ready: {len(ghi)}/{len(need)}")

    rng = np.random.default_rng(23)
    K = 8
    s1 = s_hi = det = tot = 0
    t2 = 0.0
    wrong = []
    for i in targets:
        for _ in range(6):
            tot += 1
            r_hi = rectify(make_scene(canon[i], rng), W2, H2)
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
            _, top, q_img = best
            if top[0] == i:
                s1 += 1
            shortlist = [j for j in top if int(j) in ghi]
            if not shortlist:
                continue
            t = time.time()
            sc = disc_rerank_hi(norm_gray_hi(q_img), [ghi[int(j)] for j in shortlist])
            t2 += time.time() - t
            win = int(shortlist[int(np.argmax(sc))])
            if win == i:
                s_hi += 1
            else:
                wrong.append((meta[i]["id"], meta[win]["id"]))

    print("\n" + "=" * 66)
    print(f"{len(targets)} hardest reprint cards x6 = {tot} scans, {det} detected")
    print("=" * 66)
    print(f"  stage 1 only                     : {s1:3d}/{det}  ({s1/max(det,1)*100:5.1f}%)")
    print(f"  + discriminative re-rank @ HIRES  : {s_hi:3d}/{det}  ({s_hi/max(det,1)*100:5.1f}%)")
    print(f"  stage-2 cost: {t2/max(det,1)*1000:.0f} ms/card")
    if wrong:
        from collections import Counter
        print(f"\n  remaining {len(wrong)} errors:")
        for (a, b), n in Counter(wrong).most_common(10):
            print(f"     {a:<12} -> {b:<12} x{n}")


if __name__ == "__main__":
    main()
