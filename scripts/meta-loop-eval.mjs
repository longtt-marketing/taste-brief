// Does the Meta check inside the self-check make the test plan launchable? Plan: docs/meta-loop/PLAN.md, written first.
// 11 live agent runs (10 benchmark products + the page's example), the self-check with the Meta lookup on. First brief
// against final brief: targeting tests that name an interest Meta does not have, the share of interests in Meta, and
// the held-out Qloo fit as a guard. Keys from .dev.vars, never printed. Writes docs/meta-loop/results.json.
//   node scripts/meta-loop-eval.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
mkdirSync(".results", { recursive: true });
import { runAgent } from "../src/agent.js";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { makeSelfCheck } from "../src/selfcheck.js";
import { gradePicks, norm } from "../src/grade.js";
import { metaLookup } from "../src/worker.js";

const vars = {};
for (const line of (existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
  if (m && m[2]) vars[m[1]] = m[2];
}
if (!vars.QLOO_API_KEY || !vars.ANTHROPIC_API_KEY || !vars.META_ACCESS_TOKEN) { console.error("needs QLOO_API_KEY, ANTHROPIC_API_KEY and META_ACCESS_TOKEN in .dev.vars"); process.exit(2); }
const qloo = makeQloo({ apiKey: vars.QLOO_API_KEY });
const bench = JSON.parse(readFileSync("docs/benchmark/combined.json", "utf8")).per_case.slice(2, 12);
const cases = [...bench, { product: "Wool running sneakers, $120, sustainable", market: "New York, NY", reference: "Allbirds", held_out: null }];
const clean = (s) => String(s || "").replace(/\s*\(check in ads manager\)\s*/i, "").trim();
const list = (v) => (Array.isArray(v) ? v : []);
// the page's own test (public/index.html, testsCard): a targeting test names an interest when the whole name appears
const named = (text, name) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(String(text || ""));
const badTests = (brief, report) => {
  const missing = list(report?.picks).filter((p) => p.meta === "not_found").map((p) => p.name);
  return list(brief?.test_plan).filter((t) => t?.variable === "targeting" && missing.some((n) => named(t.ad_set, n))).length;
};
const inMeta = (report) => { const known = list(report?.picks).filter((p) => p.meta === "targetable" || p.meta === "not_found"); return known.length ? known.filter((p) => p.meta === "targetable").length / known.length : null; };

const rows = [];
for (const c of cases) {
  const row = { product: c.product, market: c.market, reference: c.reference, held_out: c.held_out };
  try {
    const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID || undefined, model: vars.MODEL || undefined });
    // keep the first brief: the agent hands each submitted brief to the check, in order
    const briefs = [];
    const inner = makeSelfCheck({ qloo, market: c.market, meta: metaLookup(vars) });
    const check = async (brief, ctx) => { briefs.push(brief); return inner(brief, ctx); };
    const out = await runAgent({ llm, qloo, product: c.product, market: c.market, references: c.reference, check });
    const sc = out.self_check;
    if (!sc || sc.error) throw new Error(sc?.error || "no self-check");
    const firstBrief = briefs[0], finalBrief = out.brief;
    Object.assign(row, { revised: sc.revised, rival: sc.final.rival?.name || null,
      first_not_in_meta: list(sc.first.not_in_meta), final_not_in_meta: list(sc.final.not_in_meta),
      first_in_meta_share: inMeta(sc.first), final_in_meta_share: inMeta(sc.final),
      first_bad_tests: badTests(firstBrief, sc.first), final_bad_tests: badTests(finalBrief, sc.final),
      final_targeting_tests: list(finalBrief?.test_plan).filter((t) => t?.variable === "targeting").length });
    if (c.held_out) {
      const hits = await qloo.search({ query: c.held_out, types: "urn:entity:brand", take: 5 });
      const ho = hits.find((h) => norm(h.name) === norm(c.held_out)) || hits[0];
      if (ho) {
        const known = new Map(out.registry.map((e) => [norm(e.name), e]));
        const share = (g) => g.length ? g.filter((x) => x.affinity != null && x.affinity >= 0.9).length / g.length : null;
        const first = sc.first.picks.map((p) => clean(p.name)), final = sc.final.picks.map((p) => clean(p.name));
        const gf = await gradePicks(qloo, first, [ho.entity_id], c.market, known);
        const gl = sc.revised ? await gradePicks(qloo, final, [ho.entity_id], c.market, known) : gf;
        Object.assign(row, { rival_is_held_out: norm(row.rival) === norm(ho.name), first_share_09: share(gf), final_share_09: share(gl) });
      }
    }
  } catch (e) {
    row.error = String(e.message || e);
  }
  rows.push(row);
  writeFileSync(".results/meta-loop-partial.json", JSON.stringify(rows, null, 1));
  console.log(new Date().toISOString().slice(11, 19), c.product, row.error || `revised ${row.revised} bad tests ${row.first_bad_tests} -> ${row.final_bad_tests} in Meta ${row.first_in_meta_share?.toFixed(2)} -> ${row.final_in_meta_share?.toFixed(2)}`);
}
const ok = rows.filter((r) => !r.error);
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null; };
const guard = ok.filter((r) => r.first_share_09 != null && !r.rival_is_held_out);
const res = {
  run_at: new Date().toISOString(), plan: "docs/meta-loop/PLAN.md", model: vars.MODEL || "app default",
  runs: ok.length, errors: rows.filter((r) => r.error).map((r) => ({ product: r.product, error: r.error })), revised: ok.filter((r) => r.revised).length,
  bad_tests: { first: ok.reduce((a, r) => a + r.first_bad_tests, 0), final: ok.reduce((a, r) => a + r.final_bad_tests, 0),
    runs_with_bad_final: ok.filter((r) => r.final_bad_tests > 0).length },
  in_meta_share: { first: mean(ok.map((r) => r.first_in_meta_share)), final: mean(ok.map((r) => r.final_in_meta_share)) },
  guard_share_09: { first: mean(guard.map((r) => r.first_share_09)), final: mean(guard.map((r) => r.final_share_09)), cases: guard.length },
  launchable: ok.length >= 10 && ok.filter((r) => r.final_bad_tests === 0).length >= 10,
  rows,
};
mkdirSync("docs/meta-loop", { recursive: true });
writeFileSync("docs/meta-loop/results.json", JSON.stringify(res, (k, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 : v), 1));
console.log(JSON.stringify({ ...res, rows: undefined }, null, 1));
