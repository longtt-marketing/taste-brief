"""Exploratory robustness checks for the podcast sponsorship test, added after two independent audits on 21 Oct 2026
(not pre-registered; reported as such). Same data, labels and Qloo percentiles as analyze.py. Writes
docs/podcast-check/robustness.json.

- two-way bootstrap: resamples brands AND shows, since the same shows are reused for every brand (the pre-registered
  intervals resample brands only, so they are narrower)
- brand specificity: each brand's own Qloo score against the average of the other brands' Qloo scores on the same shows
  (does Qloo pick this brand's shows, or just shows that every brand likes?)
- within genre: positive and negative shows compared inside the same Apple genre only, pooled and per genre
- symmetric selection: only shows carrying 3 or more OTHER brands, so ad volume is measured fairly
- genre prior: the brand's carry rate in the show's genre (cross-fitted, shrunk); its shrinkage flattens it for brands
  with few positives, so the fair comparison is the group with 10 or more
- precision at 10: expected sponsored shows in each ranking's top 10, ties split evenly

Usage: python scripts/podcast/robustness.py
"""
import json, os, random
from math import comb
from statistics import mean
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
B_ITER = 2000


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


def wauc(score, lab, w=None):
    """AUC of score for lab (positives above negatives, ties half), with optional show weights (bootstrap counts)."""
    score, lab = np.asarray(score, float), np.asarray(lab, bool)
    w = np.ones(len(score)) if w is None else w
    _, g = np.unique(score, return_inverse=True)
    pw = np.bincount(g, weights=w * lab, minlength=g.max() + 1)
    nw = np.bincount(g, weights=w * ~lab, minlength=g.max() + 1)
    den = pw.sum() * nw.sum()
    if den == 0:
        return np.nan
    below = np.cumsum(nw) - nw
    return float((pw * (below + 0.5 * nw)).sum() / den)


def p_at_10(score, lab):
    """Expected positives in the top 10 when ties at the cut are broken at random."""
    score, lab = np.asarray(score, float), np.asarray(lab, bool)
    out, left = 0.0, 10
    for v in sorted(set(score.tolist()), reverse=True):
        m = score == v
        k = int(m.sum())
        if k <= left:
            out += lab[m].sum(); left -= k
        else:
            out += left * lab[m].mean(); left = 0
        if not left:
            break
    return out


def run(strict):
    M = json.load(open(os.path.join(D, "heldout-mentions-strict.json" if strict else "heldout-mentions.json"), encoding="utf-8"))
    shows = [s for s in S["shows"] if (not strict) or sum(n >= 2 for n in M.get(s["name"], {}).values()) >= 3]
    ids = {s["id"] for s in shows}
    batches = [[i for i in b if i in ids] for b in S["batches"]]
    carries = lambda show, b: M.get(show, {}).get(b, 0) >= 2
    scorable = [b["name"] for b in S["brands"] if any((v or {}).get("affinity") is not None for v in S["scores"][b["name"]].values())]
    unscorable = [b["name"] for b in S["brands"] if b["name"] not in scorable]

    def pct(bn):
        out = {}
        for ids_ in batches:
            vals = [((S["scores"][bn].get(i) or {}).get("affinity")) for i in ids_]
            r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(ids_) - 1, 1)
            out.update({i: x / n for i, x in zip(ids_, r)})
        return out

    P = {b: pct(b) for b in scorable}
    Q = {b: np.array([P[b][s["id"]] for s in shows]) for b in scorable}
    allq = np.array([Q[b] for b in scorable])
    chart = np.array([-s["rank"] for s in shows], float)
    genre = np.array([s["genre"] for s in shows])
    genres = sorted(set(genre.tolist()))
    test = [b for b in scorable if sum(carries(s["name"], b) for s in shows) >= 3]

    rows, per_genre = [], {g: {"qloo": [0.0, 0.0], "chart": [0.0, 0.0]} for g in genres}
    random.seed(5)
    fold = np.array([random.randrange(5) for _ in shows])
    for b in test:
        lab = np.array([carries(s["name"], b) for s in shows])
        q = Q[b]
        others = np.array([sum(1 for bb, n in M.get(s["name"], {}).items() if n >= 2 and bb != b) for s in shows], float)
        generic = (allq.sum(0) - q) / (len(scorable) - 1)
        sym = others >= 3
        # within genre: pairs from the same genre only, pooled over genres (and kept per genre)
        w_q = w_c = t = 0.0
        for g in genres:
            m = genre == g
            if lab[m].any() and (~lab[m]).any():
                n_pairs = lab[m].sum() * (~lab[m]).sum()
                aq, ac = wauc(q[m], lab[m]), wauc(chart[m], lab[m])
                w_q += aq * n_pairs; w_c += ac * n_pairs; t += n_pairs
                per_genre[g]["qloo"][0] += aq * n_pairs; per_genre[g]["qloo"][1] += n_pairs
                per_genre[g]["chart"][0] += ac * n_pairs; per_genre[g]["chart"][1] += n_pairs
        # cross-fitted genre prior, shrunk toward the brand's overall rate
        prior = np.zeros(len(shows))
        for f in range(5):
            tr = fold != f
            allr = lab[tr].mean()
            for g in genres:
                same = tr & (genre == g)
                prior[(fold == f) & (genre == g)] = (lab[same].sum() + 5 * allr) / (same.sum() + 5)
        rows.append({"brand": b, "positives": int(lab.sum()), "qloo": wauc(q, lab), "chart": wauc(chart, lab), "ad_volume": wauc(others, lab),
                     "generic_qloo": wauc(generic, lab), "genre_prior": wauc(prior, lab),
                     "sym_qloo": wauc(q[sym], lab[sym]), "sym_ad_volume": wauc(others[sym], lab[sym]),
                     "within_genre_qloo": w_q / t if t else None, "within_genre_chart": w_c / t if t else None,
                     "p10_qloo": p_at_10(q, lab), "p10_chart": p_at_10(chart, lab), "p10_ad_volume": p_at_10(others, lab),
                     "p10_random": 10 * lab.mean()})
        rows[-1]["_lab"], rows[-1]["_q"], rows[-1]["_c"], rows[-1]["_g"] = lab, q, chart, generic

    m = lambda k, rs=rows: round(float(np.nanmean([r[k] for r in rs if r[k] is not None])), 4)
    # two-way bootstrap: resample shows (as weights) and brands, same draws for every statistic
    rng = np.random.default_rng(20261021)
    stats = {"qloo": [], "chart": [], "qloo_minus_chart": [], "qloo_minus_generic": []}
    for _ in range(B_ITER):
        w = rng.multinomial(len(shows), np.ones(len(shows)) / len(shows)).astype(float)
        pick = rng.integers(0, len(rows), len(rows))
        aq = np.array([wauc(r["_q"], r["_lab"], w) for r in rows])
        ac = np.array([wauc(r["_c"], r["_lab"], w) for r in rows])
        ag = np.array([wauc(r["_g"], r["_lab"], w) for r in rows])
        stats["qloo"].append(np.nanmean(aq[pick])); stats["chart"].append(np.nanmean(ac[pick]))
        stats["qloo_minus_chart"].append(np.nanmean((aq - ac)[pick])); stats["qloo_minus_generic"].append(np.nanmean((aq - ag)[pick]))
    ci = {k: [round(float(np.percentile(v, 2.5)), 4), round(float(np.percentile(v, 97.5)), 4)] for k, v in stats.items()}
    # brand permutation: how often does a brand's own score beat a random other brand's score on its labels?
    own_beats = []
    for r in rows:
        other_aucs = [wauc(Q[o], r["_lab"]) for o in scorable if o != r["brand"]]
        own_beats.append(float(np.mean([r["qloo"] > a for a in other_aucs])))
    big = [r for r in rows if r["positives"] >= 10]
    small = [r for r in rows if r["positives"] < 10]
    above = sum(r["qloo"] > 0.5 for r in rows); ties = sum(r["qloo"] == 0.5 for r in rows); nn = len(rows) - ties
    p_sign = sum(comb(nn, k) for k in range(above, nn + 1)) / 2 ** nn
    out_rows = [{k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items() if not k.startswith("_")} for r in rows]
    return {
        "labels": "strict (deviation 1)" if strict else "pre-registered", "shows": len(shows), "brands": len(rows),
        "unscorable_brands_excluded": unscorable,
        "mean_auc": {k: m(k) for k in ["qloo", "chart", "ad_volume", "generic_qloo", "genre_prior"]},
        "two_way_bootstrap_ci95": ci,
        "sign_test_p": f"{p_sign:.2e}", "qloo_above_half": f"{above} of {nn}",
        "brand_specificity": {"own_qloo": m("qloo"), "average_of_other_brands_qloo": m("generic_qloo"),
                              "own_beats_average_for": f"{sum(r['qloo'] > r['generic_qloo'] for r in rows)} of {len(rows)} brands",
                              "own_beats_share_of_other_brands": round(float(np.mean(own_beats)), 3),
                              "ci95_own_minus_average": ci["qloo_minus_generic"]},
        "symmetric_selection": {"qloo": m("sym_qloo"), "ad_volume": m("sym_ad_volume"), "note": "only shows carrying >= 3 other brands"},
        "within_genre": {"qloo": m("within_genre_qloo"), "chart": m("within_genre_chart"),
                         "per_genre": {g: {"qloo": round(v["qloo"][0] / v["qloo"][1], 3), "chart": round(v["chart"][0] / v["chart"][1], 3), "pairs": int(v["qloo"][1])}
                                       for g, v in per_genre.items() if v["qloo"][1]}},
        "genre_prior_by_positives": {"10_or_more": {"n": len(big), "qloo": m("qloo", big), "genre_prior": m("genre_prior", big), "chart": m("chart", big), "ad_volume": m("ad_volume", big)},
                                     "3_to_9": {"n": len(small), "qloo": m("qloo", small), "genre_prior": m("genre_prior", small)},
                                     "note": "the prior is shrunk toward the brand's overall rate, which flattens it for brands with few positives; compare on 10 or more"},
        "precision_at_10_expected": {"qloo": m("p10_qloo"), "chart": m("p10_chart"), "ad_volume": m("p10_ad_volume"), "random": m("p10_random")},
        "rows": out_rows,
    }


res = {"note": "Exploratory, added after two independent audits on 21 Oct 2026; not part of the pre-registration.",
       "pre_registered": run(False), "strict": run(True)}
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "robustness.json"), "w", encoding="utf-8"), indent=1)
for k in ["pre_registered", "strict"]:
    print(k, json.dumps({x: y for x, y in res[k].items() if x != "rows"}, indent=1))
