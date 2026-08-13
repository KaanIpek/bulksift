"""Export fixtures so the TypeScript descriptor can be proven identical to this
reference implementation.

The index is built by Python and searched by TypeScript on device. If the two
disagree by even one bit the app does not error - it quietly matches the wrong
card and quotes the wrong price. So the agreement is tested, not assumed.

Writes:
  parity_input.bin   N cards, each 240*336*4 bytes of RGBA
  parity_expect.bin  N cards, each 93 bytes of packed descriptor
  parity_meta.json   card ids, in order
"""
import json
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from descriptor import CANON_H, CANON_W, descriptor_bits, pack, N_BYTES  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "packages", "core", "test", "fixtures")
os.makedirs(OUT, exist_ok=True)

N = 250


def main():
    img_dir = os.path.join(DATA, "images")
    files = sorted(f for f in os.listdir(img_dir) if f.endswith(".png"))
    if len(files) < N:
        print(f"only {len(files)} images available, using all of them")
    step = max(1, len(files) // N)
    picked = files[::step][:N]

    rgba_out = bytearray()
    desc_out = bytearray()
    ids = []
    for fn in picked:
        img = cv2.imread(os.path.join(img_dir, fn))
        if img is None:
            continue
        img = cv2.resize(img, (CANON_W, CANON_H), interpolation=cv2.INTER_AREA)
        rgba = np.dstack([
            img[:, :, 2], img[:, :, 1], img[:, :, 0],
            np.full((CANON_H, CANON_W), 255, np.uint8),
        ])
        rgba_out += rgba.astype(np.uint8).tobytes()
        desc_out += pack(descriptor_bits(img)).tobytes()
        ids.append(fn[:-4])

    with open(os.path.join(OUT, "parity_input.bin"), "wb") as f:
        f.write(rgba_out)
    with open(os.path.join(OUT, "parity_expect.bin"), "wb") as f:
        f.write(desc_out)
    with open(os.path.join(OUT, "parity_meta.json"), "w") as f:
        json.dump({"count": len(ids), "width": CANON_W, "height": CANON_H,
                   "bytesPerDescriptor": N_BYTES, "ids": ids}, f, indent=1)
    print(f"wrote {len(ids)} fixtures "
          f"({len(rgba_out)/1e6:.1f} MB input, {len(desc_out)} bytes expected)")


if __name__ == "__main__":
    main()
