"""Feasibility test for real-time Pokemon card recognition.

Runs the FULL pipeline, not just a hash comparison:
  synthetic camera frame (perspective + motion blur + glare + noise)
    -> contour card detection
    -> perspective rectification
    -> perceptual hash
    -> nearest-neighbour search over the whole sampled catalogue

Reports top-1 accuracy and per-stage latency, and separately measures the
"same artwork, different set" confusion that decides pricing correctness.
"""
import json
import os
import time

import cv2
import numpy as np

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
CANON_W, CANON_H = 240, 336  # canonical rectified card size


# --------------------------------------------------------------------------
# hashing
# --------------------------------------------------------------------------
def dhash_bits(gray, size=16):
    """256-bit difference hash - robust to brightness, sensitive to layout."""
    small = cv2.resize(gray, (size + 1, size), interpolation=cv2.INTER_AREA)
    return (small[:, 1:] > small[:, :-1]).flatten()


def phash_bits(gray, size=8, factor=4):
    """64-bit DCT hash - robust to blur and scale."""
    small = cv2.resize(gray, (size * factor, size * factor),
                       interpolation=cv2.INTER_AREA).astype(np.float32)
    dct = cv2.dct(small)[:size, :size]
    flat = dct.flatten()
    med = np.median(flat[1:])
    return (flat > med)


def color_bits(bgr, grid=6):
    """Coarse colour signature - separates identical layouts with different tints."""
    small = cv2.resize(bgr, (grid, grid), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2Lab).astype(np.float32)
    out = []
    for ch in range(3):
        v = lab[:, :, ch].flatten()
        out.append(v > np.median(v))
    return np.concatenate(out)


def descriptor(bgr):
    """Full descriptor: whole card + art-window crop, packed to bits."""
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # art window: the illustration box on a classic card layout
    art = bgr[int(0.10 * CANON_H):int(0.52 * CANON_H),
              int(0.08 * CANON_W):int(0.92 * CANON_W)]
    art_gray = cv2.cvtColor(art, cv2.COLOR_BGR2GRAY)
    return np.concatenate([
        dhash_bits(gray, 16),      # 256
        phash_bits(gray),          # 64
        dhash_bits(art_gray, 12),  # 144
        color_bits(bgr, 6),        # 108
    ])


def pack(bits):
    return np.packbits(bits.astype(np.uint8), axis=-1)


POPCNT = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)


def hamming_all(db_packed, q_packed):
    """Hamming distance of one query against every row of the database."""
    x = np.bitwise_xor(db_packed, q_packed)
    return POPCNT[x].sum(axis=1)


# --------------------------------------------------------------------------
# camera simulation
# --------------------------------------------------------------------------
def make_scene(card, rng, motion=True):
    h, w = card.shape[:2]
    SW, SH = 960, 720
    bg = np.full((SH, SW, 3), rng.integers(25, 205, 3), np.uint8)
    bg = np.clip(bg.astype(np.float32) + rng.normal(0, 7, bg.shape), 0, 255).astype(np.uint8)

    scale = rng.uniform(0.50, 0.88) * SH / h
    tw, th = w * scale, h * scale
    cx = SW / 2 + rng.uniform(-70, 70)
    cy = SH / 2 + rng.uniform(-45, 45)
    ang = np.deg2rad(rng.uniform(-14, 14))
    base = np.float32([[-tw / 2, -th / 2], [tw / 2, -th / 2],
                       [tw / 2, th / 2], [-tw / 2, th / 2]])
    base = base + rng.uniform(-0.055, 0.055, (4, 2)).astype(np.float32) * np.float32([tw, th])
    R = np.float32([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = base @ R.T + np.float32([cx, cy])
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    M = cv2.getPerspectiveTransform(src, dst)

    warped = cv2.warpPerspective(card, M, (SW, SH))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (SW, SH))
    scene = bg.copy()
    scene[mask > 0] = warped[mask > 0]

    # holo / sleeve glare: bright elliptical streak
    if rng.random() < 0.6:
        gl = np.zeros((SH, SW), np.float32)
        cv2.ellipse(gl, (int(cx + rng.uniform(-90, 90)), int(cy + rng.uniform(-90, 90))),
                    (int(rng.uniform(45, 150)), int(rng.uniform(18, 60))),
                    rng.uniform(0, 180), 0, 360, 1.0, -1)
        gl = cv2.GaussianBlur(gl, (0, 0), rng.uniform(15, 45))
        scene = np.clip(scene.astype(np.float32) + gl[..., None] * rng.uniform(50, 130), 0, 255)
        scene = scene.astype(np.uint8)

    # exposure / white balance drift
    scene = np.clip(scene.astype(np.float32) * rng.uniform(0.62, 1.35)
                    + rng.uniform(-28, 28), 0, 255).astype(np.uint8)

    # motion blur - the card is being swiped past the lens
    if motion and rng.random() < 0.75:
        k = int(rng.integers(3, 13))
        kern = np.zeros((k, k), np.float32)
        a = rng.uniform(0, np.pi)
        for i in range(k):
            x = int((i - k // 2) * np.cos(a) + k // 2)
            y = int((i - k // 2) * np.sin(a) + k // 2)
            kern[np.clip(y, 0, k - 1), np.clip(x, 0, k - 1)] = 1
        kern /= kern.sum()
        scene = cv2.filter2D(scene, -1, kern)

    scene = cv2.GaussianBlur(scene, (0, 0), rng.uniform(0.4, 1.4))
    scene = np.clip(scene.astype(np.float32) + rng.normal(0, rng.uniform(2, 9), scene.shape),
                    0, 255).astype(np.uint8)
    ok, enc = cv2.imencode(".jpg", scene, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(55, 92))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR)


# --------------------------------------------------------------------------
# detection
# --------------------------------------------------------------------------
def order_quad(p):
    s = p.sum(1)
    d = np.diff(p, axis=1).ravel()
    return np.float32([p[np.argmin(s)], p[np.argmin(d)], p[np.argmax(s)], p[np.argmax(d)]])


def detect_and_rectify(scene):
    small_scale = 0.5
    small = cv2.resize(scene, None, fx=small_scale, fy=small_scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 5, 60, 60)
    edges = cv2.Canny(gray, 30, 110)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    frame_area = small.shape[0] * small.shape[1]
    for c in sorted(cnts, key=cv2.contourArea, reverse=True)[:10]:
        if cv2.contourArea(c) < 0.06 * frame_area:
            break
        peri = cv2.arcLength(c, True)
        for eps in (0.02, 0.035, 0.05):
            approx = cv2.approxPolyDP(c, eps * peri, True)
            if len(approx) == 4 and cv2.isContourConvex(approx):
                quad = order_quad(approx.reshape(4, 2).astype(np.float32)) / small_scale
                dst = np.float32([[0, 0], [CANON_W, 0], [CANON_W, CANON_H], [0, CANON_H]])
                M = cv2.getPerspectiveTransform(quad, dst)
                return cv2.warpPerspective(scene, M, (CANON_W, CANON_H))
    return None


# --------------------------------------------------------------------------
def main():
    meta = json.load(open(os.path.join(HERE, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    print(f"catalogue: {len(meta)} cards")

    print("building index...")
    t0 = time.time()
    canon, bits = [], []
    for m in meta:
        img = cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png"))
        img = cv2.resize(img, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(img)
        bits.append(descriptor(img))
    db = pack(np.array(bits))
    build_t = time.time() - t0
    nbits = len(bits[0])
    print(f"index built in {build_t:.1f}s  ({build_t / len(meta) * 1000:.1f} ms/card, "
          f"{nbits} bits, {db.nbytes / 1024:.0f} KB total -> "
          f"{db.nbytes / len(meta) * 20479 / 1e6:.1f} MB for all 20,479)")

    rng = np.random.default_rng(7)
    N = 400
    idxs = rng.choice(len(meta), N, replace=False)

    hits = miss_detect = 0
    wrong = []
    t_det = t_hash = t_search = 0.0
    margins = []

    for n, i in enumerate(idxs):
        scene = make_scene(canon[i], rng)

        t = time.time(); rect = detect_and_rectify(scene); t_det += time.time() - t
        if rect is None:
            miss_detect += 1
            continue

        best = None
        t = time.time()
        cands = [rect, cv2.rotate(rect, cv2.ROTATE_180)]
        qs = [pack(descriptor(c)) for c in cands]
        t_hash += time.time() - t

        t = time.time()
        for q in qs:
            d = hamming_all(db, q)
            j = int(np.argmin(d))
            if best is None or d[j] < best[0]:
                srt = np.partition(d, 1)[:2]
                best = (int(d[j]), j, int(srt.max() - srt.min()))
        t_search += time.time() - t

        dist, j, margin = best
        margins.append((dist, margin, j == i))
        if j == i:
            hits += 1
        else:
            wrong.append((meta[i], meta[j], dist))

    ok = N - miss_detect
    print(f"\n--- results over {N} simulated camera frames ---")
    print(f"card detected      : {ok}/{N}  ({ok / N * 100:.1f}%)")
    print(f"top-1 correct      : {hits}/{N}  ({hits / N * 100:.1f}% of all frames, "
          f"{hits / max(ok, 1) * 100:.1f}% of detected)")
    print(f"\nlatency per frame (this CPU, single thread):")
    print(f"  detect+rectify   : {t_det / N * 1000:.1f} ms")
    print(f"  hash (x2 rots)   : {t_hash / max(ok,1) * 1000:.1f} ms")
    print(f"  search {len(meta):5d} cards: {t_search / max(ok,1) * 1000:.2f} ms"
          f"   -> ~{t_search / max(ok,1) * 1000 * 20479 / len(meta):.1f} ms at 20,479 cards")
    tot = (t_det + t_hash + t_search) / N * 1000
    print(f"  TOTAL            : {tot:.1f} ms/frame  -> {1000 / tot:.0f} fps")

    good = [m for m in margins if m[2]]
    bad = [m for m in margins if not m[2]]
    if good:
        print(f"\ncorrect matches  : hamming dist median {np.median([g[0] for g in good]):.0f}")
    if bad:
        print(f"incorrect matches: hamming dist median {np.median([b[0] for b in bad]):.0f}")

    print(f"\n--- {len(wrong)} misidentifications ---")
    same_art = 0
    for truth, got, d in wrong[:25]:
        tag = ""
        if truth["name"] == got["name"]:
            same_art += 1
            tag = "  <-- SAME POKEMON, different print"
        print(f"  {truth['id']:12s} {truth['name'][:18]:18s} -> "
              f"{got['id']:12s} {got['name'][:18]:18s} d={d}{tag}")
    print(f"\nof {len(wrong)} errors, {same_art} were the same Pokemon in another set/print")


if __name__ == "__main__":
    main()
