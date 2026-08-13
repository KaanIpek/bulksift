"""Bundle a few real scan frames so the engine can be verified ON THE DEVICE.

Everything except VisionCamera itself is unverified on a phone: reading a 1.9 MB
binary asset, expanding the compact catalogue, constructing the Scanner, and the
speed of the whole pipeline on mobile JS. None of that needs a camera - it needs
frames. This writes a handful as raw RGB so the app can run them through the
real code path at startup.

Dev only: apps/mobile/assets/dev is gitignored and the self-test is behind
__DEV__, so this never ships.
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from export_scan_fixtures import make_frame  # noqa: E402

DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
OUT = os.path.join(ROOT, "apps", "mobile", "assets", "dev")
os.makedirs(OUT, exist_ok=True)

# 960x540 keeps the card above the 336 px canonical height while staying small
# enough to bundle: 3 frames of RGB is 4.7 MB, versus 12 MB at 1280x720 RGBA.
W, H = 960, 540
WANTED = ["base1-4", "base1-58", "neo4-113", "sv3pt5-199"]


def main():
    cards = json.load(open(os.path.join(DATA, "cards.json"), encoding="utf-8"))
    rows = cards["cards"] if isinstance(cards, dict) else cards
    sets = cards["sets"] if isinstance(cards, dict) else None

    def info(cid):
        for r in rows:
            if (r[0] if isinstance(r, list) else r["i"]) == cid:
                if isinstance(r, list):
                    return {"id": r[0], "name": r[1], "set": sets[r[4]][1]}
                return {"id": r["i"], "name": r["n"], "set": r["S"]}
        return None

    rng = np.random.default_rng(2024)
    blob = bytearray()
    meta = []
    for cid in WANTED:
        p = os.path.join(IMG, cid + ".png")
        if not os.path.exists(p):
            print(f"  skip {cid} (no image)")
            continue
        card = info(cid)
        if not card:
            print(f"  skip {cid} (not indexed)")
            continue
        src = cv2.imread(p)
        frame, _quad = make_frame(src, rng)
        frame = cv2.resize(frame, (W, H), interpolation=cv2.INTER_AREA)
        rgb = np.dstack([frame[:, :, 2], frame[:, :, 1], frame[:, :, 0]])
        blob += rgb.astype(np.uint8).tobytes()
        meta.append(card)
        print(f"  {cid:14s} {card['name'][:22]:22s} {card['set']}")

    with open(os.path.join(OUT, "testframes.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(OUT, "testframes.json"), "w", encoding="utf-8") as f:
        json.dump({"width": W, "height": H, "channels": 3,
                   "count": len(meta), "frames": meta}, f)
    print(f"\nwrote {len(meta)} frames ({len(blob)/1e6:.1f} MB) at {W}x{H} RGB")


if __name__ == "__main__":
    main()
