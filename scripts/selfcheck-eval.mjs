// Does the agent's self-check improve its picks? For 10 benchmark cases (docs/benchmark/combined.json, cases 3 to 12),
// one live agent run each with the self-check on. Its first brief (before the check) and its final brief (after any
// rewrite) are both graded by Qloo on a third brand the agent never saw: the benchmark's held-out competitor, fixed on
// 21 Oct before this check existed. Cases where the agent's own rival is that same brand are reported apart.
// Keys from .dev.vars, never printed. Writes docs/selfcheck-eval.json (names and scores only).
//   node scripts/selfcheck-eval.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
mkdirSync(".results", { recursive: true });
import { runAgent } from "../src/agent.js";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { makeSelfCheck } from "../src/selfcheck.js";
import { gradePicks, norm } from "../src/grade.js";

const vars = {};
for (const line of (existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
  if (m && m[2]) vars[m[1]] = m[2];
}
if (!vars.QLOO_API_KEY || !vars.ANTHROPIC_API_KEY) { console.error("needs QLOO_API_KEY and ANTHROPIC_API_KEY in .dev.vars"); process.exit(2); }
const qloo = makeQloo({ apiKey: vars.QLOO_API_KEY });
const cases = JSON.parse(readFileSync("docs/benchmark/combined.json", "utf8")).per_case.slice(2, 12);
const clean = (s) => String(s || "").replace(/\s*\(check in ads manager\)\s*/i, "").trim();

const rows = [];
for (const c of cases) {
  const row = { product: c.product, market: c.market, reference: c.reference, held_out: c.held_out };
  try {
    const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID || undefined, model: vars.MODEL || undefined });
    const out = await runAgent({ llm, qloo, product: c.product, market: c.market, references: c.reference, check: makeSelfCheck({ qloo, market: c.market }) });
    const sc = out.self_check;
    if (!sc || sc.error) throw new Error(sc?.error || "no self-check");
    const hits = await qloo.search({ query: c.held_out, types: "urn:entity:brand", take: 5 });
    const ho = hits.find((h) => norm(h.name) === norm(c.held_out)) || hits[0];
    if (!ho) throw new Error("held-out brand not in Qloo");
    const known = new Map(out.registry.map((e) => [norm(e.name), e]));
    const first = sc.first.picks.map((p) => clean(p.name)), final = sc.final.picks.map((p) => clean(p.name));
    const grade = async (names) => (await gradePicks(qloo, names, [ho.entity_id], c.market, known)).map((g) => ({ name: g.name, affinity: g.affinity, status: g.status }));
    const gf = await grade(first);
    const changed = sc.revised;
    const gl = changed ? await grade(final) : gf;
    const share = (g) => g.length ? g.filter((x) => x.affinity != null && x.affinity >= 0.9).length / g.length : null;
    Object.assign(row, { rival: sc.final.rival?.name, rival_is_held_out: norm(sc.final.rival?.name) === norm(ho.name), revised: changed,
      first_weak: sc.first.weak, dropped: first.filter((n) => !final.includes(n)), added: final.filter((n) => !first.includes(n)),
      first_share_09: share(gf), final_share_09: share(gl), first: gf, final: gl });
  } catch (e) {
    row.error = String(e.message || e);
  }
  rows.push(row);
  writeFileSync(".results/selfcheck-eval-partial.json", JSON.stringify(rows, null, 1));
  console.log(new Date().toISOString().slice(11, 19), c.product, row.error || `revised ${row.revised} ${row.first_share_09?.toFixed(2)} -> ${row.final_share_09?.toFixed(2)} rival ${row.rival}`);
}
const ok = rows.filter((r) => !r.error), clean_rows = ok.filter((r) => !r.rival_is_held_out);
const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3) : null);
const res = {
  run_at: new Date().toISOString(),
  note: "First brief (before the self-check) and final brief (after any rewrite) graded by Qloo on the benchmark's held-out competitor in the same city: share of picks at affinity 0.9 or more. A brief that was not rewritten scores the same both times by construction. Exploratory, 10 cases.",
  runs: ok.length, revised: ok.filter((r) => r.revised).length, rival_is_held_out: ok.filter((r) => r.rival_is_held_out).length,
  share_09: { first: mean(clean_rows.map((r) => r.first_share_09)), final: mean(clean_rows.map((r) => r.final_share_09)), cases: clean_rows.length },
  revised_cases: ok.filter((r) => r.revised).map((r) => ({ product: r.product, dropped: r.dropped, added: r.added, first: r.first_share_09, final: r.final_share_09, rival_is_held_out: r.rival_is_held_out })),
  rows,
};
writeFileSync("docs/selfcheck-eval.json", JSON.stringify(res, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 1));
console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
