// The agent's self-check, run on its first finished brief before anyone sees it. Each Meta interest is scored by Qloo on
// the audience of a rival the agent names but never used (holdout_rival): a pick that only fits the agent's own seed brand
// is weak. Picks below the bar go back to the agent once, to replace or drop. The same rule as the benchmark's strong fit
// (docs/benchmark: 0.9+ for a held-out competitor), with a middle band so one soft score does not throw a pick away.
// With a Meta token, the same names are also looked up in Meta's interest search: an interest Meta does not have cannot
// be targeted, so it goes back to the agent too (two AI reviews we ran on 22 Oct: a test must never target a missing interest).
import { gradePicks, norm } from "./grade.js";

export const STRONG = 0.9, FAIR = 0.8;
const list = (v) => (Array.isArray(v) ? v : []);
const clean = (s) => String(s || "").replace(/\s*\(check in ads manager\)\s*/i, "").trim();

/** strong (0.9+), fair (0.8 to 0.9), weak (below 0.8, or Qloo has no score for the rival's audience), not_in_qloo. */
export function verdictOf(g) {
  if (g.status === "no_match") return "not_in_qloo";
  if (g.status !== "scored") return "weak";
  return g.affinity >= STRONG ? "strong" : g.affinity >= FAIR ? "fair" : "weak";
}

/** The rival whose audience the picks are scored on: the first of the agent's holdout_rival names (one to three, comma
 *  separated) that Qloo knows as a brand and the brief did not use; else the brand the seed audience likes most among
 *  results the brief did not cite. Live runs (22/10) showed why the names come first: the fallback once gave Haagen-Dazs
 *  as the rival of a turntable. */
export async function pickRival(qloo, brief, registry, seeds) {
  const used = new Set([...seeds, ...["meta_interests", "audience_traits", "partnerships", "test_plan"].flatMap((k) => list(brief[k]).flatMap((i) => list(i?.entity_ids)))]);
  const named = String(brief.holdout_rival || "").split(/[,;]|\s+or\s+/).map(clean).filter(Boolean).slice(0, 3);
  for (const n of named) {
    const hits = await qloo.search({ query: n, types: "urn:entity:brand", take: 5 }).catch(() => []);
    const want = norm(n);
    // exact, or the name followed by more words ("Rega" -> "Rega Research"); never a longer word ("Rega" -> "Regal Cinemas",
    // found by the self-check evaluation on 22 Oct)
    const words = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hit = hits.find((h) => norm(h.name) === want) || hits.find((h) => words(h.name).startsWith(`${words(n)} `));
    if (hit && !used.has(hit.entity_id)) return { name: hit.name, entity_id: hit.entity_id, source: "named by the agent", named };
  }
  const brands = list(registry).filter((e) => /brand/.test(String(e.type)) && !used.has(e.entity_id) && typeof e.affinity === "number")
    .sort((a, b) => b.affinity - a.affinity);
  return brands[0] ? { name: brands[0].name, entity_id: brands[0].entity_id, source: "closest uncited brand", named } : null;
}

/** makeSelfCheck({qloo, market, meta}) -> async (brief, {registry, seeds}) -> report. meta (optional): names -> Map of
 *  name -> {status: "targetable" | "not_found" | "unknown", nearest}, from Meta's interest search. */
export function makeSelfCheck({ qloo, market, meta = null }) {
  let rival; // chosen once per run, so the revised brief is checked on the same audience
  return async (brief, { registry, seeds }) => {
    rival = rival || await pickRival(qloo, brief, registry, seeds);
    const names = list(brief.meta_interests).map((i) => clean(i?.interest)).filter(Boolean);
    const inMeta = meta && names.length ? await meta(names).catch(() => null) : null;
    const metaOf = (n) => (inMeta?.get(n) ? { meta: inMeta.get(n).status, ...(inMeta.get(n).nearest?.length ? { meta_nearest: inMeta.get(n).nearest } : {}) } : {});
    const notInMeta = (ps) => ps.filter((p) => p.meta === "not_found").map((p) => p.name);
    if (!rival) {
      const picks = names.map((name) => ({ name, verdict: "unchecked", ...metaOf(name) }));
      return { rival: null, picks, weak: [], not_in_meta: notInMeta(picks) };
    }
    // the entity the run itself returned under that name comes first, so a pick is never graded as a namesake
    const known = new Map(list(registry).map((e) => [norm(e.name), e]));
    const graded = await gradePicks(qloo, names, [rival.entity_id], market, known);
    const picks = graded.map((g) => ({ name: g.name, affinity: g.affinity, verdict: verdictOf(g), qloo_name: g.match?.name || null, ...metaOf(g.name) }));
    return { rival, picks, weak: picks.filter((p) => p.verdict === "weak" || p.verdict === "not_in_qloo").map((p) => p.name), not_in_meta: notInMeta(picks) };
  };
}

/** Does the report send the brief back? Weak on the rival, or an interest Meta does not have. */
export const needsRewrite = (r) => !r?.error && (list(r?.weak).length > 0 || list(r?.not_in_meta).length > 0);

/** What the agent is told when picks fail, in one tool result. */
export function feedback(report) {
  const metaNote = (p) => p.meta === "not_found" ? `; NOT in Meta's interest list${p.meta_nearest?.length ? ` (Meta has: ${p.meta_nearest.join(", ")})` : ""}` : p.meta === "targetable" ? "; in Meta" : "";
  const lines = report.picks.map((p) => `- ${p.name}: ${p.verdict}${p.affinity != null ? ` (${p.affinity.toFixed(3)})` : ""}${metaNote(p)}`);
  const weak = list(report.weak), missing = list(report.not_in_meta);
  const head = report.rival ? `each Meta interest was scored by Qloo on the audience of ${report.rival.name}, a rival you did not use` : "no rival could be scored this time";
  const looked = report.picks.some((p) => p.meta) ? ", and each was looked up in Meta's interest search" : "";
  return `Self-check before the brief is shown: ${head}${looked}.
${lines.join("\n")}
${weak.length ? `Weak or not in Qloo: ${weak.join(", ")}. ` : ""}${missing.length ? `Not in Meta, so a buyer cannot target them: ${missing.join(", ")}. ` : ""}Replace each with a result you already have from Qloo that fits this product and that Meta is likely to have (use Meta's exact name when it is listed above), or drop it. No targeting test may name an interest that is not in Meta: rewrite or drop those tests. Keep everything else. Then call submit_brief again with the full brief.`;
}
