"""Prospective check (docs/podcast-check/PREREGISTRATION-2.md): do brands' NEW podcast sponsorships, made after the
lock, land on shows Qloo already ranked high for them?

  python scripts/podcast/prospective.py freeze   # once, at the lock: snapshot every held-out show's feed and Qloo ranks
  python scripts/podcast/prospective.py collect  # once, on 29 or 30 Oct 2026: read the same feeds again
  python scripts/podcast/prospective.py analyze  # the analysis fixed in PREREGISTRATION-2.md

freeze writes docs/podcast-check/prospective-frozen.json (public: Qloo percentiles per brand and show, chart ranks, the
episode ids already published, the brands each show already read). collect writes .results/podcast/prospective-feeds.json.
analyze writes docs/podcast-check/prospective-results.json. Sponsor reads use the strict rule of DEVIATION-1.md.
"""
import concurrent.futures as cf, datetime as dt, email.utils, hashlib, html, json, os, random, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
D = os.path.join(ROOT, ".results", "podcast")
DOCS = os.path.join(ROOT, "docs", "podcast-check")
FROZEN = os.path.join(DOCS, "prospective-frozen.json")
UA = {"User-Agent": "Mozilla/5.0 (TasteBrief research; public RSS)"}
CUE = re.compile(r"sponsor|brought to you by|support for (?:this|the) show comes from|promo code|use code|offer code|\bcode [a-z0-9]+|% off|free trial|(?:go to|visit) [a-z0-9-]+\.com|[a-z0-9-]+\.com/[a-z0-9]+")
W = re.compile(r"[a-z0-9]")
whole = lambda t, m: (m.start() == 0 or not W.match(t[m.start() - 1])) and (m.end() >= len(t) or not W.match(t[m.end()]))
PATS = {b: re.compile(p) for b, p in json.load(open(os.path.join(DOCS, "brands.json"), encoding="utf-8")).items()}


def get(url, t=40):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t).read().decode("utf-8", "replace")


def items(feed_url):
    """Every item in the feed: a short id (guid, else link, else title), its date and its notes text, lowercased."""
    out = []
    for it in re.findall(r"<item[ >].*?</item>", get(feed_url), re.S):
        key = (re.search(r"<guid[^>]*>(.*?)</guid>", it, re.S) or re.search(r"<link>(.*?)</link>", it, re.S) or re.search(r"<title>(.*?)</title>", it, re.S))
        m = re.search(r"<pubDate>(.*?)</pubDate>", it, re.S)
        try:
            when = email.utils.parsedate_to_datetime(m.group(1).strip()).astimezone(dt.timezone.utc).isoformat() if m else None
        except Exception:
            when = None
        parts = re.findall(r"<description>(.*?)</description>|<content:encoded>(.*?)</content:encoded>|<itunes:summary>(.*?)</itunes:summary>", it, re.S)
        raw = re.sub(r"<!\[CDATA\[|\]\]>", " ", " ".join(a or b or c for a, b, c in parts))
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<.*?>", " ", html.unescape(raw))).lower())
        kid = hashlib.sha1((key.group(1).strip() if key else txt[:200]).encode()).hexdigest()[:12]
        out.append({"id": kid, "when": when, "text": txt})
    return out


def reads(text):
    return {b for b, p in PATS.items() if any(whole(text, m) and CUE.search(text[max(0, m.start() - 150): m.end() + 150]) for m in p.finditer(text))}


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


def fetch_all(shows):
    def one(s):
        try:
            return s["id"], items(s["feed"])
        except Exception as e:
            return s["id"], {"error": str(e)[:120]}
    with cf.ThreadPoolExecutor(8) as ex:
        return dict(ex.map(one, shows))


def freeze():
    S = json.load(open(os.path.join(D, "heldout-scores.json"), encoding="utf-8"))
    feeds = {f["name"]: f["feed"] for f in json.load(open(os.path.join(D, "heldout-feeds.json"), encoding="utf-8"))}
    shows = [{"id": s["id"], "name": s["name"], "genre": s["genre"], "chart_rank": s["rank"], "feed": feeds[s["name"]]} for s in S["shows"]]
    ids = {s["id"] for s in shows}
    brands = [b for b in S["brands"] if any((v or {}).get("affinity") is not None for v in S["scores"][b["name"]].values())]
    pct = {}
    for b in brands:
        out = {}
        for batch in S["batches"]:
            batch = [i for i in batch if i in ids]
            vals = [((S["scores"][b["name"]].get(i) or {}).get("affinity")) for i in batch]
            r = ranks([v if v is not None else -1.0 for v in vals]); n = max(len(batch) - 1, 1)
            out.update({i: round(x / n, 4) for i, x in zip(batch, r)})
        pct[b["name"]] = out
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    got = fetch_all(shows)
    for s in shows:
        its = got[s["id"]]
        s["episode_ids"] = [] if isinstance(its, dict) else sorted({x["id"] for x in its})
        s["already_reads"] = [] if isinstance(its, dict) else sorted(set().union(*[reads(x["text"]) for x in its]) if its else set())
        s["fetch_error"] = its.get("error") if isinstance(its, dict) else None
    json.dump({"locked_at": now, "rule": "PREREGISTRATION-2.md", "brands": [b["name"] for b in brands], "shows": shows, "qloo_percentile": pct},
              open(FROZEN, "w", encoding="utf-8"), indent=1)
    print("frozen", now, "shows", len(shows), "fetched", sum(1 for s in shows if not s["fetch_error"]), "brands", len(brands))


def collect():
    F = json.load(open(FROZEN, encoding="utf-8"))
    got = fetch_all(F["shows"])
    json.dump({"collected_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(), "items": got},
              open(os.path.join(D, "prospective-feeds.json"), "w", encoding="utf-8"))
    print("collected", sum(1 for v in got.values() if not isinstance(v, dict)), "feeds")


def analyze():
    F = json.load(open(FROZEN, encoding="utf-8"))
    C = json.load(open(os.path.join(D, "prospective-feeds.json"), encoding="utf-8"))
    lock = dt.datetime.fromisoformat(F["locked_at"])
    new_reads, active = {}, set()
    for s in F["shows"]:
        its = C["items"].get(s["id"])
        if s["fetch_error"] or not isinstance(its, list):
            continue
        old = set(s["episode_ids"])
        fresh = [x for x in its if x["id"] not in old and (x["when"] is None or dt.datetime.fromisoformat(x["when"]) >= lock)]
        if fresh:
            active.add(s["id"])
            new_reads[s["id"]] = set().union(*[reads(x["text"]) for x in fresh])
    rank = {s["id"]: s["chart_rank"] for s in F["shows"]}
    already = {s["id"]: set(s["already_reads"]) for s in F["shows"]}
    rows = []
    for b in F["brands"]:
        pos = [i for i in active if b in new_reads.get(i, set()) and b not in already[i]]
        neg = [i for i in active if b not in new_reads.get(i, set()) and b not in already[i]]
        if not pos or not neg:
            continue
        q = F["qloo_percentile"][b]
        pw = lambda sc: sum((sc(p) > sc(n)) + 0.5 * (sc(p) == sc(n)) for p in pos for n in neg)
        rows.append({"brand": b, "new_placements": len(pos), "negatives": len(neg), "pairs": len(pos) * len(neg),
                     "qloo_wins": pw(lambda i: q.get(i, -1)), "chart_wins": pw(lambda i: -rank[i])})
    P = sum(r["pairs"] for r in rows)
    res = {"locked_at": F["locked_at"], "collected_at": C["collected_at"], "shows_with_new_episodes": len(active),
           "new_placements": sum(r["new_placements"] for r in rows), "brands_with_new_placements": len(rows)}
    if P:
        res["qloo_auc_pairs"] = round(sum(r["qloo_wins"] for r in rows) / P, 4)
        res["chart_auc_pairs"] = round(sum(r["chart_wins"] for r in rows) / P, 4)
        res["qloo_auc_mean_over_brands"] = round(sum(r["qloo_wins"] / r["pairs"] for r in rows) / len(rows), 4)
        random.seed(20261030)
        bs = sorted(sum(r["qloo_wins"] for r in pick) / sum(r["pairs"] for r in pick) for pick in (random.choices(rows, k=len(rows)) for _ in range(10000)))
        res["qloo_auc_pairs_ci95_brands"] = [round(bs[250], 4), round(bs[9749], 4)]
    res["too_few_to_conclude"] = res["new_placements"] < 10
    res["rows"] = rows
    json.dump(res, open(os.path.join(DOCS, "prospective-results.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != "rows"}, indent=1))


if __name__ == "__main__":
    {"freeze": freeze, "collect": collect, "analyze": analyze}[sys.argv[1]]()
