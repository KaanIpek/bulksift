"""Generate realistic camera frames as raw RGBA so the TypeScript engine can be
tested end to end in Node - detection, rectification, hashing and search - using
exactly the simulation that produced the feasibility numbers.

Writes to packages/core/test/fixtures:
  scan_frames.bin   N frames of width*height*4 RGBA
  scan_meta.json    frame size and the true card id + index row per frame
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "research"))

DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
OUT = os.path.join(ROOT, "packages", "core", "test", "fixtures")
os.makedirs(OUT, exist_ok=True)

FW, FH = 1280, 720       # what the web app feeds the engine
N_FRAMES = 100


def make_frame(card, rng):
    """Card composited into a frame with perspective, glare, blur and noise."""
    h, w = card.shape[:2]
    bg = np.full((FH, FW, 3), rng.integers(25, 205, 3), np.uint8)
    bg = np.clip(bg.astype(np.float32) + rng.normal(0, 7, bg.shape), 0, 255).astype(np.uint8)

    scale = rng.uniform(0.60, 0.92) * FH / h
    tw, th = w * scale, h * scale
    cx = FW / 2 + rng.uniform(-90, 90)
    cy = FH / 2 + rng.uniform(-22, 22)
    ang = np.deg2rad(rng.uniform(-13, 13))
    base = np.float32([[-tw / 2, -th / 2], [tw / 2, -th / 2],
                       [tw / 2, th / 2], [-tw / 2, th / 2]])
    base += rng.uniform(-0.05, 0.05, (4, 2)).astype(np.float32) * np.float32([tw, th])
    R = np.float32([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]])
    dst = base @ R.T + np.float32([cx, cy])
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), dst)

    warped = cv2.warpPerspective(card, M, (FW, FH))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (FW, FH))
    frame = bg.copy()
    frame[mask > 0] = warped[mask > 0]

    if rng.random() < 0.55:
        gl = np.zeros((FH, FW), np.float32)
        cv2.ellipse(gl, (int(cx + rng.uniform(-60, 60)), int(cy + rng.uniform(-60, 60))),
                    (int(rng.uniform(30, 100)), int(rng.uniform(12, 40))),
                    rng.uniform(0, 180), 0, 360, 1.0, -1)
        gl = cv2.GaussianBlur(gl, (0, 0), rng.uniform(10, 30))
        frame = np.clip(frame.astype(np.float32) + gl[..., None] * rng.uniform(40, 110),
                        0, 255).astype(np.uint8)

    frame = np.clip(frame.astype(np.float32) * rng.uniform(0.7, 1.3)
                    + rng.uniform(-20, 20), 0, 255).astype(np.uint8)

    if rng.random() < 0.6:
        k = int(rng.integers(3, 9))
        kern = np.zeros((k, k), np.float32)
        a = rng.uniform(0, np.pi)
        for t in range(k):
            x = int((t - k // 2) * np.cos(a) + k // 2)
            y = int((t - k // 2) * np.sin(a) + k // 2)
            kern[np.clip(y, 0, k - 1), np.clip(x, 0, k - 1)] = 1
        frame = cv2.filter2D(frame, -1, kern / kern.sum())

    frame = cv2.GaussianBlur(frame, (0, 0), rng.uniform(0.4, 1.1))
    frame = np.clip(frame.astype(np.float32) + rng.normal(0, rng.uniform(2, 7), frame.shape),
                    0, 255).astype(np.uint8)
    _, enc = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, int(rng.integers(60, 92))])
    return cv2.imdecode(enc, cv2.IMREAD_COLOR), dst


def main():
    cards = json.load(open(os.path.join(DATA, "cards.json"), encoding="utf-8"))
    row_of = {c["i"]: n for n, c in enumerate(cards)}
    available = [c for c in cards if os.path.exists(os.path.join(IMG, c["i"] + ".png"))]
    print(f"{len(available)} indexed cards have a local image")

    rng = np.random.default_rng(97)
    picks = rng.choice(len(available), N_FRAMES, replace=False)

    blob = bytearray()
    meta = []
    for k in picks:
        c = available[int(k)]
        src = cv2.imread(os.path.join(IMG, c["i"] + ".png"))
        if src is None:
            continue
        frame, truth = make_frame(src, rng)
        rgba = np.dstack([frame[:, :, 2], frame[:, :, 1], frame[:, :, 0],
                          np.full((FH, FW), 255, np.uint8)])
        blob += rgba.astype(np.uint8).tobytes()
        meta.append({"id": c["i"], "row": row_of[c["i"]], "name": c["n"], "set": c["S"],
                     "quad": [[float(x), float(y)] for x, y in truth]})

    with open(os.path.join(OUT, "scan_frames.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(OUT, "scan_meta.json"), "w", encoding="utf-8") as f:
        json.dump({"width": FW, "height": FH, "count": len(meta), "frames": meta}, f)
    print(f"wrote {len(meta)} frames ({len(blob)/1e6:.1f} MB) at {FW}x{FH}")


if __name__ == "__main__":
    main()
