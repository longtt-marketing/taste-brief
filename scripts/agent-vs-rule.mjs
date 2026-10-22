// Does the agent choose better shows than the page's fixed rule? Plan locked first: docs/agent-vs-rule/PLAN.md.
// For each brand of the strict podcast check: Qloo's 20 podcasts for that brand's audience (the app's own call), the
// ad data with the brand's own name removed, then four ways to pick three shows: the agent (the app's prompt and tools,
// one forced draft_outreach call, brand name hidden), the fixed rule askFirst, top taste fit, top popularity. A hit is
// a pick whose own episode notes name the brand. Keys from .dev.vars, never printed. Writes docs/agent-vs-rule/results.json
// (show names and counts only, no Qloo scores).
//   node scripts/agent-vs-rule.mjs            (PLAN.md)
//   SAME=1 node scripts/agent-vs-rule.mjs     (PLAN-2.md: every policy picks from the shows in the ad data; the agent sees
//                                              each show's description and tags, as the app does since 22 Oct)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { askFirst } from "../public/rank.js";

const vars = {};
for (const line of (existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
  if (m && m[2]) vars[m[1]] = m[2];
}
if (!vars.QLOO_API_KEY || !vars.ANTHROPIC_API_KEY) { console.error("needs QLOO_API_KEY and ANTHROPIC_API_KEY in .dev.vars"); process.exit(2); }
const qloo = makeQloo({ apiKey: vars.QLOO_API_KEY });
const SAME = process.env.SAME === "1", POP = process.env.POP === "1"; // POP: PLAN-3, the agent also sees popularity
// the model does not accept a forced tool choice (400 on the first run, before any result), so it gets the app's own
// tools and any other tool it calls answers that this replay only takes draft_outreach (PLAN.md, deviation 1)
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID || undefined, model: vars.MODEL || undefined });

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const BRANDS = read("docs/podcast-check/results-strict.json").rows.map((r) => r.brand);
const ADS = new Map(Object.entries(read("src/data/podcast-sponsors.json").shows).map(([name, brands]) => [norm(name), brands]));
const CAT_OF = new Map(Object.entries(read("src/data/categories.json").categories).flatMap(([c, bs]) => bs.map((b) => [norm(b), c])));

const rows = [];
mkdirSync(".results", { recursive: true });
for (const brand of BRANDS) {
  const row = { brand, category: CAT_OF.get(norm(brand)) || null };
  try {
    const hit = (await qloo.search({ query: brand, types: "urn:entity:brand", take: 5 })).find((h) => norm(h.name) === norm(brand));
    if (!hit) { row.skipped = "no exact Qloo match"; rows.push(row); continue; }
    const raw = await qloo.insights({ filter_type: "urn:entity:podcast", entity_ids: [hit.entity_id], take: 20 });
    const all20 = raw.map((s) => {
      const all = ADS.get(norm(s.name)) ?? null;
      const masked = all ? all.filter((b) => norm(b) !== norm(brand)) : null; // the answer, hidden
      return { name: s.name, affinity: s.affinity, popularity: s.popularity ?? 0, advertisers: masked,
        rivals: masked ? masked.filter((b) => CAT_OF.get(norm(b)) === row.category) : null, truth: !!all?.some((b) => norm(b) === norm(brand)),
        about: s.description || "", tags: Array.isArray(s.tags) ? s.tags.slice(0, 4) : [] };
    });
    // PLAN-2: one list for every policy, the shows we have ad data for
    const shows = SAME ? all20.filter((s) => s.advertisers) : all20;
    if (!shows.some((s) => s.advertisers)) { row.skipped = "no show in the ad data"; rows.push(row); continue; }

    // the agent's step, as the app runs it (src/worker.js actions.podcasts), with the brand's name left out
    const forModel = { category: row.category, shows: shows.map((x) => ({ name: x.name, ...(SAME ? { about: String(x.about).slice(0, 160), tags: x.tags } : {}), taste_fit: Math.round(x.affinity * 1000) / 1000, ...(POP ? { popularity: Math.round((Number(x.popularity) || 0) * 1000) / 1000 } : {}),
      advertisers_found: x.advertisers ? x.advertisers.length : "not in our data", sample_advertisers: (x.advertisers || []).slice(0, 6),
      category_brands_found: x.rivals ?? "unknown" })) };
    const messages = [
      { role: "user", content: `Product: a ${row.category} product (the brand's name is withheld)\nMarket: United States\nReference brands or competitors (optional): none` },
      { role: "assistant", content: [{ type: "tool_use", id: "pods_1", name: "podcasts", input: { entity_ids: [hit.entity_id], category: row.category } }] },
      { role: "tool", results: [{ id: "pods_1", content: JSON.stringify(forModel) }] },
    ];
    let call = null, turns = 0;
    while (!call && turns < 4) {
      const res = await llm(messages);
      turns++;
      call = res.calls.find((c) => c.name === "draft_outreach") || null;
      if (call || !res.calls.length) break;
      messages.push({ role: "assistant", content: res.raw });
      messages.push({ role: "tool", results: res.calls.map((c) => ({ id: c.id, content: JSON.stringify({ error: "not available in this replay: choose the shows to ask first now, with draft_outreach" }) })) });
    }
    row.model_turns = turns;
    if (!call) throw new Error("the model never called draft_outreach");
    const A = [...new Set((call?.input?.shows || []).map((n) => shows.find((s) => norm(s.name) === norm(n))).filter(Boolean))].slice(0, 3);
    const inData = shows.filter((s) => s.advertisers);
    const R = askFirst(shows).shows;
    const T = [...inData].sort((a, b) => b.affinity - a.affinity).slice(0, 3);
    const P = [...inData].sort((a, b) => b.popularity - a.popularity).slice(0, 3);
    const score = (picks) => ({ shows: picks.map((s) => s.name), hits: picks.filter((s) => s.truth).length, outside_data: picks.filter((s) => !s.advertisers).length });
    Object.assign(row, { answers_in_list: shows.filter((s) => s.truth).length, A: score(A), R: score(R), T: score(T), P: score(P),
      same_as_rule: A.length === R.length && A.every((s) => R.includes(s)), reason: String(call?.input?.reason || "").slice(0, 300) });
  } catch (e) {
    row.error = String(e.message || e);
  }
  rows.push(row);
  writeFileSync(POP ? ".results/agent-vs-rule-pop-partial.json" : SAME ? ".results/agent-vs-rule-same-partial.json" : ".results/agent-vs-rule-partial.json", JSON.stringify(rows, null, 1));
  console.log(brand, row.skipped || row.error || `A ${row.A.hits} R ${row.R.hits} T ${row.T.hits} P ${row.P.hits}${row.same_as_rule ? " same" : ""}`);
}

// paired bootstrap over brands, seed 1
let seed = 1;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ok = rows.filter((r) => r.A);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const diff = (k) => {
  const d = ok.map((r) => r.A.hits - r[k].hits), boots = [];
  for (let i = 0; i < 10000; i++) { let s = 0; for (let j = 0; j < d.length; j++) s += d[Math.floor(rand() * d.length)]; boots.push(s / d.length); }
  boots.sort((a, b) => a - b);
  return { mean: +mean(d).toFixed(3), ci95: [+boots[249].toFixed(3), +boots[9749].toFixed(3)], agent_more: d.filter((x) => x > 0).length, other_more: d.filter((x) => x < 0).length, ties: d.filter((x) => x === 0).length };
};
const per = (k) => ({ hits: ok.reduce((a, r) => a + r[k].hits, 0), mean_hits: +mean(ok.map((r) => r[k].hits)).toFixed(3), picks_outside_data: ok.reduce((a, r) => a + r[k].outside_data, 0) });
const res = {
  run_at: new Date().toISOString(), model: vars.MODEL || "claude-sonnet-5-5", plan: POP ? "docs/agent-vs-rule/PLAN-3.md" : SAME ? "docs/agent-vs-rule/PLAN-2.md" : "docs/agent-vs-rule/PLAN.md",
  brands: BRANDS.length, compared: ok.length, skipped: rows.filter((r) => r.skipped).map((r) => ({ brand: r.brand, why: r.skipped })), errors: rows.filter((r) => r.error).map((r) => ({ brand: r.brand, error: r.error })),
  answers_in_lists: ok.reduce((a, r) => a + r.answers_in_list, 0),
  policies: { agent: per("A"), rule: per("R"), taste: per("T"), popularity: per("P") },
  agent_minus_rule: diff("R"), agent_minus_taste: diff("T"), agent_minus_popularity: diff("P"),
  same_three_as_rule: ok.filter((r) => r.same_as_rule).length,
  rows: rows.map(({ answers_in_list, ...r }) => r),
};
writeFileSync(POP ? "docs/agent-vs-rule/results-pop.json" : SAME ? "docs/agent-vs-rule/results-same.json" : "docs/agent-vs-rule/results.json", JSON.stringify(res, null, 1));
console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
