"""Fill the index gaps from TCGplayer's product CDN.

738 cards (3.6%) have no art on images.pokemontcg.io, and they are not random:
they cluster in the newest sets - Ascended Heroes, Perfect Order, Chaos Rising,
Pitch Black - because that mirror lags behind release. Those are exactly the
cards people scan most, and they include a $1,126 Mega Gengar ex.

Every one of them has a TCGplayer productId, and TCGplayer's own CDN serves a
597x834 image. Before using it as a second source this script checks that the
two sources agree: it hashes cards available from BOTH and reports the Hamming
distance between them. If the framing differed the index would hold descriptors
that no real scan can match.
"""
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from descriptor import CANON_H, CANON_W, descriptor_bits  # noqa: E402

DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
UA = {"User-Agent": "Mozilla/5.0 (BulkSift build)"}
CDN = "https://tcgplayer-cdn.tcgplayer.com/product/{pid}_in_1000x1000.jpg"


def safe_name(card_id):
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in card_id) + ".png"


def fetch(url, tries=3, timeout=30):
    last = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                raise
            last = e
            time.sleep(0.5 * (i + 1))
        except Exception as e:
            last = e
            time.sleep(0.5 * (i + 1))
    raise last


def decode(blob):
    arr = np.frombuffer(blob, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def trim_to_card(img):
    """TCGplayer product shots sit on a flat background with padding. Crop to
    the card so the descriptor grid lands on the same content as the primary
    source."""
    if img is None:
        return None
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # background is the dominant border colour; threshold against it
    border = np.concatenate([gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]])
    bg = np.median(border)
    mask = (np.abs(gray.astype(np.int16) - bg) > 12).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    ys, xs = np.where(mask > 0)
    if len(xs) < 100:
        return img
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    if (x1 - x0) < img.shape[1] * 0.3 or (y1 - y0) < img.shape[0] * 0.3:
        return img
    return img[y0:y1 + 1, x0:x1 + 1]


def desc_of(img):
    r = cv2.resize(img, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
    return descriptor_bits(r)


def validate(cat, n=40):
    """Compare the two sources on cards that exist in both."""
    both = [c for c in cat
            if c.get("tcgplayerProductId")
            and os.path.exists(os.path.join(IMG, safe_name(c["id"])))]
    rng = np.random.default_rng(5)
    picks = [both[int(i)] for i in rng.choice(len(both), min(n, len(both)), replace=False)]

    raw_d, trim_d = [], []
    for c in picks:
        try:
            blob = fetch(CDN.format(pid=c["tcgplayerProductId"]))
        except Exception:
            continue
        alt = decode(blob)
        if alt is None:
            continue
        primary = cv2.imread(os.path.join(IMG, safe_name(c["id"])))
        if primary is None:
            continue
        a = desc_of(primary)
        raw_d.append(int(np.sum(a != desc_of(alt))))
        trim_d.append(int(np.sum(a != desc_of(trim_to_card(alt)))))

    if not raw_d:
        print("  could not validate (no comparable pairs)")
        return False
    print(f"  compared {len(raw_d)} cards present in both sources")
    print(f"    untrimmed CDN image : median {np.median(raw_d):.0f} bits differ")
    print(f"    trimmed to the card : median {np.median(trim_d):.0f} bits differ")
    print(f"  (a correct camera match sits around 60-120 bits, so the trimmed "
          f"source is {'usable' if np.median(trim_d) < 120 else 'NOT usable'})")
    return bool(np.median(trim_d) < 120)


def main():
    cat = json.load(open(os.path.join(DATA, "catalogue.json"), encoding="utf-8"))
    by_id = {c["id"]: c for c in cat}
    missing_path = os.path.join(DATA, "missing_images.json")
    if not os.path.exists(missing_path):
        print("no missing_images.json - run tools/build_index.py first")
        return 1
    missing = json.load(open(missing_path))
    targets = [by_id[m] for m in missing
               if by_id.get(m) and by_id[m].get("tcgplayerProductId")]
    print(f"{len(missing)} cards without art, {len(targets)} have a TCGplayer product\n")

    print("validating the fallback source against the primary one:")
    ok = validate(cat)
    if not ok:
        print("\nrefusing to use the fallback: descriptors would not match real scans")
        return 1

    print(f"\nfetching {len(targets)} fallback images")
    done = {"ok": 0, "fail": 0}

    def grab(c):
        path = os.path.join(IMG, safe_name(c["id"]))
        if os.path.exists(path) and os.path.getsize(path) > 2000:
            return
        try:
            img = trim_to_card(decode(fetch(CDN.format(pid=c["tcgplayerProductId"]))))
            if img is None or img.shape[0] < 100:
                raise ValueError("bad image")
            cv2.imwrite(path, img)
            done["ok"] += 1
        except Exception:
            done["fail"] += 1

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(grab, targets))
    print(f"  recovered {done['ok']}, failed {done['fail']} in {time.time()-t0:.0f}s")
    print("\nnow re-run tools/build_index.py to fold them into the index")
    return 0


if __name__ == "__main__":
    sys.exit(main())
