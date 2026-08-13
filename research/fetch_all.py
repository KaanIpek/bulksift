"""Download the complete English Pokemon TCG catalogue (metadata + small images)."""
import json
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "images_all")
os.makedirs(OUT, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (BulkSift research)"}


def get(url, tries=6):
    last = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                          timeout=60).read()
        except Exception as e:
            last = e
            time.sleep(1.2 * (i + 1))
    raise last


def main():
    sets = json.loads(get("https://api.pokemontcg.io/v2/sets?pageSize=250"))["data"]
    print(f"{len(sets)} sets")
    meta = []
    for n, s in enumerate(sets):
        try:
            cards = json.loads(get(
                f"https://api.pokemontcg.io/v2/cards?q=set.id:{s['id']}&pageSize=250"
            ))["data"]
        except Exception as e:
            print(f"  {s['id']} FAILED {e}")
            continue
        for c in cards:
            meta.append({
                "id": c["id"], "name": c["name"], "number": c.get("number"),
                "set_id": c["set"]["id"], "set_name": c["set"]["name"],
                "series": c["set"].get("series"),
                "printedTotal": c["set"].get("printedTotal"),
                "releaseDate": c["set"].get("releaseDate"),
                "rarity": c.get("rarity"), "supertype": c.get("supertype"),
                "img": c["images"]["small"],
                "tcgplayer_url": c.get("tcgplayer", {}).get("url"),
                "tcgplayer": c.get("tcgplayer", {}).get("prices"),
                "tcgplayer_updated": c.get("tcgplayer", {}).get("updatedAt"),
                "cardmarket": c.get("cardmarket", {}).get("prices"),
            })
        print(f"  [{n+1:3d}/{len(sets)}] {s['id']:10s} {len(cards):4d}  total={len(meta)}")

    with open(os.path.join(HERE, "all_meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    print(f"\nmetadata saved: {len(meta)} cards")

    def dl(m):
        p = os.path.join(OUT, m["id"].replace("/", "_") + ".png")
        if os.path.exists(p) and os.path.getsize(p) > 1000:
            return True
        try:
            with open(p, "wb") as f:
                f.write(get(m["img"], tries=3))
            return True
        except Exception:
            return False

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=24) as ex:
        res = list(ex.map(dl, meta))
    print(f"images: {sum(res)}/{len(meta)} in {(time.time()-t0)/60:.1f} min")


if __name__ == "__main__":
    main()
