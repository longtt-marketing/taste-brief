"""Exploratory recency check (not pre-registered), for the objection "Qloo's taste data may only echo past
sponsorships". Feeds keep episodes newest first (collect.py reads RSS items in order), so a brand whose strict sponsor
reads appear only in a show's 10 newest episodes, on a show with at least 20 episodes in the year, is a NEW placement:
a deal too recent to have shaped the audience data Qloo serves today. A brand also read in older episodes is
ESTABLISHED. For each brand, Qloo's batch percentile is compared between shows with a new placement and shows that never
carried the brand (AUC over those pairs); same for established placements and for the chart. Same shows, brands,
labels and scores as the strict analysis. Writes docs/podcast-check/recency.json.

Usage: python scripts/podcast/recency.py
"""
import json, os, random, re
from statistics import mean

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
NEW_K, MIN_EPS = 10, 20
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
W = re.compile(r"[a-z0-9]")
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
pats = {b: re.compile(p) for b, p in brands.items()}
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
M = json.load(open(os.path.join(D, "heldout-mentions-strict.json"), encoding="utf-8"))
shows = [s for s in S["shows"] if sum(n >= 2 for n in M.get(s["name"], {}).values()) >= 3]
names = {s["name"] for s in shows}

# episode positions of strict sponsor reads, per show and brand (same rule as strict.py, kept per episode)
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


ids = {s["id"] for s in shows}
batches = [[i for i in b if i in ids] for b in S["batches"]]


def pct(bn):
    out = {}
    for b in batches:
        vals = [((S["scores"][bn].get(i) or {}).get("affinity")) for i in b]
        r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(b) - 1, 1)
        out.update({i: x / n for i, x in zip(b, r)})
    return out


def pairs(pos_sc, neg_sc):
    return sum((p > n) + 0.5 * (p == n) for p in pos_sc for n in neg_sc), len(pos_sc) * len(neg_sc)


rows = []
for b in S["brands"]:
    bn = b["name"]
    if not any((v or {}).get("affinity") is not None for v in S["scores"][bn].values()):
        continue
    carries = [s for s in shows if len(pos[s["name"]].get(bn, [])) >= 2]
    if len(carries) < 3:  # same brand inclusion as the strict analysis
        continue
    p = pct(bn)
    never = [s for s in shows if not pos[s["name"]].get(bn)]
    new = [s for s in carries if neps[s["name"]] >= MIN_EPS and max(pos[s["name"]][bn]) < NEW_K]
    est = [s for s in carries if max(pos[s["name"]][bn]) >= NEW_K]
    row = {"brand": bn, "new": len(new), "established": len(est), "never": len(never)}
    for tag, grp in (("new", new), ("established", est)):
        for score, key in ((lambda s: p[s["id"]], "qloo"), (lambda s: -s["rank"], "chart")):
            w, t = pairs([score(s) for s in grp], [score(s) for s in never])
            row[f"{tag}_{key}_wins"], row[f"{tag}_{key}_pairs"] = w, t
    rows.append(row)


def pooled(rs, tag, key):
    rs = [r for r in rs if r[f"{tag}_{key}_pairs"]]
    return round(mean(r[f"{tag}_{key}_wins"] / r[f"{tag}_{key}_pairs"] for r in rs), 4) if rs else None


random.seed(20261022)


def ci(tag, key, n=2000):
    rs = [r for r in rows if r[f"{tag}_{key}_pairs"]]
    out = sorted(mean(r[f"{tag}_{key}_wins"] / r[f"{tag}_{key}_pairs"] for r in random.choices(rs, k=len(rs))) for _ in range(n))
    return [round(out[int(.025 * n)], 4), round(out[int(.975 * n)], 4)]


res = {
    "note": "Exploratory, not pre-registered (added 21 Oct 2026). Strict labels. A NEW placement: strict reads only in the "
            f"show's {NEW_K} newest episodes, show has at least {MIN_EPS} episodes in the year. ESTABLISHED: also read in "
            "older episodes. Negatives: shows that never carried the brand. Mean of per-brand AUC over brands with at least "
            "one placement of that kind; 95% CI by resampling brands.",
    "shows": len(shows),
    "new": {"placements": sum(r["new"] for r in rows), "brands": sum(1 for r in rows if r["new"]),
            "qloo": pooled(rows, "new", "qloo"), "qloo_ci95": ci("new", "qloo"), "chart": pooled(rows, "new", "chart")},
    "established": {"placements": sum(r["established"] for r in rows), "brands": sum(1 for r in rows if r["established"]),
                    "qloo": pooled(rows, "established", "qloo"), "qloo_ci95": ci("established", "qloo"),
                    "chart": pooled(rows, "established", "chart")},
    "rows": rows,
}
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "recency.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))
