"""Does the portable descriptor hold the accuracy of the research prototype?

The prototype hit 99.7% top-1 but leans on cv2 INTER_AREA / DCT / Lab, which do
not reproduce exactly off-Python. If the portable version measures the same, we
ship it; if it costs accuracy, that cost has to be known before 20k cards get
indexed with it.
"""
import json
import os
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "research"))

from descriptor import (CANON_H, CANON_W, descriptor_bits, pack,  # noqa: E402
                        hamming_all, N_BITS, N_BYTES)
from recognize_test import (descriptor as proto_desc, pack as proto_pack,  # noqa: E402
                           hamming_all as proto_ham, make_scene,
                           detect_and_rectify)

RESEARCH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "research")
IMG_DIR = os.path.join(RESEARCH, "images")


def main():
    meta = json.load(open(os.path.join(RESEARCH, "sample_meta.json")))
    meta = [m for m in meta if os.path.exists(os.path.join(IMG_DIR, m["id"] + ".png"))]
    print(f"catalogue: {len(meta)} cards | portable descriptor: "
          f"{N_BITS} bits ({N_BYTES} bytes)")

    canon, new_bits, old_bits = [], [], []
    t0 = time.time()
    for m in meta:
        img = cv2.resize(cv2.imread(os.path.join(IMG_DIR, m["id"] + ".png")),
                         (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        canon.append(img)
        new_bits.append(descriptor_bits(img))
        old_bits.append(proto_desc(img))
    db_new = pack(np.array(new_bits))
    db_old = proto_pack(np.array(old_bits))
    print(f"index built in {time.time()-t0:.0f}s | portable {db_new.nbytes/1024:.0f} KB "
          f"-> {db_new.nbytes/len(meta)*20444/1e6:.2f} MB for 20,444 cards")

    rng = np.random.default_rng(7)
    N = 400
    idxs = rng.choice(len(meta), N, replace=False)
    hit_new = hit_old = det = 0
    t_new = t_old = 0.0
    dist_ok, dist_bad = [], []

    for i in idxs:
        rect = detect_and_rectify(make_scene(canon[i], rng))
        if rect is None:
            continue
        det += 1
        rots = [rect, cv2.rotate(rect, cv2.ROTATE_180)]

        t = time.time()
        best = None
        for r in rots:
            d = hamming_all(db_new, pack(descriptor_bits(r)))
            j = int(np.argmin(d))
            if best is None or d[j] < best[0]:
                best = (int(d[j]), j)
        t_new += time.time() - t
        if best[1] == i:
            hit_new += 1
            dist_ok.append(best[0])
        else:
            dist_bad.append(best[0])

        t = time.time()
        best_o = None
        for r in rots:
            d = proto_ham(db_old, proto_pack(proto_desc(r)))
            j = int(np.argmin(d))
            if best_o is None or d[j] < best_o[0]:
                best_o = (int(d[j]), j)
        t_old += time.time() - t
        if best_o[1] == i:
            hit_old += 1

    print(f"\n--- {N} simulated frames, {det} detected ---")
    print(f"  research prototype (cv2/DCT/Lab) : {hit_old}/{det} "
          f"({hit_old/max(det,1)*100:.1f}%)  {t_old/max(det,1)*1000:.1f} ms")
    print(f"  portable descriptor              : {hit_new}/{det} "
          f"({hit_new/max(det,1)*100:.1f}%)  {t_new/max(det,1)*1000:.1f} ms")
    if dist_ok:
        print(f"\n  correct match distance : median {np.median(dist_ok):.0f} "
              f"p95 {np.percentile(dist_ok,95):.0f}  (of {N_BITS} bits)")
    if dist_bad:
        print(f"  wrong   match distance : median {np.median(dist_bad):.0f}")
        thr = np.percentile(dist_ok, 99)
        rejected = sum(1 for d in dist_bad if d > thr)
        print(f"  a threshold at {thr:.0f} rejects {rejected}/{len(dist_bad)} "
              f"wrong matches while keeping 99% of correct ones")


if __name__ == "__main__":
    main()
