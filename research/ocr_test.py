"""Final experiment: is the collector number actually readable from a scan frame?

Correlation re-ranking plateaus at ~79% on reprint pairs because the evidence is
symbolic, not photometric: "22/64" vs "27/102". This tests whether OCR can read
that off a rectified frame - and, more usefully, whether it can pick the right
card from a known shortlist, which is far easier than open-ended reading.
"""
import json
import os
import re
import time

import cv2
import numpy as np

from recognize_test import CANON_H, CANON_W, descriptor, pack, hamming_all
from realcam_test import make_frame, rectify_frame
from hires_test import W2, H2

HERE = os.path.dirname(__file__)
IMG_DIR = os.path.join(HERE, "images")
HIRES_DIR = os.path.join(HERE, "images_hires")


def number_candidates(card_bgr):
    """Crop the strips where a collector number lives across all card eras."""
    h, w = card_bgr.shape[:2]
    return [
        card_bgr[int(0.90 * h):h, int(0.55 * w):w],   # WotC / EX / DP: bottom-right
        card_bgr[int(0.90 * h):h, 0:int(0.45 * w)],   # SWSH / SV: bottom-left
        card_bgr[int(0.86 * h):h, :],                 # whole bottom strip
    ]


def upscale(img, f=3):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
    return cv2.createCLAHE(3.0, (8, 8)).apply(g)


def parse_numbers(text):
    """Pull anything shaped like a collector number out of raw OCR text."""
    t = text.replace(" ", "").replace("O", "0").replace("o", "0")
    out = set()
    for m in re.finditer(r"(\d{1,3})\s*/\s*(\d{1,3})", t):
        out.add((m.group(1).lstrip("0") or "0", m.group(2).lstrip("0") or "0"))
    for m in re.finditer(r"\d{1,3}", t):
        out.add((m.group(0).lstrip("0") or "0", None))
    return out


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

    hires = {}
    for f in os.listdir(HIRES_DIR):
        cid = f[:-4]
        if cid in idx_of:
            img = cv2.imread(os.path.join(HIRES_DIR, f))
            if img is not None:
                hires[idx_of[cid]] = img
    targets = [i for i in targets if i in hires]

    print("loading OCR engine...")
    t0 = time.time()
    import easyocr
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    print(f"  ready in {time.time()-t0:.0f}s")

    rng = np.random.default_rng(41)
    K = 8
    s1 = s_ocr = det = tot = 0
    read_ok = read_att = 0
    t_ocr = 0.0
    wrong = []

    for i in targets:
        for _ in range(5):
            tot += 1
            r = rectify_frame(make_frame(hires[i], rng), W2, H2)
            if r is None:
                continue
            det += 1
            r_lo = cv2.resize(r, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
            best = None
            for c_lo, c_hi in ((r_lo, r), (cv2.rotate(r_lo, cv2.ROTATE_180),
                                           cv2.rotate(r, cv2.ROTATE_180))):
                d = hamming_all(db, pack(descriptor(c_lo)))
                top = np.argpartition(d, K)[:K]
                top = top[np.argsort(d[top])]
                if best is None or d[top[0]] < best[0]:
                    best = (int(d[top[0]]), top, c_hi)
            _, top, q_img = best
            if top[0] == i:
                s1 += 1

            # --- OCR the number strips, score each shortlist candidate ---
            t = time.time()
            found = set()
            for strip in number_candidates(q_img):
                txt = " ".join(reader.readtext(upscale(strip), detail=0,
                                               allowlist="0123456789/"))
                found |= parse_numbers(txt)
            t_ocr += time.time() - t
            read_att += 1

            true_num = str(meta[i]["number"]).lstrip("0")
            true_tot = str(meta[i].get("printedTotal") or "")
            if any(a == true_num for a, b in found):
                read_ok += 1

            scores = []
            for rank, j in enumerate(top):
                cn = str(meta[int(j)]["number"]).lstrip("0")
                sc = -0.01 * rank                      # keep stage-1 order as tiebreak
                for a, b in found:
                    if a == cn:
                        sc += 1.0
                scores.append(sc)
            win = int(top[int(np.argmax(scores))])
            if win == i:
                s_ocr += 1
            else:
                wrong.append((meta[i]["id"], meta[win]["id"]))

    print("\n" + "=" * 70)
    print(f"OCR TIEBREAK: {tot} frames, {det} detected")
    print("=" * 70)
    print(f"  collector number read correctly : {read_ok}/{read_att} "
          f"({read_ok/max(read_att,1)*100:.1f}%)")
    print(f"  stage 1 only                    : {s1:3d}/{det}  ({s1/max(det,1)*100:5.1f}%)")
    print(f"  stage 1 + OCR shortlist pick    : {s_ocr:3d}/{det}  "
          f"({s_ocr/max(det,1)*100:5.1f}%)")
    print(f"  OCR cost: {t_ocr/max(read_att,1)*1000:.0f} ms/card (CPU easyocr, "
          f"3 strips - a purpose-built digit net is ~5 ms)")
    from collections import Counter
    if wrong:
        print(f"\n  remaining {len(wrong)} errors:")
        for (a, b), n in Counter(wrong).most_common(10):
            print(f"     {a:<12} -> {b:<12} x{n}")


if __name__ == "__main__":
    main()
