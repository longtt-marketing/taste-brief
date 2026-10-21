"""Analysis exactly as pre-registered (docs/podcast-check/PREREGISTRATION.md). Reads .results/podcast, writes
docs/podcast-check/results.json (scores, labels and AUCs per brand; no raw Qloo responses).

Usage: python scripts/podcast/analyze.py
"""
import json, os, random
from statistics import mean, median

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
M = json.load(open(os.path.join(D, "heldout-mentions.json"), encoding="utf-8"))
shows, brands, batches, scores = S["shows"], S["brands"], S["batches"], S["scores"]
batch_of = {sid: bi for bi, b in enumerate(batches) for sid in b}
carries = lambda show, b: M.get(show, {}).get(b, 0) >= 2


def auc(sc, lab):
    pos = [s for s, l in zip(sc, lab) if l]; neg = [s for s, l in zip(sc, lab) if not l]
    if not pos or not neg:
        return None
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))


def ranks(v):
    o = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(o):  # average ranks for ties
        j = i
        while j + 1 < len(o) and v[o[j + 1]] == v[o[i]]:
            j += 1
        for k in range(i, j + 1):
            r[o[k]] = (i + j) / 2
        i = j + 1
    return r


def qloo_pct(bname):
    """Percentile of Qloo affinity within each fixed batch; unscored shows get the lowest percentile."""
    out = {}
    for bi, ids in enumerate(batches):
        vals = [(scores[bname].get(i) or {}).get("affinity") for i in ids]
        vals = [v if v is not None else -1.0 for v in vals]
        r = ranks(vals); n = max(len(ids) - 1, 1)
        for i, x in zip(ids, r):
            out[i] = x / n
    return out


rows = []
for b in brands:
    bn = b["name"]
    lab = [carries(s["name"], bn) for s in shows]
    if sum(lab) < 3:
        continue
    pct = qloo_pct(bn)
    q = [pct[s["id"]] for s in shows]
    chart = [-s["rank"] for s in shows]
    pop = [s.get("popularity") or 0 for s in shows]
    vol = [sum(1 for bb, n in M.get(s["name"], {}).items() if n >= 2 and bb != bn) for s in shows]
    comb = [a + c for a, c in zip(ranks(q), ranks(vol))]
    aff = [(scores[bn].get(s["id"]) or {}).get("affinity") for s in shows]
    spread = [x for x in aff if x is not None]
    iqr = (sorted(spread)[int(0.75 * (len(spread) - 1))] - sorted(spread)[int(0.25 * (len(spread) - 1))]) if len(spread) >= 4 else 0
    rows.append({"brand": bn, "positives": sum(lab), "qloo": auc(q, lab), "chart": auc(chart, lab), "popularity": auc(pop, lab),
                 "ad_volume": auc(vol, lab), "qloo_plus_volume": auc(comb, lab), "qloo_iqr": iqr})

random.seed(20261021)


def boot(f, n=10000):
    v = sorted(mean(f(r) for r in random.choices(rows, k=len(rows))) for _ in range(n))
    return [round(v[int(0.025 * n)], 4), round(v[int(0.975 * n)], 4)]


from math import comb as C
above = sum(r["qloo"] > 0.5 for r in rows); ties = sum(r["qloo"] == 0.5 for r in rows); nn = len(rows) - ties
p_sign = sum(C(nn, k) for k in range(above, nn + 1)) / 2 ** nn if nn else 1.0
med = median(r["qloo_iqr"] for r in rows) if rows else 0
hi = [r["qloo"] for r in rows if r["qloo_iqr"] > med]; lo = [r["qloo"] for r in rows if r["qloo_iqr"] <= med]
res = {
    "shows": len(shows), "brands": len(rows), "mean_auc": {k: round(mean(r[k] for r in rows), 4) for k in ["qloo", "chart", "popularity", "ad_volume", "qloo_plus_volume"]},
    "H1": {"qloo_above_half": above, "of": len(rows), "sign_test_p": round(p_sign, 5), "ci95_mean_qloo": boot(lambda r: r["qloo"])},
    "H2": {"qloo_minus_chart_ci95": boot(lambda r: r["qloo"] - r["chart"]), "qloo_minus_popularity_ci95": boot(lambda r: r["qloo"] - r["popularity"])},
    "H3": {"combined_minus_volume_ci95": boot(lambda r: r["qloo_plus_volume"] - r["ad_volume"])},
    "H4_exploratory": {"median_iqr": round(med, 4), "mean_auc_high_spread": round(mean(hi), 4) if hi else None, "mean_auc_low_spread": round(mean(lo), 4) if lo else None},
    "rows": sorted(rows, key=lambda r: -r["qloo"]),
}
res["passed"] = {"H1": res["H1"]["sign_test_p"] < 0.05 and res["H1"]["ci95_mean_qloo"][0] > 0.5,
                 "H2": res["H2"]["qloo_minus_chart_ci95"][0] > 0 and res["H2"]["qloo_minus_popularity_ci95"][0] > 0,
                 "H3": res["H3"]["combined_minus_volume_ci95"][0] > 0}
# leakage check: rank a brand's shows with its direct competitor's Qloo audience (pairs fixed in advance)
PAIRS = [["DraftKings", "FanDuel"], ["BetterHelp", "Talkspace"], ["HelloFresh", "Factor"], ["Mint Mobile", "Visible"], ["NordVPN", "ExpressVPN"], ["Eight Sleep", "Helix Sleep"]]
have = {b["name"] for b in brands}
leak = []
for x, y in PAIRS:
    for tgt, src in ((x, y), (y, x)):
        if tgt not in have or src not in have:
            continue
        lab = [carries(s["name"], tgt) for s in shows]
        if sum(lab) < 3:
            continue
        own, other = qloo_pct(tgt), qloo_pct(src)
        leak.append({"brand": tgt, "predicted_from": src, "positives": sum(lab), "own_auc": auc([own[s["id"]] for s in shows], lab), "competitor_auc": auc([other[s["id"]] for s in shows], lab)})
res["leakage_check"] = leak
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "results.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))
