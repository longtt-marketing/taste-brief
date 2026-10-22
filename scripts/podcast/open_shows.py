"""Exploratory open-shows check (not pre-registered, added 22 Oct 2026). The question a buyer asks: among shows where
no brand in my category has advertised yet, can Qloo tell me where my category goes next, so I can buy first?

For each scored brand, a show is OPEN when none of the brand's category (docs/podcast-check/categories.json, the brand
included) has a strict sponsor read in the show's older episodes (all but the 10 newest; show has at least 20 episodes).
An open show is TAKEN NEXT when a brand of that category is read in at least 2 of its 10 newest episodes. Among open
shows, each ranking is scored by AUC (taken next above not taken), per brand, then averaged over brands with at least
2 taken-next shows; 95% CI by resampling brands. Rankings: Qloo's affinity for the brand (batch percentile), Apple's
chart rank, ad volume (distinct advertisers read in at least 2 older episodes) and Qloo plus ad volume (rank sum, the
order the app uses). Same feeds, strict rule and Qloo scores as the strict analysis.

Usage: python scripts/podcast/open_shows.py   (writes docs/podcast-check/open-shows.json)
       python scripts/podcast/open_shows.py NEW_K MIN_EPS MIN_POS   (sensitivity run, prints only)
"""
import json, os, random, re
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
import sys
NEW_K, MIN_EPS, MIN_POS = (int(x) for x in (sys.argv[1:4] if len(sys.argv) > 3 else (10, 20, 2)))
OUT = len(sys.argv) <= 3  # only the default settings write the file
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
W = re.compile(r"[a-z0-9]")
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
pats = {b: re.compile(p) for b, p in brands.items()}
cats = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "categories.json"), encoding="utf-8"))["categories"]
cat_of = {b: c for c, bs in cats.items() for b in bs}
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
names = {s["name"] for s in S["shows"]}

# episodes (0 = newest) with a strict read, per show and brand
pos, neps = {}, {}
for f in json.load(open(os.path.join(D, "heldout-feeds.json"), encoding="utf-8")):
    if f["name"] not in names:
        continue
    neps[f["name"]] = len(f["texts"])
    d = {}
    for b, p in pats.items():
        for i, t in enumerate(f["texts"]):
            if any(whole(t, m) and CUE.search(t[max(0, m.start() - 150): m.end() + 150]) for m in p.finditer(t)):
                d.setdefault(b, []).append(i)
    pos[f["name"]] = d
shows = [s for s in S["shows"] if neps.get(s["name"], 0) >= MIN_EPS]
ids = {s["id"] for s in shows}
batches = [[i for i in b if i in ids] for b in S["batches"]]
volume = {s["id"]: sum(1 for b, e in pos[s["name"]].items() if sum(i >= NEW_K for i in e) >= 2) for s in shows}


def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(o):
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
            j += 1
        for k in range(i, j + 1):
            r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def pct(bn):
    out = {}
    for b in batches:
        vals = [((S["scores"][bn].get(i) or {}).get("affinity")) for i in b]
        r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(b) - 1, 1)
        out.update({i: x / n for i, x in zip(b, r)})
    return out


def auc(pos_sc, neg_sc):
    t = len(pos_sc) * len(neg_sc)
    return sum((p > n) + 0.5 * (p == n) for p in pos_sc for n in neg_sc) / t if t else None


rows = []
for b in S["brands"]:
    bn = b["name"]
    if not any((v or {}).get("affinity") is not None for v in S["scores"][bn].values()):
        continue
    rivals = set(cats[cat_of[bn]])
    p = pct(bn)
    open_ = [s for s in shows if not any(i >= NEW_K for r in rivals for i in pos[s["name"]].get(r, []))]
    taken = {s["id"] for s in open_ if any(sum(i < NEW_K for i in pos[s["name"]].get(r, [])) >= 2 for r in rivals)}
    if len(taken) < MIN_POS or len(open_) - len(taken) < MIN_POS:
        continue
    sc = {
        "qloo": {s["id"]: p[s["id"]] for s in open_},
        "chart": {s["id"]: -s["rank"] for s in open_},
        "ad_volume": {s["id"]: volume[s["id"]] for s in open_},
    }
    ordr = [s["id"] for s in open_]
    rq, rv = ranks([sc["qloo"][i] for i in ordr]), ranks([sc["ad_volume"][i] for i in ordr])
    sc["qloo_plus_ad_volume"] = {i: a + v for i, a, v in zip(ordr, rq, rv)}
    row = {"brand": bn, "category": cat_of[bn], "open": len(open_), "taken_next": len(taken)}
    for k, m in sc.items():
        row[k] = round(auc([m[i] for i in ordr if i in taken], [m[i] for i in ordr if i not in taken]), 4)
    # top 10 of the open shows by each ranking: how many were taken next
    for k, m in sc.items():
        row[f"top10_{k}"] = sum(1 for i in sorted(ordr, key=lambda i: -m[i])[:10] if i in taken)
    rows.append(row)

random.seed(20261022)
KEYS = ["qloo", "chart", "ad_volume", "qloo_plus_ad_volume"]


def ci(k, n=2000):
    out = sorted(mean(r[k] for r in random.choices(rows, k=len(rows))) for _ in range(n))
    return [round(out[int(.025 * n)], 4), round(out[int(.975 * n)], 4)]


def ci_diff(a, b, n=2000):
    out = sorted(mean(r[a] - r[b] for r in random.choices(rows, k=len(rows))) for _ in range(n))
    return [round(out[int(.025 * n)], 4), round(out[int(.975 * n)], 4)]


# Brands of one category share the same open shows and the same moves, so they are not independent: the headline is
# per category (mean of its brands' AUC), resampled by category. Found by the independent review of 22 Oct.
bycat = {}
for r in rows:
    bycat.setdefault(r["category"], []).append(r)
cats_rows = [{"category": c, "brands": len(rs), "moves": rs[0]["taken_next"], "open": rs[0]["open"],
              **{k: round(mean(r[k] for r in rs), 4) for k in KEYS}} for c, rs in sorted(bycat.items())]


def ci_cat(k, n=2000):
    out = sorted(mean(r[k] for r in random.choices(cats_rows, k=len(cats_rows))) for _ in range(n))
    return [round(out[int(.025 * n)], 4), round(out[int(.975 * n)], 4)]


by_category = {
    "categories": len(cats_rows), "moves": sum(r["moves"] for r in cats_rows),
    "auc": {k: round(mean(r[k] for r in cats_rows), 4) for k in KEYS},
    "auc_ci95": {k: ci_cat(k) for k in KEYS},
    "qloo_above_half": sum(r["qloo"] > 0.5 for r in cats_rows),
    "qloo_above_chart": sum(r["qloo"] > r["chart"] for r in cats_rows),
    "without_apparel": {k: round(mean(r[k] for r in cats_rows if r["category"] != "apparel"), 4) for k in KEYS},
    "rows": cats_rows,
}

res = {
    "note": __doc__.split("Usage:")[0].strip(),
    "by_category": by_category,
    "shows": len(shows), "brands": len(rows),
    "open_shows_mean": round(mean(r["open"] for r in rows), 1), "taken_next_total": sum(r["taken_next"] for r in rows),
    "auc": {k: round(mean(r[k] for r in rows), 4) for k in KEYS},
    "auc_ci95": {k: ci(k) for k in KEYS},
    "diff_ci95": {"qloo_minus_chart": ci_diff("qloo", "chart"), "qloo_minus_ad_volume": ci_diff("qloo", "ad_volume"),
                  "combined_minus_ad_volume": ci_diff("qloo_plus_ad_volume", "ad_volume")},
    "top10_mean": {k: round(mean(r[f"top10_{k}"] for r in rows), 2) for k in KEYS},
    "rows": rows,
}
if OUT:
    json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "open-shows.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k not in ("rows", "note")}, indent=1))
