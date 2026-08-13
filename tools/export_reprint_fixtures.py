"""Frames for the cards that are genuinely hard: same artwork, different set.

The general fixture set samples the catalogue at random, so reprint pairs turn up
only occasionally and improvements or regressions on them hide inside sampling
noise. This builds a set made entirely of them, so the question "did that change
help or hurt the expensive cases?" has a direct answer.
"""
import json
import os
import sys
from collections import defaultdict

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from export_scan_fixtures import make_frame, FW, FH  # noqa: E402

DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
OUT = os.path.join(ROOT, "packages", "core", "test", "fixtures")

FRAMES_PER_CARD = 3


def market(prices):
    if not prices:
        return 0.0
    vals = [v.get("market") for v in prices.values() if v.get("market")]
    return max(vals) if vals else 0.0


def main():
    cat = {c["id"]: c for c in json.load(open(os.path.join(DATA, "catalogue.json"),
                                             encoding="utf-8"))}
    cards = json.load(open(os.path.join(DATA, "cards.json"), encoding="utf-8"))
    row_of = {c["i"]: n for n, c in enumerate(cards)}

    # group by (name, artist) across sets - the reprint signature
    groups = defaultdict(list)
    for c in cards:
        full = cat.get(c["i"])
        if not full:
            continue
        groups[(c["n"], full.get("artist"))].append(c["i"])

    pairs = []
    for (_name, _artist), ids in groups.items():
        if len(ids) < 2:
            continue
        sets = {cat[i]["setId"] for i in ids if i in cat}
        if len(sets) < 2:
            continue
        priced = [i for i in ids if market(cat[i].get("prices"))]
        if len(priced) < 2:
            continue
        # keep the ones where getting it wrong actually costs something
        priced.sort(key=lambda i: market(cat[i]["prices"]))
        lo, hi = priced[0], priced[-1]
        ratio = market(cat[hi]["prices"]) / max(market(cat[lo]["prices"]), 0.01)
        if ratio >= 2.0:
            pairs.append((ratio, lo, hi))

    pairs.sort(reverse=True)
    picked = []
    seen = set()
    for _ratio, lo, hi in pairs:
        for cid in (lo, hi):
            if cid in seen or cid not in row_of:
                continue
            if not os.path.exists(os.path.join(IMG, cid + ".png")):
                continue
            seen.add(cid)
            picked.append(cid)
        if len(picked) >= 60:
            break

    print(f"{len(pairs)} same-art cross-set pairs with a >=2x price gap")
    print(f"using {len(picked)} cards, {FRAMES_PER_CARD} frames each")

    rng = np.random.default_rng(1234)
    blob = bytearray()
    meta = []
    for cid in picked:
        src = cv2.imread(os.path.join(IMG, cid + ".png"))
        if src is None:
            continue
        for _ in range(FRAMES_PER_CARD):
            frame, _quad = make_frame(src, rng)
            rgba = np.dstack([frame[:, :, 2], frame[:, :, 1], frame[:, :, 0],
                              np.full((FH, FW), 255, np.uint8)])
            blob += rgba.astype(np.uint8).tobytes()
            meta.append({
                "id": cid, "row": row_of[cid],
                "name": cat[cid]["name"], "set": cat[cid]["setName"],
                "price": round(market(cat[cid].get("prices")), 2),
            })

    with open(os.path.join(OUT, "reprint_frames.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(OUT, "reprint_meta.json"), "w", encoding="utf-8") as f:
        json.dump({"width": FW, "height": FH, "count": len(meta), "frames": meta}, f)
    print(f"wrote {len(meta)} frames ({len(blob)/1e6:.0f} MB) at {FW}x{FH}")


if __name__ == "__main__":
    main()
