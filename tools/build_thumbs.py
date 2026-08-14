"""Pack a thumbnail of every card into one file the app can ship.

Why bundle at all, when the catalogue's own image host exists: because it does
not have every card, and it does not say so. Asked for a card from a 2026 set it
answers 200 OK with a picture of a card *back*, so the app cannot even tell the
request failed - it just shows the wrong thing, confidently. Cards from Chaos
Rising, Ascended Heroes and Black Bolt all came back that way on a device.

The art is already here. Building the recognition index downloaded a picture of
every card, and a check of the newest sets confirms they are real art rather
than placeholders: sixty sampled cards from each gave sixty distinct images.

Two files come out:

  thumbs.bin   every thumbnail, WebP, concatenated with no separators
  thumbs.json  {w, h, off: [...], len: [...]} in the same row order as
               cards.json, so a card's picture is found by the index it
               already has

One file rather than 20,444, because a React Native bundle needs a static
require() per asset and cannot be handed a name computed at runtime. A byte
range out of one asset has neither problem, and expo-file-system can read a
range straight to base64 - which is the form an <Image> wants anyway.
"""

from __future__ import annotations

import io
import json
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "data" / "images"
OUT_DIR = ROOT / "apps" / "mobile" / "assets" / "data"

# 96 px wide is 3x the 32 pt thumbnail in the scan feed and 2.4x the 40 pt row
# in the collection, so those are sharp; the browse grid and the card sheet ask
# the network for something bigger and fall back to this, which is soft but
# always right and always there.
WIDTH = 96
HEIGHT = round(WIDTH * 342 / 245)
QUALITY = 52


def main() -> int:
    cards_path = OUT_DIR / "cards.json"
    compact = json.loads(cards_path.read_text(encoding="utf-8"))
    sets = compact["sets"]
    rows = compact["cards"]

    blobs = io.BytesIO()
    offsets: list[int] = []
    lengths: list[int] = []
    missing: list[str] = []

    for i, row in enumerate(rows):
        card_id = row[0]
        path = IMAGES / f"{card_id}.png"
        if not path.exists():
            # A card with no picture gets a zero-length entry; the app draws its
            # rarity slot, which is what it already does when a fetch fails.
            offsets.append(blobs.tell())
            lengths.append(0)
            missing.append(card_id)
            continue

        with Image.open(path) as im:
            im = im.convert("RGB").resize((WIDTH, HEIGHT), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=QUALITY, method=6)

        data = buf.getvalue()
        offsets.append(blobs.tell())
        lengths.append(len(data))
        blobs.write(data)

        if (i + 1) % 2000 == 0:
            print(f"  {i + 1:,}/{len(rows):,}  {blobs.tell() / 1e6:.1f} MB", flush=True)

    (OUT_DIR / "thumbs.bin").write_bytes(blobs.getvalue())
    (OUT_DIR / "thumbs.json").write_text(
        json.dumps({"w": WIDTH, "h": HEIGHT, "off": offsets, "len": lengths}),
        encoding="utf-8",
    )

    total = blobs.tell()
    print(f"\nthumbs.bin  {total / 1e6:,.1f} MB for {len(rows):,} cards")
    print(f"thumbs.json {(OUT_DIR / 'thumbs.json').stat().st_size / 1e6:,.1f} MB")
    print(f"average     {total / max(1, len(rows) - len(missing)):,.0f} B per card")
    if missing:
        print(f"no picture for {len(missing)}: {', '.join(missing[:6])}")
    print(f"sets covered: {len(sets)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
