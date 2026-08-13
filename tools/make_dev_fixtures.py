"""Copy a handful of card images into the web app's dev-fixtures folder so the
demo feed can exercise the engine without a webcam.

These images are DEVELOPMENT ONLY. Card art is copyright The Pokemon Company;
the shipped app contains hashes, never images. The folder is gitignored and
excluded from production builds - see apps/web/.gitignore.
"""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
OUT = os.path.join(ROOT, "apps", "web", "public", "dev-fixtures")

# A spread of eras and values, plus a known reprint pair (Jungle vs Base Set 2
# Mr. Mime) so the ambiguity prompt can be exercised on demand.
WANTED = [
    "base1-4",     # Base Set Charizard, the headline card
    "base1-58",    # Base Set Pikachu
    "base2-22",    # Jungle Mr. Mime
    "base4-27",    # Base Set 2 Mr. Mime - same art, ~3x cheaper
    "swsh4-188",   # Pikachu VMAX
    "sv3pt5-199",  # 151 Charizard ex
    "sv8-1",       # a modern bulk common
    "neo4-113",    # Shining Tyranitar
    "xy7-54",
    "dp1-119",
]


def main():
    if not os.path.isdir(IMG):
        print("no data/images - run tools/download_images.py first")
        return 1
    os.makedirs(OUT, exist_ok=True)
    cat = {c["id"]: c for c in json.load(open(os.path.join(DATA, "catalogue.json"),
                                             encoding="utf-8"))}
    picked = []
    for cid in WANTED:
        src = os.path.join(IMG, cid + ".png")
        if not os.path.exists(src):
            print(f"  skip {cid} (image not downloaded yet)")
            continue
        shutil.copyfile(src, os.path.join(OUT, cid + ".png"))
        picked.append(cid)
        c = cat.get(cid, {})
        pr = c.get("prices") or {}
        top = max((v.get("market") or 0) for v in pr.values()) if pr else 0
        print(f"  {cid:14s} {c.get('name','?')[:22]:22s} ${top:,.2f}")

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(picked, f)
    print(f"\n{len(picked)} fixtures in apps/web/public/dev-fixtures (dev only, gitignored)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
