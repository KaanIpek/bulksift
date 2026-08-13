"""Stage 2: download every card image and build the shippable recognition index.

Outputs three artifacts:
  data/index.bin   packed 742-bit descriptors, one row per card (~1.9 MB)
  data/cards.json  the metadata the scanner needs to display a hit
  data/prices.json the price snapshot, refreshed on its own daily cadence

Card art is NEVER shipped - only hashes, which cannot be turned back into an
image. That keeps the app clear of The Pokemon Company's image copyright while
still recognising all 20k cards offline.
"""
import json
import os
import struct
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from descriptor import (CANON_H, CANON_W, descriptor_bits, pack,  # noqa: E402
                        pack_strip, strip_bits, N_BITS, N_BYTES,
                        STRIP_BITS, STRIP_BYTES)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
os.makedirs(IMG, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (BulkSift build)"}

MAGIC = b"PKSC"
# Version 2 appends a second block of footer descriptors after the main rows.
# They are kept apart rather than widened into each row so the hot search loop -
# a linear scan of 20k rows, the most expensive thing the phone does - keeps
# reading exactly the bytes it compares, and the footer is only ever fetched for
# the handful of candidates a near-tie produces.
VERSION = 2


def safe_name(card_id):
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in card_id) + ".png"


def main():
    """Hashes whatever images are already on disk. Fetching is a separate,
    resumable step (tools/download_images.py) because the CDN throttles and a
    download that stalls should not also cost you the index build."""
    cat = json.load(open(os.path.join(DATA, "catalogue.json"), encoding="utf-8"))
    print(f"{len(cat)} cards | descriptor {N_BITS} bits / {N_BYTES} bytes"
          f" | footer {STRIP_BITS} bits / {STRIP_BYTES} bytes")

    print("[1/3] locating cached images")
    paths = {}
    for c in cat:
        p = os.path.join(IMG, safe_name(c["id"]))
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            paths[c["id"]] = p
    print(f"  {len(paths)}/{len(cat)} images on disk "
          f"({len(cat)-len(paths)} still missing - run tools/download_images.py)")

    print("[2/3] hashing")
    rows, strips, kept, failed = [], [], [], []
    t0 = time.time()
    for n, c in enumerate(cat):
        p = paths.get(c["id"])
        if not p:
            failed.append(c["id"])
            continue
        img = cv2.imread(p)
        if img is None:
            failed.append(c["id"])
            continue
        img = cv2.resize(img, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        rows.append(pack(descriptor_bits(img)))
        strips.append(pack_strip(strip_bits(img)))
        kept.append(c)
        if (n + 1) % 5000 == 0:
            print(f"    {n+1}/{len(cat)}")
    db = np.array(rows, dtype=np.uint8)
    strip_db = np.array(strips, dtype=np.uint8)
    print(f"  hashed {len(kept)} cards in {time.time()-t0:.0f}s, "
          f"{len(failed)} skipped")

    print("[3/3] writing artifacts")
    with open(os.path.join(DATA, "index.bin"), "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<HHHI", VERSION, N_BITS, N_BYTES, len(kept)))
        f.write(struct.pack("<HH", STRIP_BITS, STRIP_BYTES))
        f.write(db.tobytes())
        f.write(strip_db.tobytes())

    # Compact form: set fields are interned and rows are arrays, because these
    # ship inside the mobile bundle. Repeating the set name, release date and a
    # full TCGplayer URL on every one of 20k cards cost ~2.3 MB for information
    # that is either shared or derivable from the product id.
    set_index, set_rows = {}, []
    card_rows, prices = [], {}
    for c in kept:
        key = c["setId"]
        if key not in set_index:
            set_index[key] = len(set_rows)
            set_rows.append([c["setId"], c["setName"], c["releaseDate"]])
        card_rows.append([
            c["id"], c["name"], c["number"], c["rarity"],
            set_index[key], c["tcgplayerProductId"],
        ])
        if c.get("prices"):
            prices[c["id"]] = {
                k: {"m": v.get("market"), "l": v.get("low"), "h": v.get("high")}
                for k, v in c["prices"].items()
            }
    cards = {"sets": set_rows, "cards": card_rows}
    for name, obj in (("cards.json", cards), ("prices.json",
                                              {"updated": time.strftime("%Y-%m-%d"),
                                               "currency": "USD",
                                               "source": "TCGplayer via tcgcsv.com",
                                               "prices": prices})):
        with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)

    for n in ("index.bin", "cards.json", "prices.json"):
        print(f"  data/{n:12s} {os.path.getsize(os.path.join(DATA, n))/1e6:6.2f} MB")
    if failed:
        with open(os.path.join(DATA, "missing_images.json"), "w") as f:
            json.dump(failed, f)
        print(f"  {len(failed)} cards had no usable image (listed in "
              f"data/missing_images.json)")


if __name__ == "__main__":
    main()
