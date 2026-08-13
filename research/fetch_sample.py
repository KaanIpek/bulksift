"""Fetch a diverse sample of Pokemon card images for the recognition feasibility test.

Deliberately biased toward the hard cases:
  - heavy reprints (Pikachu, Charizard) where the same art appears in many sets
  - old sets (base/neo) whose scans are noisier
  - modern full-art / textured cards
"""
import json
import time
import urllib.request
import os
from concurrent.futures import ThreadPoolExecutor

OUT = os.path.join(os.path.dirname(__file__), "images")
UA = {"User-Agent": "Mozilla/5.0 (BulkSift research)"}


def get(url, tries=5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            return urllib.request.urlopen(req, timeout=45).read()
        except Exception as e:  # transient 500s are common on this API
            last = e
            time.sleep(1.0 * (i + 1))
    raise last


# A spread across eras: WotC, e-Card, EX, DP, BW, XY, SM, SWSH, SV
SETS = [
    "base1", "base2", "base3", "base4", "base5", "neo1", "neo4",
    "ecard1", "ex1", "ex7", "dp1", "dp3", "hgss1", "bw1", "bw9",
    "xy1", "xy7", "sm1", "sm9", "swsh1", "swsh4", "swsh12", "swsh45",
    "sv1", "sv3pt5", "sv4", "sv8",
]


def main():
    cards = []
    for sid in SETS:
        try:
            data = json.loads(get(
                f"https://api.pokemontcg.io/v2/cards?q=set.id:{sid}&pageSize=250"
            ))
            got = data["data"]
            cards.extend(got)
            print(f"{sid:8s} {len(got):4d} cards")
        except Exception as e:
            print(f"{sid:8s} FAILED {e}")
    print(f"\ntotal sampled cards: {len(cards)}")

    meta = []
    for c in cards:
        meta.append({
            "id": c["id"],
            "name": c["name"],
            "number": c.get("number"),
            "set_id": c["set"]["id"],
            "set_name": c["set"]["name"],
            "rarity": c.get("rarity"),
            "img": c["images"]["small"],
            "tcgplayer": c.get("tcgplayer", {}).get("prices"),
        })
    with open(os.path.join(os.path.dirname(__file__), "sample_meta.json"), "w") as f:
        json.dump(meta, f)

    def dl(m):
        path = os.path.join(OUT, m["id"] + ".png")
        if os.path.exists(path) and os.path.getsize(path) > 1000:
            return True
        try:
            blob = get(m["img"])
            with open(path, "wb") as f:
                f.write(blob)
            return True
        except Exception:
            return False

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=16) as ex:
        results = list(ex.map(dl, meta))
    dt = time.time() - t0
    ok = sum(results)
    print(f"downloaded {ok}/{len(meta)} in {dt:.1f}s  ({ok / max(dt, 1e-9):.1f} img/s)")
    total_mb = sum(
        os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)
    ) / 1e6
    print(f"disk: {total_mb:.0f} MB for {ok} images -> "
          f"~{total_mb / max(ok, 1) * 20479 / 1000:.1f} GB for all 20,479")


if __name__ == "__main__":
    main()
