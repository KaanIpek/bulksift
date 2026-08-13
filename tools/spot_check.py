"""Sanity-check the joined catalogue against prices a collector would recognise."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cat = json.load(open(os.path.join(ROOT, "data", "catalogue.json"), encoding="utf-8"))
by = {c["id"]: c for c in cat}

print("known cards:")
for cid in ["base1-4", "base4-4", "base1-58", "base2-22", "base4-27",
            "sv3pt5-199", "sv8-1", "swsh4-188"]:
    c = by.get(cid)
    if not c:
        print(f"  {cid:14s} NOT FOUND")
        continue
    pr = c.get("prices") or {}
    s = ", ".join(f"{k}=${v['market']}" for k, v in pr.items() if v.get("market"))
    print(f"  {cid:14s} {c['name'][:20]:20s} {c['setName'][:24]:24s} "
          f"#{str(c['number']):>6s}  {s or 'NO PRICE'}")

vals = []
for c in cat:
    pr = c.get("prices") or {}
    m = [v["market"] for v in pr.values() if v.get("market")]
    if m:
        vals.append((max(m), c))
vals.sort(key=lambda t: -t[0])

print("\nmost valuable cards in the catalogue:")
for p, c in vals[:10]:
    print(f"  ${p:>10,.2f}  {c['id']:14s} {c['name'][:24]:24s} {c['setName'][:30]}")

print(f"\ncards with a market price: {len(vals)}/{len(cat)} "
      f"({len(vals)/len(cat)*100:.1f}%)")
no_price = [c for c in cat if not (c.get("prices") or {})]
print(f"without price: {len(no_price)}  e.g. "
      f"{[c['id'] for c in no_price[:6]]}")
