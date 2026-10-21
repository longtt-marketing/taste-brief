"""Held-out data for the podcast sponsorship check (docs/podcast-check/PREREGISTRATION.md).

Apple's US top podcasts by genre (public iTunes chart feeds), minus the development set, then each show's public RSS
feed: up to 40 episodes from the last 12 months. Sponsors are matched with the frozen dictionary (brands.json).
Output (git-ignored): .results/podcast/heldout-feeds.json and heldout-mentions.json.

Usage: python scripts/podcast/collect.py [--dev <dev feeds.json>]
"""
import argparse, concurrent.futures as cf, datetime as dt, email.utils, hashlib, html, json, os, re, sys, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (TasteBrief research; public RSS)"}
GENRES = {"Arts": 1301, "Business": 1321, "Comedy": 1303, "Education": 1304, "Health & Fitness": 1512,
          "Society & Culture": 1324, "Sports": 1545, "Technology": 1318, "True Crime": 1488, "News": 1489,
          "TV & Film": 1309, "Leisure": 1502}
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, ".results", "podcast")
norm = lambda s: re.sub(r"[^a-z0-9]", "", str(s).lower())


def get(url, t=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t).read().decode("utf-8", "replace")


def chart(genre_id):
    j = json.loads(get(f"https://itunes.apple.com/us/rss/toppodcasts/limit=200/genre={genre_id}/json"))
    out = []
    for i, e in enumerate(j.get("feed", {}).get("entry", []), 1):
        out.append({"name": e["im:name"]["label"], "itunes_id": e["id"]["attributes"]["im:id"], "rank": i})
    return out


def episodes(feed_url, cutoff):
    x = get(feed_url, 40)
    items = re.findall(r"<item[ >].*?</item>", x, re.S)[:80]
    texts = []
    for it in items:
        m = re.search(r"<pubDate>(.*?)</pubDate>", it, re.S)
        try:
            when = email.utils.parsedate_to_datetime(m.group(1).strip()) if m else None
        except Exception:
            when = None
        if when and when.replace(tzinfo=None) < cutoff:
            continue
        parts = re.findall(r"<description>(.*?)</description>|<content:encoded>(.*?)</content:encoded>|<itunes:summary>(.*?)</itunes:summary>", it, re.S)
        raw = " ".join(a or b or c for a, b, c in parts)
        raw = re.sub(r"<!\[CDATA\[|\]\]>", " ", raw)
        txt = html.unescape(re.sub(r"<.*?>", " ", html.unescape(raw))).lower()
        texts.append(re.sub(r"\s+", " ", txt))
        if len(texts) >= 40:
            break
    return texts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dev", default="")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    dev = set()
    if a.dev:
        dev = {norm(f["name"]) for f in json.load(open(a.dev, encoding="utf-8"))}
    shows = {}
    for g, gid in GENRES.items():
        try:
            for s in chart(gid):
                k = norm(s["name"])
                if k in dev or k in shows:
                    continue
                shows[k] = {**s, "genre": g}
        except Exception as e:
            print("chart failed", g, e, file=sys.stderr)
    print("held-out shows from charts:", len(shows), file=sys.stderr)
    cutoff = dt.datetime.utcnow() - dt.timedelta(days=365)

    def fetch(s):
        try:
            r = json.loads(get("https://itunes.apple.com/lookup?" + urllib.parse.urlencode({"id": s["itunes_id"]})))
            feed = (r.get("results") or [{}])[0].get("feedUrl")
            if not feed:
                return None
            return {**s, "feed": feed, "texts": episodes(feed, cutoff)}
        except Exception:
            return None

    feeds = []
    with cf.ThreadPoolExecutor(8) as ex:
        for f in ex.map(fetch, shows.values()):
            if f and f["texts"]:
                feeds.append(f)
    print("feeds fetched:", len(feeds), file=sys.stderr)
    brands = json.load(open(os.path.join(ROOT, "docs", "podcast-check", "brands.json"), encoding="utf-8"))
    pats = {b: re.compile(p) for b, p in brands.items()}
    mentions = {}
    for f in feeds:
        d = {}
        for b, p in pats.items():
            n = sum(1 for t in f["texts"] if p.search(t))
            if n:
                d[b] = n
        mentions[f["name"]] = d
    json.dump(feeds, open(os.path.join(OUT, "heldout-feeds.json"), "w", encoding="utf-8"))
    json.dump(mentions, open(os.path.join(OUT, "heldout-mentions.json"), "w", encoding="utf-8"), indent=1)
    meta = {f["name"]: {"rank": f["rank"], "genre": f["genre"]} for f in feeds}
    json.dump(meta, open(os.path.join(OUT, "heldout-meta.json"), "w", encoding="utf-8"), indent=1)
    listing = sum(1 for d in mentions.values() if sum(n >= 2 for n in d.values()) >= 3)
    print("shows listing >=3 sponsors:", listing, file=sys.stderr)


if __name__ == "__main__":
    main()
