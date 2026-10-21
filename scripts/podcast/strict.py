"""Deviation 1 (docs/podcast-check/DEVIATION-1.md): strict sponsor labels. A dictionary match counts only as a whole
word with a sponsor cue within 150 characters. Writes .results/podcast/heldout-mentions-strict.json and a sample of 100
random strict matches for the second hand check.

Usage: python scripts/podcast/strict.py
"""
import json, os, random, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
pats = {b: re.compile(p) for b, p in brands.items()}
W = re.compile(r"[a-z0-9]")
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
feeds = json.load(open(os.path.join(D, "heldout-feeds.json"), encoding="utf-8"))
mentions, hits = {}, []
for f in feeds:
    d = {}
    for b, p in pats.items():
        n = 0
        for t in f["texts"]:
            for m in p.finditer(t):
                if whole(t, m) and CUE.search(t[max(0, m.start() - 150): m.end() + 150]):
                    n += 1
                    if n == 1:
                        hits.append({"show": f["name"], "brand": b, "snippet": t[max(0, m.start() - 120): m.end() + 120]})
                    break
        if n:
            d[b] = n
    mentions[f["name"]] = d
json.dump(mentions, open(os.path.join(D, "heldout-mentions-strict.json"), "w", encoding="utf-8"), indent=1)
random.seed(8)
sample = random.sample(hits, min(100, len(hits)))
json.dump([{"i": i, **h} for i, h in enumerate(sample)], open(os.path.join(D, "precision-sample-strict.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("strict matches", len(hits), "shows listing >=3:", sum(1 for d in mentions.values() if sum(n >= 2 for n in d.values()) >= 3))
