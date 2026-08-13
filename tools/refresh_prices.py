"""Refresh prices only — the daily job.

The index and the card metadata are fixed for a build; prices are not. This
re-reads just the TCGplayer price feed and rewrites data/prices.json against the
product ids already resolved in catalogue.json, so a daily refresh costs ~220
small requests instead of rebuilding a 20k-card index.

Writes atomically and refuses to publish a file that lost a large share of its
prices, because a half-fetched feed replacing a good one is worse than a
one-day-old file.
"""
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = {"User-Agent": "Mozilla/5.0 (BulkSift prices)"}
TCGCSV = "https://tcgcsv.com/tcgplayer"
CATEGORY = 3
MIN_KEEP_RATIO = 0.90


def get(url, tries=4, timeout=45):
    last = None
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read())
        except Exception as e:
            last = e
            time.sleep(1.0 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def main():
    cat_path = os.path.join(DATA, "catalogue.json")
    if not os.path.exists(cat_path):
        print("no catalogue.json - run tools/build_catalogue.py first")
        return 1
    cat = json.load(open(cat_path, encoding="utf-8"))
    by_product = {}
    for c in cat:
        pid = c.get("tcgplayerProductId")
        if pid:
            by_product.setdefault(pid, []).append(c["id"])
    print(f"{len(cat)} cards, {len(by_product)} distinct TCGplayer products")

    groups = get(f"{TCGCSV}/{CATEGORY}/groups")["results"]
    print(f"fetching prices for {len(groups)} sets")

    rows = []

    def fetch(g):
        try:
            return get(f"{TCGCSV}/{CATEGORY}/{g['groupId']}/prices")["results"]
        except Exception as e:
            print(f"  group {g['groupId']} {g['name']}: {e}")
            return []

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(fetch, groups):
            rows.extend(res)
    print(f"  {len(rows)} price rows in {time.time()-t0:.0f}s")

    prices = {}
    for r in rows:
        ids = by_product.get(r["productId"])
        if not ids:
            continue
        if r.get("marketPrice") is None and r.get("lowPrice") is None:
            continue
        entry = {
            "m": r.get("marketPrice"),
            "l": r.get("lowPrice"),
            "h": r.get("highPrice"),
        }
        for cid in ids:
            prices.setdefault(cid, {})[r["subTypeName"]] = entry

    out_path = os.path.join(DATA, "prices.json")
    previous = 0
    if os.path.exists(out_path):
        try:
            previous = len(json.load(open(out_path, encoding="utf-8"))["prices"])
        except Exception:
            previous = 0

    print(f"  priced {len(prices)} cards (previous file had {previous})")
    if previous and len(prices) < previous * MIN_KEEP_RATIO:
        print(f"REFUSING to publish: only {len(prices)/previous*100:.0f}% of the "
              f"previous card count. The feed is probably incomplete; the existing "
              f"prices.json is left in place.")
        return 1

    payload = {
        "updated": time.strftime("%Y-%m-%d"),
        "currency": "USD",
        "source": "TCGplayer via tcgcsv.com",
        "prices": prices,
    }
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, out_path)
    print(f"wrote data/prices.json ({os.path.getsize(out_path)/1e6:.2f} MB) "
          f"for {payload['updated']}")
    print("run `npm run sync` to push it into the apps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
