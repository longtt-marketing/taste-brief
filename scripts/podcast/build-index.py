"""Advertiser index for the app's "Podcasts to sponsor first" panel: for every show we read (development and held-out
feeds), the dictionary brands its own episode notes advertise in at least 2 episodes, with the strict sponsor-cue rule
of deviation 1. Writes src/data/podcast-sponsors.json. Evidence only: the page orders podcasts by Qloo rank plus this ad-demand rank (public/rank.js).

Usage: python scripts/podcast/build-index.py <dev feeds.json> [held-out feeds.json]
"""
import datetime as dt, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
W = re.compile(r"[a-z0-9]")
brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
pats = {b: re.compile(p) for b, p in brands.items()}
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
files = sys.argv[1:] or [os.path.join(ROOT, ".results", "podcast", "heldout-feeds.json")]
shows = {}
for path in files:
    for f in json.load(open(path, encoding="utf-8")):
        carried = []
        for b, p in pats.items():
            n = 0
            for t in f["texts"]:
                if any(whole(t, m) and CUE.search(t[max(0, m.start() - 150): m.end() + 150]) for m in p.finditer(t)):
                    n += 1
            if n >= 2:
                carried.append((n, b))
        if carried:
            shows[f["name"]] = [b for n, b in sorted(carried, reverse=True)]
out = {"source": "sponsor reads in the public RSS episode notes of Apple US chart podcasts (docs/podcast-check)",
       "collected": dt.date.today().isoformat(), "shows": dict(sorted(shows.items()))}
json.dump(out, open(os.path.join(ROOT, "src", "data", "podcast-sponsors.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("shows with advertisers:", len(shows))
