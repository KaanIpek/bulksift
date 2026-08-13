"""Can the bottom strip of a card separate two printings of the same artwork?

The collector number itself is out of reach - OCR on it was measured at 66%
accuracy with the number legible in 8% of frames, because motion blur destroys
an 18-pixel digit. But the number is not the only thing down there. The set
symbol sits beside it, and a set symbol is a solid graphic several times the
size of a digit, which is exactly the kind of signal a coarse hash keeps.

This asks the question directly, before any of it is built into the index:
for each pair of same-artwork printings, is the strip of printing A closer to
A's own reference than to B's?

  python tools/try_strip.py
"""
import json
import os
import sys
from collections import defaultdict

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from descriptor import CANON_H, CANON_W  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMAGES = os.path.join(DATA, "images")

# The strip: the bottom ~11% of the card, full width. Holds the collector
# number, the set symbol, the rarity mark and the copyright line - everything
# that differs between two printings of one picture.
STRIP_Y0 = 300
STRIP_Y1 = 336
GX, GY = 30, 4


def strip_bits(bgr):
    """Horizontal-difference bits over the bottom strip."""
    gray = np.floor(
        0.299 * bgr[:, :, 2] + 0.587 * bgr[:, :, 1] + 0.114 * bgr[:, :, 0]
    ).astype(np.int64)
    region = gray[STRIP_Y0:STRIP_Y1, :]
    h, w = region.shape
    cells = region.reshape(GY, h // GY, GX, w // GX).sum(axis=(1, 3))
    return (cells[:, 1:] > cells[:, :-1]).ravel()


def load(card_id):
    path = os.path.join(IMAGES, f"{card_id}.png")
    if not os.path.exists(path):
        return None
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        return None
    return cv2.resize(img, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)


def main():
    catalogue = json.load(open(os.path.join(DATA, "catalogue.json"), encoding="utf8"))
    cards = catalogue["cards"] if isinstance(catalogue, dict) else catalogue

    # Group by artwork: same Pokemon name printed in more than one set.
    by_name = defaultdict(list)
    for c in cards:
        by_name[c["name"]].append(c)

    groups = [v for v in by_name.values() if len(v) > 1]
    print(f"{len(cards)} cards, {len(groups)} names printed more than once")

    rng = np.random.default_rng(7)
    rng.shuffle(groups)

    tested = 0
    strip_wins = 0
    main_wins = 0
    both = 0
    dists_self = []
    dists_other = []

    for group in groups:
        if tested >= 400:
            break
        imgs = []
        for c in group[:2]:
            im = load(c["id"])
            if im is not None:
                imgs.append((c, im))
        if len(imgs) < 2:
            continue
        (ca, ia), (cb, ib) = imgs[0], imgs[1]

        sa, sb = strip_bits(ia), strip_bits(ib)
        # How far apart are the two printings' strips?
        d_ab = int(np.count_nonzero(sa != sb))
        dists_other.append(d_ab)

        # A blurred, resampled version of A stands in for a camera read of it.
        blur = cv2.GaussianBlur(ia, (5, 5), 1.2)
        noisy = np.clip(
            blur.astype(np.int16) + rng.integers(-6, 7, blur.shape, dtype=np.int16),
            0, 255,
        ).astype(np.uint8)
        sq = strip_bits(noisy)
        d_self = int(np.count_nonzero(sq != sa))
        d_rival = int(np.count_nonzero(sq != sb))
        dists_self.append(d_self)

        tested += 1
        if d_self < d_rival:
            strip_wins += 1
        if d_ab > 0:
            both += 1

    n = max(1, tested)
    print(f"\ntested {tested} reprint pairs, strip = {GY * (GX - 1)} bits")
    print(f"  the two printings' strips differ at all : {both}/{tested}")
    print(f"  strip picks the right printing          : {strip_wins}/{tested} "
          f"({strip_wins / n * 100:.0f}%)")
    print(f"\n  distance to its own strip     : median {np.median(dists_self):.0f}")
    print(f"  distance between the printings: median {np.median(dists_other):.0f}, "
          f"p10 {np.percentile(dists_other, 10):.0f}")
    print("\nA strip only helps if the two printings are far apart in it while a")
    print("camera read stays close to its own. Compare the two medians above.")
    _ = main_wins


if __name__ == "__main__":
    main()
