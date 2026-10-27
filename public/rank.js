// Order podcast candidates the way the podcast check found best for a shortlist: Qloo's rank for the brand plus the
// show's rank by how many advertisers its episode notes already run (the H3 combination of the pre-registration). In an
// exploratory top-10 count on the held-out test it found 1.9 sponsored shows, against 1.6 for Qloo alone or ad volume alone
// (docs/podcast-check/robustness.json). A show with no sponsor data counts as 0 advertisers.
import { availabilityFor } from "./contacts.js";

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
export function askFirst(shows, n = 3, { skipRivals = false, checkAvailability = false } = {}) {
  // Opt-in for the live buying workflow. The historical ranking/evaluation stays exactly as registered.
  const list = (Array.isArray(shows) ? shows : []).filter((s) => (!skipRivals || !(Array.isArray(s.rivals) && s.rivals.length))
    && (!checkAvailability || availabilityFor(s.name)?.status !== "archive"));
  const byAff = (a, b) => (Number(b.affinity) || 0) - (Number(a.affinity) || 0);
  const ads = (s) => (Array.isArray(s.advertisers) ? s.advertisers : null);
  const rivals = (s) => (Array.isArray(s.rivals) ? s.rivals : []);
  const open = list.filter((s) => ads(s)?.length && !rivals(s).length).sort(byAff);
  const taken = sponsorReady(list.filter((s) => rivals(s).length));
  const selling = [...open, ...taken].slice(0, n);
  return { shows: selling.length ? selling : [...list].sort(byAff).slice(0, n), selling: selling.length > 0 };
}

/** The buyer's choice for shows where a brand of the category already advertises: "allow" (the default: it shows the
 *  category works there, and the agent weighs exclusivity) or "skip" (never ask them). Anything else reads as "allow". */
export const rivalPolicy = (v) => (v === "skip" ? "skip" : "allow");

/** Absence of a data row is not evidence of an empty sponsor category. */
export function sponsorEvidence(show) {
  const ads = Array.isArray(show?.advertisers) ? (show.advertisers.length ? "found" : "none") : "unknown";
  const category = ads === "unknown" || !Array.isArray(show?.rivals) ? "unknown" : show.rivals.length ? "found" : "none";
  return { ads, category };
}

/** Copy based on the actual selected shows, never on another show's data in the larger candidate pool. */
export function shortlistEvidence(shows, category) {
  const states = (Array.isArray(shows) ? shows : []).map(sponsorEvidence);
  const n = states.length, adsFound = states.filter((s) => s.ads === "found").length;
  const adsUnknown = states.filter((s) => s.ads === "unknown").length;
  let text = !n ? "No shows meet the current selection."
    : adsFound === n ? "Sponsor mentions were found in the episode notes of every selected show."
    : `Sponsor mentions were found for ${adsFound} of ${n} selected shows. ${adsUnknown ? `Ad data is unknown for ${adsUnknown}; ask whether they sell ads.` : "No sponsor mentions were found for the others; ask whether they sell ads."}`;
  if (n && category && states.every((s) => s.category === "none")) text += ` No ${category} brand was found in the notes we checked.`;
  else if (n && category && states.some((s) => s.category === "unknown")) text += " Category competition is unknown where data is missing.";
  text += " Rates, reach, open dates and exclusivity still need confirmation. Dynamic ads may not appear in episode notes.";
  return { adsFound, adsUnknown, text };
}

/** Compare complete sets, not just whether the rule has any extra names. A three-show choice is not identical
 * to a rule that only found one eligible show, even when that one is shared. */
export function compareShortlists(chosen, rule) {
  const a = [...new Set((chosen || []).map((s) => s.name))], b = [...new Set((rule || []).map((s) => s.name))];
  const added = a.filter((n) => !b.includes(n)), omitted = b.filter((n) => !a.includes(n));
  const same = a.length === b.length && !added.length && !omitted.length;
  const text = same ? `The fixed rule selects the same ${a.length} show${a.length === 1 ? "" : "s"}.`
    : `The fixed rule selects ${b.length} show${b.length === 1 ? "" : "s"}${b.length ? `: ${b.join(", ")}` : ""}.`
      + (added.length ? ` The agent adds ${added.join(", ")}.` : "")
      + (omitted.length ? ` The agent leaves out ${omitted.join(", ")}.` : "");
  return { same, added, omitted, text };
}

/** The chosen shows the buyer's policy rules out, in plain code so the agent cannot quietly override it. */
export function policyBlocks(shows, policy) {
  return rivalPolicy(policy) === "skip" ? (Array.isArray(shows) ? shows : []).filter((s) => Array.isArray(s?.rivals) && s.rivals.length) : [];
}

const STOP = new Set(["the", "a", "an", "with", "and", "of", "podcast", "show", "has", "not", "but", "in", "on", "for", "to", "my", "your", "our", "is", "it", "me", "its", "this", "that", "you",
  "how", "why", "what", "who", "when", "where", "all", "about", "from", "out", "are", "was", "can", "get", "just", "now", "here", "there"]);
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
