// Evidence gate: is every claim in a brief traceable to something the Qloo tools actually returned?
// Used by the tests and by the CI quality gate (scripts/evidence-gate.mjs). Pure functions, no network.

const ITEM_FIELDS = ["audience_traits", "meta_interests", "creative_angles", "partnerships"];
const OBJ_FIELDS = ["demographics", "landing_page"];
const NAMED_FIELDS = ["meta_interests", "partnerships"];

/** Names the agent saw in tool results: entity names, plus demographic bucket keys (e.g. "25_to_29", "female"). */
export function sourcesFrom(outputs) {
  const names = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (typeof o.name === "string") names.add(o.name);
    for (const k of ["age", "gender"]) if (o[k] && typeof o[k] === "object") Object.keys(o[k]).forEach((b) => names.add(b));
  };
  walk(outputs);
  return [...names].filter((n) => n.length >= 3);
}

/** One row per claim: field, label, evidence, grounded (some evidence string names a source). */
export function checkEvidence(brief, sources) {
  const lower = sources.map((s) => s.toLowerCase());
  const grounded = (ev) => (ev || []).some((e) => {
    const t = String(e).toLowerCase();
    return lower.some((s) => t.includes(s));
  });
  const rows = [];
  for (const f of ITEM_FIELDS) {
    for (const it of brief[f] || []) {
      const label = it.trait || it.interest || it.angle || it.partner || JSON.stringify(it).slice(0, 60);
      // An interest or partner that IS a returned Qloo entity is grounded by its own name (exact match only): a real
      // run (20/10) listed "Warby Parker" with evidence "Affinity 0.957", true but without repeating the name.
      const named = NAMED_FIELDS.includes(f) && lower.includes(String(label).trim().toLowerCase());
      rows.push({ field: f, label, evidence: it.evidence || [], grounded: named || grounded(it.evidence) });
    }
  }
  for (const f of OBJ_FIELDS) {
    const it = brief[f];
    if (it) rows.push({ field: f, label: it.headline || it.age || f, evidence: it.evidence || [], grounded: grounded(it.evidence) });
  }
  const n = rows.filter((r) => r.grounded).length;
  return { rows, grounded: n, total: rows.length, ratio: rows.length ? n / rows.length : 0 };
}
