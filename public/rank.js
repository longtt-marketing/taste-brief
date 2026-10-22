// Order podcast candidates the way the podcast check found best for a shortlist: Qloo's rank for the brand plus the
// show's rank by how many advertisers its episode notes already run (the H3 combination of the pre-registration). In an
// exploratory top-10 count on the held-out test it found 1.9 sponsored shows, against 1.6 for Qloo alone or ad volume alone
// (docs/podcast-check/robustness.json). A show with no sponsor data counts as 0 advertisers.

// average ranks, 0 for the lowest value; ties share their mean rank
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) out[order[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return out;
}

/** Shows sorted by taste rank plus ad-demand rank, best first; ties go to the higher Qloo affinity. */
export function sponsorReady(shows) {
  const list = Array.isArray(shows) ? shows : [];
  const aff = list.map((s) => (typeof s.affinity === "number" ? s.affinity : -1));
  const ads = list.map((s) => (Array.isArray(s.advertisers) ? s.advertisers.length : 0));
  const ra = ranks(aff), rv = ranks(ads);
  return list.map((s, i) => ({ s, score: ra[i] + rv[i], aff: aff[i] }))
    .sort((a, b) => b.score - a.score || b.aff - a.aff)
    .map((x) => x.s);
}

/** The shows to ask first: ones that sell ads with no brand of the category found in their notes (best taste fit
 *  first), then ones a rival already uses (in the order above); with no ad data at all, the best taste fits. Used by the
 *  page and by the worker, so the plan and the agent's drafts name the same shows. */
export function askFirst(shows, n = 3) {
  const list = Array.isArray(shows) ? shows : [];
  const byAff = (a, b) => (Number(b.affinity) || 0) - (Number(a.affinity) || 0);
  const ads = (s) => (Array.isArray(s.advertisers) ? s.advertisers : null);
  const rivals = (s) => (Array.isArray(s.rivals) ? s.rivals : []);
  const open = list.filter((s) => ads(s)?.length && !rivals(s).length).sort(byAff);
  const taken = sponsorReady(list.filter((s) => rivals(s).length));
  const selling = [...open, ...taken].slice(0, n);
  return { shows: selling.length ? selling : [...list].sort(byAff).slice(0, n), selling: selling.length > 0 };
}

const STOP = new Set(["the", "a", "an", "with", "and", "of", "podcast", "show", "has", "not", "but", "in", "on", "for", "to", "my", "your", "our", "is", "it", "me", "its", "this", "that", "you"]);
/** One promo code per show that a host can read out: the show's first distinctive word (ARMCHAIR, BEAUTIFUL). */
export function promoCodes(names) {
  const used = new Set();
  return (Array.isArray(names) ? names : []).map((name) => {
    const words = String(name).toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).map((w) => w.replace(/'s$|'/g, "")).filter((w) => w.length > 2 && !STOP.has(w));
    let c = (words[0] || "show").toUpperCase().slice(0, 10);
    for (let k = 2; used.has(c); k++) c = c.replace(/\d+$/, "") + k;
    used.add(c);
    return c;
  });
}
