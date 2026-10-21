"""Exploratory reverse check (not pre-registered): for a SHOW, does Qloo rank the brands that sponsor it above the brands
that don't? This is the question a podcast's ad sales team asks ("which brands should we pitch?"). Same data, strict
labels and Qloo scores as the main test; for each show, a brand's score is how high the show ranks in that brand's Qloo
list (its batch percentile). Baselines: how many shows the brand sponsors in the sample (big spenders first, leaving this
show out) and the brand's carry rate in the show's genre (leaving this show out). AUC per show, averaged over shows with
3 or more sponsoring brands; 95% interval by resampling shows. Writes docs/podcast-check/reverse.json.

Usage: python scripts/podcast/reverse.py
"""
import json, os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
M = json.load(open(os.path.join(D, "heldout-mentions-strict.json"), encoding="utf-8"))


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


def auc(score, lab):
    score, lab = np.asarray(score, float), np.asarray(lab, bool)
    pos, neg = score[lab], score[~lab]
    if not len(pos) or not len(neg):
        return None
    return float(((pos[:, None] > neg[None, :]) + 0.5 * (pos[:, None] == neg[None, :])).mean())


shows = [s for s in S["shows"] if sum(n >= 2 for n in M.get(s["name"], {}).values()) >= 3]
ids = {s["id"] for s in shows}
batches = [[i for i in b if i in ids] for b in S["batches"]]
brands = [b["name"] for b in S["brands"] if any((v or {}).get("affinity") is not None for v in S["scores"][b["name"]].values())]
carries = lambda show, b: M.get(show, {}).get(b, 0) >= 2
brands = [b for b in brands if sum(carries(s["name"], b) for s in shows) >= 3]  # the main test's brand set
pct = {}
for b in brands:
    out = {}
    for ids_ in batches:
        vals = [((S["scores"][b].get(i) or {}).get("affinity")) for i in ids_]
        r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(ids_) - 1, 1)
        out.update({i: x / n for i, x in zip(ids_, r)})
    pct[b] = out
lab_all = {s["id"]: np.array([carries(s["name"], b) for b in brands]) for s in shows}
rows = []
for s in shows:
    lab = lab_all[s["id"]]
    if lab.sum() < 3 or (~lab).sum() < 3:
        continue
    others = [x for x in shows if x["id"] != s["id"]]
    spend = [sum(lab_all[x["id"]][k] for x in others) for k in range(len(brands))]
    same = [x for x in others if x["genre"] == s["genre"]]
    genre = [(sum(lab_all[x["id"]][k] for x in same) + 1) / (len(same) + 2) for k in range(len(brands))]
    q = [pct[b][s["id"]] for b in brands]
    rows.append({"show": s["name"], "genre": s["genre"], "sponsors": int(lab.sum()), "qloo": auc(q, lab),
                 "brand_spend": auc(spend, lab), "genre_rate": auc(genre, lab),
                 "qloo_plus_spend": auc(np.array(ranks(q)) + np.array(ranks(spend)), lab)})
m = lambda k: round(float(np.mean([r[k] for r in rows])), 4)
rng = np.random.default_rng(20261022)
def ci(k):
    v = np.array([r[k] for r in rows]); bs = [v[rng.integers(0, len(v), len(v))].mean() for _ in range(5000)]
    return [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]
d = np.array([r["qloo"] - r["brand_spend"] for r in rows]); bsd = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(5000)]
res = {"note": "Exploratory, not pre-registered (21 Oct 2026). Strict labels; per-show AUC over brands, mean over shows.",
       "shows": len(rows), "brands": len(brands),
       "mean_auc": {k: m(k) for k in ["qloo", "brand_spend", "genre_rate", "qloo_plus_spend"]},
       "qloo_ci95": ci("qloo"), "qloo_plus_spend_ci95": ci("qloo_plus_spend"),
       "qloo_minus_brand_spend_ci95": [round(float(np.percentile(bsd, 2.5)), 4), round(float(np.percentile(bsd, 97.5)), 4)],
       "rows": [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()} for r in rows]}
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "reverse.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))
