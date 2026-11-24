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
UA = {"User-Agent": "Mozilla/5.0"}
TCGCSV = "https://tcgcsv.com/tcgplayer"
CATEGORY = 3
MIN_KEEP_RATIO = 0.90
# catalogue.json is 18 MB and is not committed, so the scheduled job cannot read
# it. The only thing this script needs from it is which TCGplayer product each
# card is - 0.5 MB - so that is written beside it and committed. Every local
# run rewrites it, which keeps it from drifting behind a rebuilt catalogue.
PRICE_MAP = os.path.join(DATA, "price_map.json")


# tcgcsv throttles by answering 401. Measured 2026-11-24: one run at 8 workers
# went through in 11 s, and a second run straight after it lost 2,520 cards to
# 401s on dozens of sets. So: few workers, and a wait that doubles.
WORKERS = 3


def get(url, tries=5, timeout=45):
    last = None
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read())
        except Exception as e:
            last = e
            time.sleep(2.0 * (2 ** i))
    raise RuntimeError(f"{url}: {last}")


def main():
    cat_path = os.path.join(DATA, "catalogue.json")
    by_product = {}
    if os.path.exists(cat_path):
        cat = json.load(open(cat_path, encoding="utf-8"))
        for c in cat:
            pid = c.get("tcgplayerProductId")
            if pid:
                by_product.setdefault(int(pid), []).append(c["id"])
        tmp = PRICE_MAP + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({str(k): v for k, v in sorted(by_product.items())}, f,
                      separators=(",", ":"))
        os.replace(tmp, PRICE_MAP)
        print(f"{len(cat)} cards, {len(by_product)} distinct TCGplayer products "
              f"(price_map.json rewritten)")
        # After a catalogue rebuild the prices are already fresh (build_index
        # wrote them) and only the map is behind. This brings it level without
        # asking the feed for 222 more files it may refuse.
        if "--map-only" in sys.argv:
            book = json.load(open(os.path.join(DATA, "prices.json"), encoding="utf-8"))
            meta_tmp = os.path.join(DATA, "prices-meta.json.tmp")
            with open(meta_tmp, "w", encoding="utf-8") as f:
                json.dump({"updated": book["updated"], "cards": len(book["prices"])},
                          f, separators=(",", ":"))
            os.replace(meta_tmp, os.path.join(DATA, "prices-meta.json"))
            print(f"map only; manifest set to {book['updated']}, {len(book['prices'])} cards")
            return 0
    elif os.path.exists(PRICE_MAP):
        raw = json.load(open(PRICE_MAP, encoding="utf-8"))
        by_product = {int(k): v for k, v in raw.items()}
        print(f"no catalogue.json; {len(by_product)} products from price_map.json")
    else:
        print("no catalogue.json and no price_map.json - run tools/build_catalogue.py first")
        return 1

    groups = get(f"{TCGCSV}/{CATEGORY}/groups")["results"]
    print(f"fetching prices for {len(groups)} sets")

    rows = []
    failed = []

    def fetch(g):
        try:
            return get(f"{TCGCSV}/{CATEGORY}/{g['groupId']}/prices")["results"]
        except Exception as e:
            print(f"  group {g['groupId']} {g['name']}: {e}")
            failed.append(g["groupId"])
            return []

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for res in ex.map(fetch, groups):
            rows.extend(res)
    print(f"  {len(rows)} price rows in {time.time()-t0:.0f}s")

    prices = {}
    for r in rows:
        ids = by_product.get(int(r["productId"]))
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
    carried = 0
    if os.path.exists(out_path):
        try:
            before = json.load(open(out_path, encoding="utf-8"))["prices"]
            previous = len(before)
            # A set that could not be fetched today keeps yesterday's prices.
            # Dropping them instead would send every card in that set to the
            # keep pile as "unpriced", which is the safe direction but a wrong
            # answer the user can see. Only when something failed: with a clean
            # run, a card missing from the feed really has been delisted.
            if failed:
                for cid, entry in before.items():
                    if cid not in prices:
                        prices[cid] = entry
                        carried += 1
        except Exception:
            previous = 0

    if failed:
        print(f"  {len(failed)} sets could not be fetched; "
              f"{carried} cards keep their previous price")
    print(f"  priced {len(prices)} cards (previous file had {previous})")
    if len(failed) > len(groups) * 0.25:
        print("REFUSING to publish: more than a quarter of the sets failed. "
              "The existing prices.json is left in place.")
        return 1
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

    # The manifest the app checks before pulling 1.7 MB.
    #
    # Written here rather than by hand because the two files disagreeing is a
    # silent failure in the worse direction: a stale manifest beside a fresh
    # book means no device ever fetches the new prices, and nothing anywhere
    # reports an error. Same writer, same run, same date.
    meta_path = os.path.join(os.path.dirname(out_path), "prices-meta.json")
    meta_tmp = meta_path + ".tmp"
    with open(meta_tmp, "w", encoding="utf-8") as f:
        json.dump(
            {"updated": payload["updated"], "cards": len(prices)},
            f, separators=(",", ":"),
        )
    os.replace(meta_tmp, meta_path)

    print(f"wrote data/prices.json ({os.path.getsize(out_path)/1e6:.2f} MB) "
          f"for {payload['updated']}")
    print(f"wrote data/prices-meta.json ({os.path.getsize(meta_path)} bytes)")
    print("run `npm run sync` to push it into the apps")
    print("upload BOTH files to the price host; the manifest is what devices check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
