"""The decisive reprint test, simulated at real camera resolution.

Earlier runs rendered the synthetic frame from the 245x342 'small' image, so the
query physically could not contain the collector-number detail that separates a
card from its reprint - the tiebreak was being asked to read pixels that were
never there. Here the 'physical card' is the 734x1024 hires scan, composited
into a 1920x1080 frame, which is what a phone or webcam actually sees.
"""
import json
import os
import time

import cv2
import numpy as np

from recognize_test import CANON_H, CANON_W, descriptor, pack, hamming_all, order_quad
from disc_test import grad, wcorr
from hires_test import norm_gray_hi, align_hi, disc_rerank_hi, W2, H2

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
HIRES_DIR = os.path.join(HERE, "images_hires")
FW, FH = 1920, 1080


def make_frame(card_hi, rng):
    h, w = card_hi.shape[:2]
    bg = np.full((FH, FW, 3), rng.integers(25, 205, 3), np.uint8)
    bg = np.clip(bg.astype(np.float32) + rng.normal(0, 7, bg.shape), 0, 255).astype(np.uint8)

    scale = rng.uniform(0.58, 0.92) * FH / h
    tw, th = w * scale, h * scale
    cx = FW / 2 + rng.uniform(-260, 260)
    cy = FH / 2 + rng.uniform(-60, 60)
    ang = np.deg2rad(rng.uniform(-14, 14))
    base = np.float32([[-tw / 2, -th / 2], [tw / 2, -th / 2],
                       [tw / 2, th / 2], [-tw / 2, th / 2]])
    base += rng.uniform(-0.05, 0.05, (4, 2)).astype(np.float32) * np.float32([tw, th])
    R = np.float32([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = base @ R.T + np.float32([cx, cy])
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), dst)

    warped = cv2.warpPerspective(card_hi, M, (FW, FH))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (FW, FH))
    frame = bg.copy()
    frame[mask > 0] = warped[mask > 0]

    if rng.random() < 0.6:  # holo / sleeve glare
        gl = np.zeros((FH, FW), np.float32)
        cv2.ellipse(gl, (int(cx + rng.uniform(-160, 160)), int(cy + rng.uniform(-160, 160))),
                    (int(rng.uniform(90, 300)), int(rng.uniform(35, 120))),
                    rng.uniform(0, 180), 0, 360, 1.0, -1)
        gl = cv2.GaussianBlur(gl, (0, 0), rng.uniform(30, 90))
        frame = np.clip(frame.astype(np.float32) + gl[..., None] * rng.uniform(50, 130),
                        0, 255).astype(np.uint8)

    frame = np.clip(frame.astype(np.float32) * rng.uniform(0.62, 1.35)
                    + rng.uniform(-28, 28), 0, 255).astype(np.uint8)

    if rng.random() < 0.75:  # motion blur - card swiped past the lens
        k = int(rng.integers(3, 17))
        kern = np.zeros((k, k), np.float32)
        a = rng.uniform(0, np.pi)
        for t in range(k):
            x = int((t - k // 2) * np.cos(a) + k // 2)
            y = int((t - k // 2) * np.sin(a) + k // 2)
            kern[np.clip(y, 0, k - 1), np.clip(x, 0, k - 1)] = 1
        frame = cv2.filter2D(frame, -1, kern / kern.sum())

    frame = cv2.GaussianBlur(frame, (0, 0), rng.uniform(0.5, 1.8))
    frame = np.clip(frame.astype(np.float32) + rng.normal(0, rng.uniform(2, 9), frame.shape),
                    0, 255).astype(np.uint8)
    _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, int(np.random.default_rng(
        int(rng.integers(0, 1 << 30))).integers(55, 92))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


def rectify_frame(frame, w, h, det_scale=0.33):
    small = cv2.resize(frame, None, fx=det_scale, fy=det_scale)
    gray = cv2.bilateralFilter(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), 5, 60, 60)
    edges = cv2.dilate(cv2.Canny(gray, 30, 110), np.ones((3, 3), np.uint8), iterations=2)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    fa = small.shape[0] * small.shape[1]
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:10]:
        if cv2.contourArea(c) < 0.05 * fa:
            break
        peri = cv2.arcLength(c, True)
        for eps in (0.02, 0.035, 0.05):
            ap = cv2.approxPolyDP(c, eps * peri, True)
            if len(ap) == 4 and cv2.isContourConvex(ap):
                quad = order_quad(ap.reshape(4, 2).astype(np.float32)) / det_scale
                M = cv2.getPerspectiveTransform(
                    quad, np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
                return cv2.warpPerspective(frame, M, (w, h))
    return None


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
    targets = sorted({idx_of[a] for a, b in hard if a in idx_of} |
                     {idx_of[b] for a, b in hard if b in idx_of})

    hires, ghi = {}, {}
    for f in os.listdir(HIRES_DIR):
        cid = f[:-4]
        if cid in idx_of:
            img = cv2.imread(os.path.join(HIRES_DIR, f))
            if img is not None:
                hires[idx_of[cid]] = img
                ghi[idx_of[cid]] = norm_gray_hi(img)
    targets = [i for i in targets if i in hires]
    print(f"{len(targets)} confusable cards with hires source, "
          f"{len(ghi)} hires references loaded")

    rng = np.random.default_rng(31)
    K = 8
    s1 = s2 = det = tot = 0
    t_det = t_s1 = t_s2 = 0.0
    wrong1, wrong2 = [], []

    for i in targets:
        for _ in range(8):
            tot += 1
            frame = make_frame(hires[i], rng)
            t = time.time()
            r = rectify_frame(frame, W2, H2)
            t_det += time.time() - t
            if r is None:
                continue
            det += 1
            r_lo = cv2.resize(r, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)

            t = time.time()
            best = None
            for c_lo, c_hi in ((r_lo, r), (cv2.rotate(r_lo, cv2.ROTATE_180),
                                           cv2.rotate(r, cv2.ROTATE_180))):
                d = hamming_all(db, pack(descriptor(c_lo)))
                top = np.argpartition(d, K)[:K]
                top = top[np.argsort(d[top])]
                if best is None or d[top[0]] < best[0]:
                    best = (int(d[top[0]]), top, c_hi)
            t_s1 += time.time() - t
            _, top, q_img = best
            if top[0] == i:
                s1 += 1
            else:
                wrong1.append((meta[i]["id"], meta[int(top[0])]["id"]))

            shortlist = [int(j) for j in top if int(j) in ghi]
            if not shortlist:
                continue
            t = time.time()
            sc = disc_rerank_hi(norm_gray_hi(q_img), [ghi[j] for j in shortlist])
            t_s2 += time.time() - t
            win = shortlist[int(np.argmax(sc))]
            if win == i:
                s2 += 1
            else:
                wrong2.append((meta[i]["id"], meta[win]["id"]))

    print("\n" + "=" * 70)
    print(f"REAL-RESOLUTION TEST: {tot} frames @1920x1080, {det} detected "
          f"({det/tot*100:.1f}%)")
    print("=" * 70)
    print(f"  stage 1 only (coarse hash)   : {s1:3d}/{det}  ({s1/max(det,1)*100:5.1f}%)")
    print(f"  + discriminative re-rank      : {s2:3d}/{det}  ({s2/max(det,1)*100:5.1f}%)")
    print(f"\n  latency: detect {t_det/tot*1000:.0f} ms | stage1 {t_s1/max(det,1)*1000:.0f} ms"
          f" | stage2 {t_s2/max(det,1)*1000:.0f} ms")
    from collections import Counter
    if wrong2:
        print(f"\n  remaining {len(wrong2)} errors after stage 2:")
        for (a, b), n in Counter(wrong2).most_common(10):
            print(f"     {a:<12} -> {b:<12} x{n}")
    else:
        print("\n  zero errors after stage 2")


if __name__ == "__main__":
    main()
