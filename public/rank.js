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
