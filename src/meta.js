// A check that doesn't depend on Qloo: can each suggested interest actually be targeted in Meta Ads? Uses the Marketing
// API's interest search (GET /search?type=adinterest), which needs an access token but no ad account spend.
// Audience sizes are Meta's worldwide estimates for the interest, not for the city.

// Meta adds a qualifier to many interests ("Peloton (cycling)", "Running (physical exercise)") and "Inc." to companies;
// those still count as the same name.
const norm = (s) => String(s || "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, " ").replace(/,?\s+inc\.?$/, "")
  .replace(/[^a-z0-9]+/g, " ").trim();

/** Pick the Meta interest that has the same name as the suggestion; anything else is "not targetable as named". */
export function matchInterest(name, results) {
  const want = norm(name);
  const hit = (results || []).find((r) => norm(r.name) === want);
  if (hit) {
    return { name, status: "targetable", interest: { id: hit.id, name: hit.name, path: hit.path || [] },
      audience: [hit.audience_size_lower_bound ?? null, hit.audience_size_upper_bound ?? null] };
  }
  return { name, status: "not_found", nearest: (results || []).slice(0, 3).map((r) => r.name) };
}

export function summarizeMeta(checks) {
  const t = checks.filter((c) => c.status === "targetable");
  return { picks: checks.length, targetable: t.length, share_targetable: checks.length ? t.length / checks.length : 0,
    // median of the upper bound, a rough "how big" for the interests that exist
    median_audience_upper: median(t.map((c) => c.audience[1]).filter((x) => x != null)) };
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Each name looked up in Meta's interest search, one at a time. A not-found name keeps only near names that share its
 *  first word (Hoka -> Hoka One One), never unrelated ones; a failed lookup is "unknown", never a guess. */
export async function checkInterests(search, names) {
  const out = [];
  // one batched request when the client has it: a Worker run has a fixed budget of outgoing requests
  const batched = typeof search.many === "function" ? await search.many(names).catch((e) => names.map(() => e)) : null;
  for (const [i, name] of names.entries()) {
    try {
      const res = batched ? batched[i] : await search(name);
      if (res instanceof Error) throw res;
      const m = matchInterest(name, res);
      if (m.status === "not_found") { const w = norm(name).split(" ")[0]; m.nearest = m.nearest.filter((n) => w && norm(n).split(" ").includes(w)).slice(0, 2); }
      out.push(m);
    } catch (e) {
      out.push({ name, status: "unknown", error: String(e.message || e).slice(0, 120) });
    }
  }
  return out;
}

/** Interest search; the token goes in the Authorization header, never in the URL. */
export function makeMeta({ token, version = "v26.0", fetchImpl = fetch, minGapMs = 250 }) {
  let last = 0;
  const url = (q) => `search?type=adinterest&limit=10&locale=en_US&q=${encodeURIComponent(q)}`;
  /** Up to 50 searches in one Graph API batch request; each answer is the result list or an Error. */
  const many = async (qs) => {
    const res = await fetchImpl(`https://graph.facebook.com/${version}/`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" },
      body: `include_headers=false&batch=${encodeURIComponent(JSON.stringify(qs.slice(0, 50).map((q) => ({ method: "GET", relative_url: url(q) }))))}` });
    const body = await res.json();
    if (!res.ok || !Array.isArray(body)) throw new Error(`Meta ${res.status}: ${body?.error?.message || "batch error"}`);
    return qs.map((q, i) => { const r = body[i]; let b = {}; try { b = JSON.parse(r?.body || "{}"); } catch { /* left empty */ }
      return r?.code === 200 ? b.data || [] : new Error(`Meta ${r?.code ?? "no answer"}: ${b?.error?.message || "error"}`); });
  };
  const search = async function search(q) {
    const wait = last + minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const url = `https://graph.facebook.com/${version}/search?type=adinterest&limit=10&locale=en_US&q=${encodeURIComponent(q)}`;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(`Meta ${res.status}: ${body?.error?.message || "error"}`);
    return body.data || [];
  };
  search.many = many;
  return search;
}
