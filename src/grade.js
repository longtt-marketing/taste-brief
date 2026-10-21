// One grader for any list of audience picks, from Taste Brief or from a plain model: look each name up in Qloo, then ask
// Qloo how much the seed brand's audience in that market likes that exact entity (insights restricted to it). No model.
// It answers "how far is this pick from Qloo's view of the audience?", not "will this ad work"; for Taste Brief's own
// picks it is partly circular, since they come from Qloo results, and the page and the benchmark say so.
import { INSIGHT_TYPES } from "./qloo.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\(check in ads manager\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Candidate search strings for one pick: "Veja or On Running" -> ["Veja or On Running", "Veja", "On Running"]. */
export function candidates(name) {
  const clean = String(name ?? "").replace(/\(check in ads manager\)/gi, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = clean.split(/\s+(?:or|and|\/|&)\s+|\s*[\/,]\s*/i).map((x) => x.trim()).filter((x) => x.length >= 2);
  return [...new Set([clean, ...(parts.length > 1 ? parts : [])])].filter(Boolean);
}

/** The Qloo entity a pick names, or null: the search hit must carry the same name (not a loose fuzzy match). */
export async function resolvePick(qloo, name) {
  for (const q of candidates(name)) {
    const hits = await qloo.search({ query: q, take: 3 }).catch(() => []);
    const want = norm(q);
    // exact name only: "Parkrun" must not become "parkrun Zalew Zyrardowski", a place in Poland
    const hit = hits.find((h) => norm(h.name) === want);
    if (hit) return hit;
  }
  return null;
}

/** Affinity of one entity for the seed audience in a market, as Qloo returns it, or null when Qloo returns nothing. */
export async function scoreEntity(qloo, entity, seedIds, location) {
  const type = String(entity.type || "");
  const filter_type = type.startsWith("urn:entity:") ? type : `urn:entity:${type}`;
  if (!INSIGHT_TYPES.includes(filter_type)) return null;
  const r = await qloo.insights({ filter_type, entity_ids: seedIds, location, result_ids: [entity.entity_id], take: 1 }).catch(() => []);
  const e = r.find((x) => x.entity_id === entity.entity_id);
  return typeof e?.affinity === "number" ? e.affinity : null;
}

/** Grade a list of pick names: [{name, status: "scored" | "no_match" | "no_score", match, affinity}]. */
export async function gradePicks(qloo, names, seedIds, location) {
  const out = [];
  for (const name of names) {
    const match = await resolvePick(qloo, name);
    if (!match) { out.push({ name, status: "no_match", match: null, affinity: null }); continue; }
    const affinity = await scoreEntity(qloo, match, seedIds, location);
    out.push({ name, status: affinity == null ? "no_score" : "scored", match: { name: match.name, type: match.type, entity_id: match.entity_id }, affinity });
  }
  return out;
}

/** Summary of a graded list: how many could be checked, mean affinity of those, how many at 0.9 or more. */
export function summarize(graded) {
  const scored = graded.filter((g) => g.status === "scored");
  const mean = scored.length ? scored.reduce((s, g) => s + g.affinity, 0) / scored.length : null;
  return { picks: graded.length, checkable: scored.length, mean_affinity: mean, high: scored.filter((g) => g.affinity >= 0.9).length };
}
