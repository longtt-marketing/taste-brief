// Evidence gate: is every claim in a brief traceable to something the Qloo tools actually returned in THIS run?
// Used by the agent (to attach verified sources to each item), the page, the tests and the CI gate. Pure functions.
//
// v2 (20 Oct 2026, after an independent review): a claim is grounded by the Qloo entity ids it cites, checked against a
// registry of what Qloo returned, not by matching free text. Free-text matching let "Running" pass on "Allbirds tag:
// Running" just because the seed brand is always in the results. Rules:
// - every cited id must be an entity some Qloo call returned in this run, else the claim is flagged;
// - the seed entities (the ones the agent used as the signal) ground only a claim that names the seed itself, or an age /
//   gender claim whose numbers are the demographics Qloo returned for that seed;
// - an affinity number quoted in the evidence text must match the affinity Qloo returned for a cited entity;
// - a Meta interest or partner must be one thing: "A / B" combinations are flagged.

export const ITEM_FIELDS = ["audience_traits", "meta_interests", "creative_angles", "partnerships"];
const LABEL = { audience_traits: "trait", meta_interests: "interest", creative_angles: "angle", partnerships: "partner" };
const SINGLE = new Set(["meta_interests", "partnerships"]);

const norm = (s) => String(s ?? "").toLowerCase().replace(/\(check in ads manager\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const ids = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String).filter(Boolean);

/**
 * Registry of what Qloo returned, built from the agent trace (calls with their outputs).
 * entities: id -> {entity_id, name, type, affinity, via, location}; seeds: ids used as signal.interests.entities.
 */
export function registryFrom(calls) {
  const entities = new Map();
  const seeds = new Set();
  const demographics = new Map(); // seed id -> {age, gender} as Qloo returned them
  for (const { tool, input, output } of calls) {
    if (!Array.isArray(output)) continue;
    if (tool === "insights") for (const id of ids(input?.entity_ids)) seeds.add(id);
    if (tool === "demographics") {
      for (const id of ids(input?.entity_ids)) seeds.add(id);
      for (const d of output) if (d?.entity_id) demographics.set(d.entity_id, { age: d.age || {}, gender: d.gender || {} });
      continue;
    }
    for (const e of output) {
      if (!e?.entity_id) continue;
      const prev = entities.get(e.entity_id);
      // keep the insights view (it carries the affinity for this audience) over the plain search hit
      if (prev && prev.via === "insights" && tool !== "insights") continue;
      entities.set(e.entity_id, {
        entity_id: e.entity_id, name: e.name, type: e.type, affinity: e.affinity ?? null,
        via: tool, location: tool === "insights" ? input?.location || null : null,
      });
    }
  }
  return { entities, seeds, demographics };
}

/** Names of everything Qloo returned (kept for the agent's summary and older callers). */
export function sourcesFrom(outputs) {
  const names = new Set();
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (!o || typeof o !== "object") return;
    if (typeof o.name === "string") names.add(o.name);
  };
  walk(outputs);
  return [...names].filter((n) => n.length >= 3);
}

/** Check one cited item. Returns {verified:[entities], problems:[strings], grounded}. */
export function verifyItem(field, item, reg) {
  const label = String(item?.[LABEL[field]] ?? item?.headline ?? "");
  const cited = ids(item?.entity_ids);
  const verified = [], problems = [];
  for (const id of cited) {
    const e = reg.entities.get(id);
    if (e) verified.push(e); else problems.push(`cites ${id}, which Qloo did not return`);
  }
  const labelN = norm(label);
  const text = [...(Array.isArray(item?.evidence) ? item.evidence : [item?.evidence ?? ""])].join(" ");
  const nonSeed = verified.filter((e) => !reg.seeds.has(e.entity_id));
  const seedNamed = verified.some((e) => reg.seeds.has(e.entity_id) && labelN.includes(norm(e.name)) && norm(e.name).length >= 3);
  // an age / gender claim may rest on the seed: its numbers are then checked against Qloo's demographics for that seed
  const demoVals = verified.filter((e) => reg.seeds.has(e.entity_id)).flatMap((e) => {
    const d = reg.demographics?.get(e.entity_id);
    return d ? [...Object.values(d.age), ...Object.values(d.gender)].map((v) => Math.abs(Number(v))) : [];
  });
  const demographic = demoVals.length > 0 && /\b(age|aged|female|male|women|men|gender|younger|older|skew\w*|over-?index\w*|\d{2}\s*(?:-|–|to)\s*\d{2})\b/i.test(`${label} ${text}`);
  if (verified.length && !nonSeed.length && !seedNamed && !demographic) problems.push("only the seed entity is cited, and the claim is not about the seed");
  if (SINGLE.has(field) && /\s\/\s|\s\+\s/.test(label)) problems.push("combines several entities in one line");
  // numbers in the free text must be ones Qloo returned for the cited entities: an affinity, or a demographic index
  for (const m of text.matchAll(/\b0\.\d{2,3}\b/g)) {
    const v = Number(m[0]);
    const isAffinity = verified.some((e) => typeof e.affinity === "number" && Math.abs(e.affinity - v) < 0.0015);
    const isDemo = demographic && demoVals.some((d) => Math.abs(d - v) < 0.006);
    if (!isAffinity && !isDemo) problems.push(`${m[0]} does not match a number Qloo returned for the cited entities`);
  }
  if (!cited.length) problems.push("cites no Qloo entity");
  const grounded = problems.length === 0 && (nonSeed.length > 0 || seedNamed || demographic);
  return { verified, problems, grounded };
}

/** Attach {verified, problems, grounded} to every item and return the summary the gate and the page use. */
export function checkEvidence(brief, reg) {
  const rows = [];
  for (const f of ITEM_FIELDS) {
    for (const it of brief?.[f] || []) {
      const v = verifyItem(f, it, reg);
      rows.push({ field: f, label: it?.[LABEL[f]] ?? "", ...v });
    }
  }
  if (brief?.landing_page) {
    const v = verifyItem("landing_page", brief.landing_page, reg);
    rows.push({ field: "landing_page", label: brief.landing_page.headline ?? "", ...v });
  }
  const n = rows.filter((r) => r.grounded).length;
  return { rows, grounded: n, total: rows.length, ratio: rows.length ? n / rows.length : 0 };
}

/** Same check, written onto the brief so the page can show the verified Qloo sources next to each line. */
export function annotateBrief(brief, reg) {
  const out = structuredClone(brief);
  for (const f of ITEM_FIELDS) {
    out[f] = (out[f] || []).map((it) => {
      const v = verifyItem(f, it, reg);
      return { ...it, verified: v.verified, problems: v.problems, grounded: v.grounded };
    });
  }
  if (out.landing_page) {
    const v = verifyItem("landing_page", out.landing_page, reg);
    out.landing_page = { ...out.landing_page, verified: v.verified, problems: v.problems, grounded: v.grounded };
  }
  return out;
}
