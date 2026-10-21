"""Exploratory robustness checks for the podcast sponsorship test, added after an independent audit (not pre-registered;
reported as such). Same data and labels as analyze.py. Writes docs/podcast-check/robustness.json.

Usage: python scripts/podcast/robustness.py
"""
import json, os, random
from math import comb
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))


def auc(sc, lab):
    pos = [s for s, l in zip(sc, lab) if l]; neg = [s for s, l in zip(sc, lab) if not l]
    if not pos or not neg:
        return None
    return sum((p > n) + 0.5 * (p == n) for p in pos for n in neg) / (len(pos) * len(neg))


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


def run(strict):
    M = json.load(open(os.path.join(D, "heldout-mentions-strict.json" if strict else "heldout-mentions.json"), encoding="utf-8"))
    shows = [s for s in S["shows"] if (not strict) or sum(n >= 2 for n in M.get(s["name"], {}).values()) >= 3]
    ids = {s["id"] for s in shows}
    batches = [[i for i in b if i in ids] for b in S["batches"]]
    carries = lambda show, b: M.get(show, {}).get(b, 0) >= 2
    scorable = [b for b in S["brands"] if any((v or {}).get("affinity") is not None for v in S["scores"][b["name"]].values())]
    unscorable = [b["name"] for b in S["brands"] if b not in scorable]

    def pct(bn):
        out = {}
        for ids_ in batches:
            vals = [((S["scores"][bn].get(i) or {}).get("affinity")) for i in ids_]
            vals = [v if v is not None else -1.0 for v in vals]
            r = ranks(vals); n = max(len(ids_) - 1, 1)
            for i, x in zip(ids_, r):
                out[i] = x / n
        return out

    rows = []
    for b in scorable:
        bn = b["name"]
        lab = [carries(s["name"], bn) for s in shows]
        if sum(lab) < 3:
            continue
        p = pct(bn)
        q = [p[s["id"]] for s in shows]
        raw = [(S["scores"][bn].get(s["id"]) or {}).get("affinity") or 0 for s in shows]
        chart = [-s["rank"] for s in shows]
        others = [sum(1 for bb, n in M.get(s["name"], {}).items() if n >= 2 and bb != bn) for s in shows]
        # symmetric selection: only shows that carry >= 3 OTHER brands, so positives and negatives face the same bar
        sym = [i for i, s in enumerate(shows) if others[i] >= 3]
        # within genre: AUC over positive/negative pairs from the same Apple genre only
        def within(sc):
            w = t = 0.0
            for i, si in enumerate(shows):
                if not lab[i]:
                    continue
                for j, sj in enumerate(shows):
                    if lab[j] or si["genre"] != sj["genre"]:
                        continue
                    t += 1; w += (sc[i] > sc[j]) + 0.5 * (sc[i] == sc[j])
            return w / t if t else None
        # cross-fitted genre prior: 5 folds over shows; a show's score is the brand's carry rate in its genre among the
        # other folds (smoothed toward the overall rate)
        random.seed(5); fold = {s["id"]: random.randrange(5) for s in shows}
        g = []
        for i, s in enumerate(shows):
            tr = [k for k, x in enumerate(shows) if fold[x["id"]] != fold[s["id"]]]
            allr = sum(lab[k] for k in tr) / max(len(tr), 1)
            same = [k for k in tr if shows[k]["genre"] == s["genre"]]
            g.append((sum(lab[k] for k in same) + 5 * allr) / (len(same) + 5))
        top = lambda sc: sum(lab[i] for i in sorted(range(len(shows)), key=lambda i: -sc[i])[:10])
        rows.append({"brand": bn, "positives": sum(lab), "qloo": auc(q, lab), "chart": auc(chart, lab), "ad_volume": auc(others, lab),
                     "qloo_raw_affinity": auc(raw, lab),
                     "sym_qloo": auc([q[i] for i in sym], [lab[i] for i in sym]), "sym_ad_volume": auc([others[i] for i in sym], [lab[i] for i in sym]),
                     "within_genre_qloo": within(q), "within_genre_chart": within(chart), "genre_prior": auc(g, lab),
                     "p10_qloo": top(q), "p10_chart": top(chart), "p10_ad_volume": top(others), "p10_random": 10 * sum(lab) / len(shows)})
    m = lambda k, rs=rows: round(mean(r[k] for r in rs if r[k] is not None), 4)
    random.seed(20261022)
    # two-way bootstrap: resample brands and shows
    def twoway(key_a, key_b=None, n=2000):
        out = []
        for _ in range(n):
            bs = random.choices(rows, k=len(rows))
            out.append(mean(r[key_a] - (r[key_b] if key_b else 0) for r in bs))
        out.sort(); return [round(out[int(.025 * n)], 4), round(out[int(.975 * n)], 4)]
    big = [r for r in rows if r["positives"] >= 10]
    above = sum(r["qloo"] > 0.5 for r in rows); ties = sum(r["qloo"] == 0.5 for r in rows); nn = len(rows) - ties
    p_sign = sum(comb(nn, k) for k in range(above, nn + 1)) / 2 ** nn
    return {
        "labels": "strict (deviation 1)" if strict else "pre-registered", "shows": len(shows), "brands": len(rows),
        "unscorable_brands_excluded": unscorable,
        "mean_auc": {k: m(k) for k in ["qloo", "chart", "ad_volume", "qloo_raw_affinity", "genre_prior"]},
        "sign_test_p": f"{p_sign:.2e}", "qloo_above_half": f"{above} of {nn}",
        "symmetric_selection": {"qloo": m("sym_qloo"), "ad_volume": m("sym_ad_volume"), "note": "only shows carrying >= 3 other brands"},
        "within_genre": {"qloo": m("within_genre_qloo"), "chart": m("within_genre_chart")},
        "qloo_minus_genre_prior_ci95": twoway("qloo", "genre_prior"),
        "brands_with_10_plus_positives": {"n": len(big), "qloo": m("qloo", big), "chart": m("chart", big), "ad_volume": m("ad_volume", big), "genre_prior": m("genre_prior", big)},
        "positive_weighted_qloo": round(sum(r["qloo"] * r["positives"] for r in rows) / sum(r["positives"] for r in rows), 4),
        "precision_at_10_mean_carriers": {"qloo": m("p10_qloo"), "chart": m("p10_chart"), "ad_volume": m("p10_ad_volume"), "random": m("p10_random")},
        "rows": rows,
    }


res = {"note": "Exploratory, added after an independent audit on 22 Oct 2026; not part of the pre-registration.",
       "pre_registered": run(False), "strict": run(True)}
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "robustness.json"), "w", encoding="utf-8"), indent=1)
for k in ["pre_registered", "strict"]:
    print(k, json.dumps({x: y for x, y in res[k].items() if x != "rows"}))
