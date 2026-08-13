"""Stage 1 of the data pipeline: build the joined card catalogue.

Sources, chosen after testing reliability directly:
  - card catalogue  : PokemonTCG/pokemon-tcg-data GitHub zip. The live
                      api.pokemontcg.io returns 502s under load, the git repo
                      does not.
  - US market prices: tcgcsv.com, a free daily mirror of TCGplayer's own
                      catalogue+price feed. TCGplayer's official API has been
                      closed to new applicants since late 2024, and TCGCSV is
                      both reliable and MORE current (217 sets vs the API's 175).
  - card images     : images.pokemontcg.io CDN, which is served by Cloudflare
                      and stayed up while the API was failing.

Sets are joined to TCGplayer groups by name similarity and then VERIFIED by
collector-number overlap, so a bad name match cannot silently produce wrong
prices - it is reported instead.
"""
import io
import json
import os
import re
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, "cache")
os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (BulkSift build)"}

CATALOGUE_ZIP = "https://github.com/PokemonTCG/pokemon-tcg-data/archive/refs/heads/master.zip"
TCGCSV = "https://tcgcsv.com/tcgplayer"
POKEMON_CATEGORY = 3


def fetch(url, tries=5, timeout=120):
    last = None
    for i in range(tries):
        try:
            return urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=timeout).read()
        except Exception as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"failed {url}: {last}")


def fetch_json(url, cache_name=None, max_age=6 * 3600):
    if cache_name:
        p = os.path.join(CACHE, cache_name)
        if os.path.exists(p) and time.time() - os.path.getmtime(p) < max_age:
            with open(p, "rb") as f:
                return json.loads(f.read())
    blob = fetch(url)
    if cache_name:
        with open(os.path.join(CACHE, cache_name), "wb") as f:
            f.write(blob)
    return json.loads(blob)


# --------------------------------------------------------------------------
def norm_name(s):
    s = s.lower()
    s = re.sub(r"^(sv|swsh|sm|xy|bw|hgss|dp|ex|me)\d*\s*:\s*", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def norm_number(s):
    """'004/102' -> '4' ; 'TG01/TG30' -> 'tg1' ; 'SV049' -> 'sv49'."""
    if s is None:
        return None
    s = str(s).strip().split("/")[0].strip()
    m = re.match(r"^([A-Za-z]*)0*(\d+)([A-Za-z]*)$", s)
    if m:
        return (m.group(1) + m.group(2) + m.group(3)).lower()
    return s.lower()


def load_catalogue():
    zp = os.path.join(CACHE, "pokemon-tcg-data.zip")
    if not (os.path.exists(zp) and os.path.getsize(zp) > 1_000_000):
        print("  downloading catalogue zip...")
        with open(zp, "wb") as f:
            f.write(fetch(CATALOGUE_ZIP, timeout=300))
    z = zipfile.ZipFile(zp)
    set_file = [n for n in z.namelist() if n.endswith("/sets/en.json")][0]
    sets = {s["id"]: s for s in json.loads(z.read(set_file))}
    cards = []
    for n in z.namelist():
        if "/cards/en/" not in n or not n.endswith(".json"):
            continue
        sid = os.path.basename(n)[:-5]
        if sid not in sets:
            continue
        for c in json.loads(z.read(n)):
            cards.append({
                "id": c["id"],
                "name": c.get("name"),
                "number": c.get("number"),
                "rarity": c.get("rarity"),
                "supertype": c.get("supertype"),
                "subtypes": c.get("subtypes") or [],
                "artist": c.get("artist"),
                "setId": sid,
            })
    return sets, cards


def load_tcgplayer():
    groups = fetch_json(f"{TCGCSV}/{POKEMON_CATEGORY}/groups",
                        "tcg_groups.json")["results"]
    print(f"  {len(groups)} TCGplayer groups")
    products, prices = {}, defaultdict(dict)
    for n, g in enumerate(groups):
        gid = g["groupId"]
        try:
            prod = fetch_json(f"{TCGCSV}/{POKEMON_CATEGORY}/{gid}/products",
                              f"prod_{gid}.json", max_age=7 * 86400)["results"]
            pr = fetch_json(f"{TCGCSV}/{POKEMON_CATEGORY}/{gid}/prices",
                            f"price_{gid}.json", max_age=6 * 3600)["results"]
        except Exception as e:
            print(f"    group {gid} {g['name']}: FAILED {e}")
            continue
        for p in prod:
            ed = {e["name"]: e["value"] for e in p.get("extendedData", [])}
            p["_number"] = norm_number(ed.get("Number"))
            p["_rarity"] = ed.get("Rarity")
            products.setdefault(gid, []).append(p)
        for r in pr:
            if r.get("marketPrice") is not None or r.get("lowPrice") is not None:
                prices[r["productId"]][r["subTypeName"]] = {
                    "market": r.get("marketPrice"),
                    "low": r.get("lowPrice"),
                    "mid": r.get("midPrice"),
                    "high": r.get("highPrice"),
                    "directLow": r.get("directLowPrice"),
                }
        if (n + 1) % 40 == 0:
            print(f"    {n+1}/{len(groups)} groups")
    return groups, products, prices


def id_abbrevs(set_id):
    """'sm1' -> {'SM1','SM01'}; 'swsh12' -> {'SWSH12'}. TCGplayer abbreviations
    follow the same prefix+index scheme as pokemontcg set ids, zero-padded."""
    m = re.match(r"^([a-z]+)(\d+)(.*)$", set_id)
    if not m:
        return set()
    pre, num = m.group(1).upper(), int(m.group(2))
    return {f"{pre}{num}", f"{pre}{num:02d}"}


def match_sets(sets, cards_by_set, groups, products):
    """Join sets to TCGplayer groups by abbreviation first, name second, and
    VERIFY every candidate by collector-number overlap so a bad match surfaces
    as a warning instead of silently attaching the wrong prices."""
    by_abbr = defaultdict(list)
    for g in groups:
        if g.get("abbreviation"):
            by_abbr[g["abbreviation"].strip().upper()].append(g)

    group_nums = {
        g["groupId"]: {p["_number"] for p in products.get(g["groupId"], []) if p["_number"]}
        for g in groups
    }

    mapping, report = {}, []
    for sid, s in sets.items():
        mine = {norm_number(c["number"]) for c in cards_by_set.get(sid, [])}
        mine.discard(None)

        cands = []
        for key in filter(None, [(s.get("ptcgoCode") or "").strip().upper()]):
            cands += by_abbr.get(key, [])
        for key in id_abbrevs(sid):
            cands += by_abbr.get(key, [])
        target = norm_name(s["name"])
        cands += sorted(
            groups,
            key=lambda g: SequenceMatcher(None, target, norm_name(g["name"])).ratio(),
            reverse=True)[:8]

        seen, best, best_score, best_ov = set(), None, 0.0, 0.0
        for g in cands:
            if g["groupId"] in seen:
                continue
            seen.add(g["groupId"])
            nums = group_nums.get(g["groupId"]) or set()
            if not nums or not mine:
                continue
            overlap = len(mine & nums) / len(mine)          # the verification
            name_sim = SequenceMatcher(None, target, norm_name(g["name"])).ratio()
            score = 3.0 * overlap + name_sim
            if score > best_score:
                best, best_score, best_ov = g, score, overlap

        if best and best_ov >= 0.5:
            mapping[sid] = best["groupId"]
        report.append({
            "setId": sid, "setName": s["name"],
            "group": best["name"] if best else None,
            "groupId": best["groupId"] if best else None,
            "numberOverlap": round(best_ov, 3),
            "accepted": bool(best and best_ov >= 0.5),
        })
    return mapping, report


def main():
    print("[1/4] catalogue")
    sets, cards = load_catalogue()
    print(f"  {len(sets)} sets, {len(cards)} English cards")

    print("[2/4] TCGplayer catalogue + daily prices (tcgcsv)")
    groups, products, prices = load_tcgplayer()
    n_priced = sum(len(v) for v in prices.values())
    print(f"  {sum(len(v) for v in products.values())} products, {n_priced} price rows")

    print("[3/4] joining sets to TCGplayer groups")
    cards_by_set = defaultdict(list)
    for c in cards:
        cards_by_set[c["setId"]].append(c)
    mapping, report = match_sets(sets, cards_by_set, groups, products)
    rejected = [r for r in report if not r["accepted"]]
    print(f"  matched {len(mapping)}/{len(sets)} sets, {len(rejected)} rejected")
    for r in rejected[:12]:
        print(f"    REJECTED: {r['setId']:12s} {r['setName'][:28]:28s} "
              f"best={str(r['group'])[:30]:30s} overlap={r['numberOverlap']}")

    print("[4/4] joining cards to products")
    prod_by_group_num = defaultdict(list)
    for gid, plist in products.items():
        for p in plist:
            if p["_number"]:
                prod_by_group_num[(gid, p["_number"])].append(p)

    out, hit, nopr = [], 0, 0
    for c in cards:
        s = sets[c["setId"]]
        gid = mapping.get(c["setId"])
        num = norm_number(c["number"])
        matched = prod_by_group_num.get((gid, num), []) if gid else []
        # prefer the plain print over error/variant products of the same number
        matched = sorted(matched, key=lambda p: (len(p["name"]), p["productId"]))
        pid = matched[0]["productId"] if matched else None
        pdata = prices.get(pid) if pid else None
        if pid:
            hit += 1
        if not pdata:
            nopr += 1
        out.append({
            "id": c["id"],
            "name": c["name"],
            "number": c["number"],
            "rarity": c["rarity"],
            "supertype": c["supertype"],
            "artist": c["artist"],
            "setId": c["setId"],
            "setName": s["name"],
            "series": s.get("series"),
            "printedTotal": s.get("printedTotal"),
            "releaseDate": s.get("releaseDate"),
            "setSymbol": (s.get("images") or {}).get("symbol"),
            "image": f"https://images.pokemontcg.io/{c['setId']}/{c['number']}.png",
            "imageHires": f"https://images.pokemontcg.io/{c['setId']}/{c['number']}_hires.png",
            "tcgplayerProductId": pid,
            "tcgplayerUrl": matched[0]["url"] if matched else None,
            "prices": pdata,
        })

    print(f"  {hit}/{len(cards)} cards matched a TCGplayer product "
          f"({hit/len(cards)*100:.1f}%)")
    print(f"  {len(cards)-nopr}/{len(cards)} cards have live prices "
          f"({(len(cards)-nopr)/len(cards)*100:.1f}%)")

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, "catalogue.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    with open(os.path.join(DATA, "set_match_report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    size = os.path.getsize(os.path.join(DATA, "catalogue.json")) / 1e6
    print(f"\nwrote data/catalogue.json ({size:.1f} MB, {len(out)} cards)")


if __name__ == "__main__":
    sys.exit(main())
