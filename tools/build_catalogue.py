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
UA = {"User-Agent": "Mozilla/5.0"}

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
            # tcgcsv throttles by answering 401, and a short wait does not
            # outlast it: on 2026-11-24 a rebuild after several price runs lost
            # 20-odd sets this way, Base Set among them.
            time.sleep(3.0 * (2 ** i))
    raise RuntimeError(f"failed {url}: {last}")


# Groups served from an out-of-date cache file because the feed refused them.
STALE = []


def fetch_json(url, cache_name=None, max_age=6 * 3600):
    p = os.path.join(CACHE, cache_name) if cache_name else None
    if p and os.path.exists(p) and time.time() - os.path.getmtime(p) < max_age:
        with open(p, "rb") as f:
            return json.loads(f.read())
    try:
        blob = fetch(url)
    except Exception:
        # An old copy of a set's product list is nearly always still right;
        # no copy at all removes the set from the app. Use the old one and say
        # so. With nothing cached the error stands, and the caller stops.
        if p and os.path.exists(p):
            STALE.append(cache_name)
            with open(p, "rb") as f:
                return json.loads(f.read())
        raise
    time.sleep(0.4)
    if p:
        with open(p, "wb") as f:
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
            # This used to print and carry on, and the catalogue it then wrote
            # was simply missing the set: every card in it unknown to the app,
            # with one line in a log to show for it. A catalogue is all the
            # sets or it is not written.
            raise SystemExit(
                f"group {gid} {g['name']}: {e}\n"
                f"Nothing was written. The feed is probably throttling; "
                f"wait and run it again - what was fetched is cached.")
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
    if STALE:
        print(f"  {len(STALE)} files came from an out-of-date cache because the "
              f"feed refused them: {', '.join(STALE[:8])}"
              f"{' ...' if len(STALE) > 8 else ''}")
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



# Sets that exist on TCGplayer and nowhere in pokemon-tcg-data.
#
# The primary catalogue is 174 sets and does not know the First Partner Pack at
# all - so the app could not fail to recognise those cards, it had never heard
# of them. That is a different bug from a hard-to-read card and it looks
# different in use: not "sometimes wrong" but "nothing, ever".
#
# These are jumbo promos, which is presumably why the community dataset skips
# them. They scan like any other card: the oversize is 5x7 inches, the same 5:7
# the detector already expects, so only the catalogue entry was missing.
#
# Keyed by TCGplayer groupId, valued by the synthetic set this becomes.
TCGPLAYER_ONLY_SETS = {
    # Promos and side products the community dataset has never carried. Audited
    # by comparing every TCGplayer group against the catalogue: 43 groups had
    # zero coverage and 7,915 cards were simply unknown to the app, which is a
    # quarter of everything for sale. Somebody scanning a promo binder got
    # nothing, forever, and no error explaining why.
    2776: {"id": "fpp", "name": "First Partner Pack", "release": "2021/10/08"},
    2282: {"id": "wcd", "name": "World Championship Decks", "release": "2004/01/01"},
    22880: {"id": "pps", "name": "Prize Pack Series", "release": "2022/07/01"},
    1539: {"id": "lcc", "name": "League & Championship Cards", "release": "2010/01/01"},
    1840: {"id": "dex", "name": "Deck Exclusives", "release": "2010/01/01"},
    1528: {"id": "jmb", "name": "Jumbo Cards", "release": "2000/01/01"},
    1863: {"id": "smb", "name": "SM Base Set", "release": "2017/02/03"},
    2289: {"id": "ble", "name": "Blister Exclusives", "release": "2010/01/01"},
    24451: {"id": "mep", "name": "ME: Mega Evolution Promo", "release": "2026/01/01"},
    23323: {"id": "tcc", "name": "Trading Card Game Classic", "release": "2023/11/17"},
    1663: {"id": "bss", "name": "Base Set (Shadowless)", "release": "1999/01/09"},
    23520: {"id": "ba24", "name": "Battle Academy 2024", "release": "2024/01/01"},
    3051: {"id": "ba22", "name": "Battle Academy 2022", "release": "2022/01/01"},
    2686: {"id": "ba20", "name": "Battle Academy", "release": "2020/01/01"},
    1418: {"id": "wotcp", "name": "WoTC Promo", "release": "1999/01/01"},
    1421: {"id": "dpp", "name": "Diamond and Pearl Promos", "release": "2007/01/01"},
    2332: {"id": "ppp", "name": "Professor Program Promos", "release": "2010/01/01"},
    1938: {"id": "aap", "name": "Alternate Art Promos", "release": "2010/01/01"},
}


def clean_product_name(raw):
    """A TCGplayer product name reduced to the card's actual name.

    TCGplayer sells products, not cards, so it names them for a shelf:
    "Thundurus - 50/113 (BW Legendary Treasures)" or "Delphox - 013/086
    (Non-Holo)". Imported verbatim those read as DIFFERENT names from the plain
    "Thundurus" already in the catalogue - and the acceptance rule measures its
    margin to the nearest differently-named card, so a card ended up competing
    with itself and neither printing could clear the gate.

    Measured before this existed: 19 of 401 sampled cards sat under the gate,
    including 8 of 60 rainbow rares, and every single collision was a card
    against another printing of itself.

    Splitting on " - " is safe because that is TCGplayer's own separator and no
    Pokemon name contains a spaced hyphen; the hyphenated ones - Ho-Oh, Porygon-Z
    - have no spaces around it.
    """
    name = raw.split(" - ")[0].strip()
    # A parenthetical that survives is a variant marker, not part of the name.
    if name.endswith(")") and "(" in name:
        name = name[:name.rindex("(")].strip()
    return name or raw


def tcgplayer_only_cards(groups, products, prices):
    """Catalogue records for sets the primary source has never heard of.

    Emitted in exactly the shape the rest of the pipeline expects, so the
    existing steps do the rest: the pokemontcg.io image URL 404s, build_index
    lists the card in missing_images.json, and fallback_images fetches the
    TCGplayer product shot and trims it to the card. Nothing new to maintain.
    """
    by_id = {g["groupId"]: g for g in groups}
    out = []
    for gid, meta in TCGPLAYER_ONLY_SETS.items():
        if gid not in by_id:
            print(f"  WARNING: TCGplayer group {gid} not in the feed, skipping")
            continue
        made = 0
        for p in products.get(gid, []):
            # Sealed product and code cards carry no collector number; the
            # actual cards do, and that is the cleanest way to tell them apart.
            if not p.get("_number") or (p.get("_rarity") or "") == "Code Card":
                continue
            pid = p["productId"]
            cid = f'{meta["id"]}-{pid}'
            out.append({
                "id": cid,
                "name": clean_product_name(p["name"]),
                "number": p["_number"],
                "rarity": p.get("_rarity") or "Promo",
                "supertype": "Pokémon",
                "artist": None,
                "setId": meta["id"],
                "setName": meta["name"],
                "series": "Promo",
                "printedTotal": None,
                "releaseDate": meta["release"],
                "setSymbol": None,
                # Deliberately a URL that will not resolve: it puts the card in
                # missing_images.json, which is what routes it to the TCGplayer
                # fallback that does have the art.
                "image": f'https://images.pokemontcg.io/{meta["id"]}/{p["_number"]}.png',
                "imageHires": f'https://images.pokemontcg.io/{meta["id"]}/{p["_number"]}_hires.png',
                "tcgplayerProductId": pid,
                "tcgplayerUrl": p.get("url"),
                "prices": prices.get(pid),
            })
            made += 1
        print(f'  + {made} cards from TCGplayer group {gid} ({meta["name"]})')
    return out


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

    extra = tcgplayer_only_cards(groups, products, prices)
    out.extend(extra)

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
