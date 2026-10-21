"""Exploratory label check that needs no reader (not pre-registered): a URL-CONFIRMED sponsorship is a strict sponsor
read (DEVIATION-1.md) whose episode notes also carry a web address built on the brand's own name, such as
drinklmnt.com/liz or eightsleep.com/podcast. A podcast lists the brand's own link when it is paid to read it; an editorial
mention rarely does. Same shows, Qloo scores and batches as the strict analysis; a show carries a brand when at least 2
episodes have a URL-confirmed read. Also reports how many strict carries are URL-confirmed.
Writes docs/podcast-check/confirmed.json.

Usage: python scripts/podcast/confirmed.py
"""
import json, os, re
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
W = re.compile(r"[a-z0-9]")
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
HOST = re.compile(r"\b((?:[a-z0-9-]+\.)*[a-z0-9-]+)\.(?:com|co|io|net|org|ca|us|co\.uk|app|tv)\b")
brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
pats = {b: re.compile(p) for b, p in brands.items()}


def tokens(name, pattern):
    """The brand's compact name, plus any plain alternative in its dictionary pattern (drinkag1, drinklmnt)."""
    out = {re.sub(r"[^a-z0-9]", "", name.lower())}
    for alt in pattern.split("|"):
        alt = alt.replace("\\b", "").replace(" ?", "").replace("\\.com", "")
        if re.fullmatch(r"[a-z0-9]{4,}", alt):
            out.add(alt)
    return {t for t in out if len(t) >= 4}


TOK = {b: tokens(b, p) for b, p in brands.items()}
S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
M = json.load(open(os.path.join(D, "heldout-mentions-strict.json"), encoding="utf-8"))
shows = [s for s in S["shows"] if sum(n >= 2 for n in M.get(s["name"], {}).values()) >= 3]
names = {s["name"] for s in shows}
conf = {}
for f in json.load(open(os.path.join(D, "heldout-feeds.json"), encoding="utf-8")):
    if f["name"] not in names:
        continue
    d = {}
    for t in f["texts"]:
        hosts = {h for h in HOST.findall(t)}
        if not hosts:
            continue
        hostcat = " ".join(hosts)
        for b, p in pats.items():
            if not any(tok in hostcat for tok in TOK[b]):
                continue
            if any(whole(t, m) and CUE.search(t[max(0, m.start() - 150): m.end() + 150]) for m in p.finditer(t)):
                d[b] = d.get(b, 0) + 1
    conf[f["name"]] = d


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


ids = {s["id"] for s in shows}
batches = [[i for i in b if i in ids] for b in S["batches"]]
rows = []
strict_carries = sum(1 for s in shows for b, n in M.get(s["name"], {}).items() if n >= 2)
confirmed_carries = sum(1 for s in shows for b, n in conf.get(s["name"], {}).items() if n >= 2 and M.get(s["name"], {}).get(b, 0) >= 2)
for b in S["brands"]:
    bn = b["name"]
    if not any((v or {}).get("affinity") is not None for v in S["scores"][bn].values()):
        continue
    lab = [conf.get(s["name"], {}).get(bn, 0) >= 2 for s in shows]
    if sum(lab) < 3:
        continue
    pct = {}
    for ids_ in batches:
        vals = [((S["scores"][bn].get(i) or {}).get("affinity")) for i in ids_]
        r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(ids_) - 1, 1)
        pct.update({i: x / n for i, x in zip(ids_, r)})
    q = [pct[s["id"]] for s in shows]
    chart = [-s["rank"] for s in shows]
    vol = [sum(1 for bb, n in M.get(s["name"], {}).items() if n >= 2 and bb != bn) for s in shows]
    rows.append({"brand": bn, "positives": int(sum(lab)), "qloo": auc(q, lab), "chart": auc(chart, lab), "ad_volume": auc(vol, lab)})
m = lambda k: round(float(np.mean([r[k] for r in rows])), 4)
rng = np.random.default_rng(20261022)
v = np.array([r["qloo"] for r in rows]); bs = [v[rng.integers(0, len(v), len(v))].mean() for _ in range(10000)]
d = np.array([r["qloo"] - r["chart"] for r in rows]); bd = [d[rng.integers(0, len(d), len(d))].mean() for _ in range(10000)]
res = {"note": "Exploratory, not pre-registered (22 Oct 2026). URL-confirmed labels: strict sponsor reads whose episode also carries a web address built on the brand's own name.",
       "shows": len(shows), "brands": len(rows),
       "strict_carries": strict_carries, "url_confirmed_carries": confirmed_carries,
       "mean_auc": {k: m(k) for k in ["qloo", "chart", "ad_volume"]},
       "qloo_ci95_brands": [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)],
       "qloo_minus_chart_ci95_brands": [round(float(np.percentile(bd, 2.5)), 4), round(float(np.percentile(bd, 97.5)), 4)],
       "qloo_above_half": f"{sum(r['qloo'] > 0.5 for r in rows)} of {len(rows)}",
       "rows": [{k: (round(x, 4) if isinstance(x, float) else x) for k, x in r.items()} for r in rows]}
json.dump(res, open(os.path.join(ROOT, "docs", "podcast-check", "confirmed.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps({k: x for k, x in res.items() if k != "rows"}, indent=1))
