"""Resumable card-image downloader.

The CDN throttles hard after a few thousand requests: the first 6k arrived at
~44/s, then throughput collapsed to zero with worker threads wedged inside
urlopen. This version is built for that reality - modest concurrency, a hard
per-request timeout, permanent 404s recorded rather than retried, and a
progress file so re-running picks up exactly where it stopped.

Run it as many times as needed; it only fetches what is still missing.
"""
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
IMG = os.path.join(DATA, "images")
DEAD = os.path.join(DATA, "dead_urls.json")
os.makedirs(IMG, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (BulkSift build)"}

WORKERS = 8
TIMEOUT = 20
RETRIES = 3

_lock = threading.Lock()
_state = {"ok": 0, "dead": 0, "fail": 0, "t0": time.time()}


def safe_name(card_id):
    return "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in card_id) + ".png"


def load_dead():
    if os.path.exists(DEAD):
        with open(DEAD) as f:
            return set(json.load(f))
    return set()


def fetch(card, dead):
    path = os.path.join(IMG, safe_name(card["id"]))
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return "cached"
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(card["image"], headers=UA)
            blob = urllib.request.urlopen(req, timeout=TIMEOUT).read()
            if len(blob) < 2000:
                raise ValueError("truncated")
            tmp = path + ".part"
            with open(tmp, "wb") as f:
                f.write(blob)
            os.replace(tmp, path)
            with _lock:
                _state["ok"] += 1
            return "ok"
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                with _lock:
                    dead.add(card["id"])
                    _state["dead"] += 1
                return "dead"           # permanent, never retry
            time.sleep(0.5 * (attempt + 1))
        except Exception:
            time.sleep(0.5 * (attempt + 1))
    with _lock:
        _state["fail"] += 1
    return "fail"


def main():
    cat = json.load(open(os.path.join(DATA, "catalogue.json"), encoding="utf-8"))
    dead = load_dead()
    todo = []
    have = 0
    for c in cat:
        p = os.path.join(IMG, safe_name(c["id"]))
        if os.path.exists(p) and os.path.getsize(p) > 2000:
            have += 1
        elif c["id"] not in dead:
            todo.append(c)

    print(f"{len(cat)} cards | {have} cached | {len(dead)} known-dead | {len(todo)} to fetch",
          flush=True)
    if not todo:
        print("nothing to do", flush=True)
        return 0

    last_report = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for n, _ in enumerate(ex.map(lambda c: fetch(c, dead), todo), 1):
            if time.time() - last_report > 20:
                el = time.time() - _state["t0"]
                rate = _state["ok"] / max(el, 1e-9)
                left = (len(todo) - n) / max(rate, 1e-6)
                print(f"  {n}/{len(todo)}  ok={_state['ok']} dead={_state['dead']} "
                      f"fail={_state['fail']}  {rate:.1f}/s  eta {left/60:.0f} min",
                      flush=True)
                last_report = time.time()
                with open(DEAD, "w") as f:
                    json.dump(sorted(dead), f)

    with open(DEAD, "w") as f:
        json.dump(sorted(dead), f)
    total = len([1 for c in cat
                 if os.path.exists(os.path.join(IMG, safe_name(c["id"])))])
    print(f"done: {total}/{len(cat)} images on disk, {len(dead)} dead urls, "
          f"{_state['fail']} still failing", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
