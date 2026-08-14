"""Publish the price file the app downloads, and the manifest it checks first.

This is the whole server side of BulkSift. There is no API, no per-scan call and
no account behind it - recognition happens on the device, so the only thing that
has to reach a phone after install is a list of prices.

WHAT IT COSTS
-------------
The data is free: tcgcsv.com mirrors TCGplayer's feed, no key, no per-call
charge, refreshed by tools/refresh_prices.py in about 220 small requests.

Serving it is very nearly free too, and the numbers are worth writing down
because they decide whether freshness should be sold:

    prices.json           1.73 MB raw
                          0.26 MB gzipped   <- what crosses the wire
    prices-meta.json      ~90 bytes

At 0.26 MB a refresh, ten thousand people checking daily is about 78 GB a month.
On Cloudflare R2 egress is free and storage is $0.015/GB-month, so a 2 MB file
costs a fraction of a cent. On a plain CDN with paid egress it would be a few
dollars a month at that scale.

And most of those 78 GB never happen: the app reads the manifest first and stops
if the date matches what it already has, so a device that is current transfers
about ninety bytes instead of a quarter of a megabyte.

That is why the app refreshes prices for everyone, free, once a day. Charging to
make prices correct would be charging to fix a defect, and it would not even be
recovering a cost.

USAGE
-----
    python tools/refresh_prices.py       # rebuild data/prices.json from tcgcsv
    python tools/publish_prices.py out   # write the two files to publish

Then upload the contents of `out/` to any static host and set PRICE_HOST in
apps/mobile/src/pricesStore.ts. Serve them with gzip on and a short cache
lifetime for the manifest.
"""

from __future__ import annotations

import gzip
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRICES = os.path.join(ROOT, "data", "prices.json")

# The app refuses a file that lost more than a tenth of its cards; publishing
# one would be publishing an outage. Better to fail here, where a person is
# watching, than to ship it and have every phone quietly reject it.
MIN_CARDS = 15000


def main() -> int:
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "dist", "prices")
    if not os.path.exists(PRICES):
        print("no data/prices.json - run tools/refresh_prices.py first")
        return 1

    raw = open(PRICES, "rb").read()
    book = json.loads(raw)
    cards = len(book.get("prices", {}))

    if cards < MIN_CARDS:
        print(f"refusing to publish: only {cards:,} cards priced, expected >= {MIN_CARDS:,}")
        return 1
    if not book.get("updated"):
        print("refusing to publish: the file has no `updated` date")
        return 1

    os.makedirs(out_dir, exist_ok=True)

    # The manifest is what almost every request actually fetches, so it is kept
    # to the two fields the app needs to decide.
    manifest = {"updated": book["updated"], "cards": cards}
    manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode()

    with open(os.path.join(out_dir, "prices.json"), "wb") as f:
        f.write(raw)
    with open(os.path.join(out_dir, "prices-meta.json"), "wb") as f:
        f.write(manifest_bytes)

    gz = gzip.compress(raw, 9)
    print(f"prices.json       {len(raw) / 1e6:.2f} MB raw, {len(gz) / 1e6:.2f} MB gzipped")
    print(f"prices-meta.json  {len(manifest_bytes)} bytes")
    print(f"{cards:,} cards priced, built {book['updated']}")
    print(f"\nwrote {out_dir}")
    print(
        f"\nat {len(gz) / 1e6:.2f} MB a refresh, 10,000 daily users is about "
        f"{len(gz) * 10000 * 30 / 1e9:.0f} GB a month - free on Cloudflare R2, "
        f"and most of it never happens because of the manifest check."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
