// With Qloo or without? 20 briefs, each written twice by the same model: once by the Taste Brief agent (Qloo tools), once
// as a plain answer with no data. Every Meta interest from both is graded the same way, by src/grade.js: find the entity
// in Qloo by exact name, then ask Qloo how much the seed brand's audience in that market likes it. No model grades.
// Limits, stated in the output too: the grader is Qloo itself, so for Taste Brief's picks it is partly circular; it shows
// how far each pick is from Qloo's view of the audience, not ad performance.
// Run: node --env-file=.dev.vars scripts/benchmark.mjs   (live keys needed; writes .results/benchmark-*.json and
// docs/benchmark/summary.json with aggregates only, no raw Qloo responses)
import { mkdirSync, writeFileSync } from "node:fs";
import { runAgent, runBaseline, BASELINE_SYSTEM, TOOLS } from "../src/agent.js";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { gradePicks, summarize } from "../src/grade.js";

export const CASES = [
  ["Wool running sneakers, $120, sustainable", "London, UK", "Allbirds"],
  ["Wool running sneakers, $120, sustainable", "New York, USA", "Allbirds"],
  ["Specialty coffee subscription, $25 a month", "Seoul, South Korea", "Blue Bottle Coffee"],
  ["Turntable for first time vinyl buyers, $199", "Berlin, Germany", "Audio-Technica"],
  ["Plant based protein bars", "Los Angeles, USA", "RXBAR"],
  ["Flavored sparkling water", "Chicago, USA", "LaCroix"],
  ["Affordable skincare serum, $15", "Paris, France", "The Ordinary"],
  ["Yoga leggings", "Sydney, Australia", "Lululemon"],
  ["Hard seltzer", "Austin, USA", "White Claw"],
  ["Hazy IPA craft beer", "Portland, USA", "Sierra Nevada"],
  ["Language learning app subscription", "Mexico City, Mexico", "Duolingo"],
  ["Meal kit delivery", "Toronto, Canada", "HelloFresh"],
  ["Streetwear hoodies, limited drops", "Tokyo, Japan", "Supreme"],
  ["Party card game for adults", "London, UK", "Exploding Kittens"],
  ["Natural deodorant", "Melbourne, Australia", "Native"],
  ["Recycled outdoor jacket", "Denver, USA", "Patagonia"],
  ["Noise cancelling headphones", "Singapore", "Sony"],
  ["Matcha latte powder", "Los Angeles, USA", "Starbucks"],
  ["Minimalist leather wallet", "Amsterdam, Netherlands", "Bellroy"],
  ["Indie horror video game", "Seattle, USA", "Steam"],
];

const pct = (a, b) => (b ? a / b : 0);
function bootstrap(diffs, n = 10000) {
  if (!diffs.length) return null;
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const means = [];
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rnd() * diffs.length)]; means.push(s / diffs.length); }
  means.sort((x, y) => x - y);
  return [means[Math.floor(n * 0.025)], means[Math.floor(n * 0.975)]];
}

async function main() {
  const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
  const key = { apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID };
  const only = process.argv[2] ? Number(process.argv[2]) : CASES.length;
  const rows = [];
  for (const [product, market, references] of CASES.slice(0, only)) {
    const t0 = Date.now();
    try {
      const llm = anthropicLLM(key);
      const baseLLM = anthropicLLM({ ...key, system: BASELINE_SYSTEM, tools: TOOLS.filter((t) => t.name === "submit_brief") });
      const [out, base] = await Promise.all([runAgent({ llm, qloo, product, market, references }), runBaseline({ llm: baseLLM, product, market, references })]);
      const seedNames = new Set(out.seeds.map((id) => out.registry.find((e) => e.entity_id === id)?.name?.toLowerCase()).filter(Boolean));
      const pick = (b) => (b.meta_interests || []).map((i) => String(i?.interest || "").trim()).filter((n) => n && !seedNames.has(n.toLowerCase().replace(/\s*\(check in ads manager\)\s*/i, "")));
      const [withQ, without] = [pick(out.brief), pick(base)];
      const [gW, gP] = [await gradePicks(qloo, withQ, out.seeds, market), await gradePicks(qloo, without, out.seeds, market)];
      const row = { product, market, references, seeds: [...seedNames], seconds: Math.round((Date.now() - t0) / 1000),
        taste_brief: { graded: gW, ...summarize(gW) }, plain: { graded: gP, ...summarize(gP) },
        overlap: withQ.filter((n) => without.some((m) => m.toLowerCase() === n.toLowerCase())).length };
      rows.push(row);
      const f = (s) => `${s.high}/${s.picks} at 0.9+, ${s.checkable} checkable, mean ${s.mean_affinity?.toFixed(3) ?? "n/a"}`;
      console.log(`${product} / ${market}: Taste Brief ${f(row.taste_brief)} | plain ${f(row.plain)} | ${row.seconds}s`);
    } catch (e) {
      console.log(`${product} / ${market}: FAILED ${String(e.message || e).slice(0, 200)}`);
      rows.push({ product, market, references, error: String(e.message || e) });
    }
  }
  const ok = rows.filter((r) => !r.error);
  const sum = (k, f) => ok.reduce((s, r) => s + f(r[k]), 0);
  const agg = (k) => ({ picks: sum(k, (s) => s.picks), checkable: sum(k, (s) => s.checkable), high: sum(k, (s) => s.high),
    mean_affinity_of_checkable: (() => { const all = ok.flatMap((r) => r[k].graded.filter((g) => g.status === "scored").map((g) => g.affinity)); return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null; })() });
  const A = agg("taste_brief"), P = agg("plain");
  const diffs = ok.map((r) => pct(r.taste_brief.high, r.taste_brief.picks) - pct(r.plain.high, r.plain.picks));
  const summary = {
    run_at: new Date().toISOString(), cases: rows.length, completed: ok.length, model: "claude-sonnet-5-5 (same for both)",
    grader: "Qloo insights restricted to the named entity, seed brand audience, market as location; exact name match in Qloo search",
    taste_brief: { ...A, share_checkable: pct(A.checkable, A.picks), share_high: pct(A.high, A.picks) },
    plain_model: { ...P, share_checkable: pct(P.checkable, P.picks), share_high: pct(P.high, P.picks) },
    per_case_share_high_difference: { mean: diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1), ci95: bootstrap(diffs) },
    cases_where_taste_brief_has_more_high: ok.filter((r) => pct(r.taste_brief.high, r.taste_brief.picks) > pct(r.plain.high, r.plain.picks)).length,
    picks_in_both_lists: ok.reduce((s, r) => s + r.overlap, 0),
    limits: "Graded by Qloo, so partly circular for Taste Brief's picks, which come from Qloo results. It measures distance from Qloo's view of the audience, not ad performance. Generic picks such as 'Running' cannot be checked and count as not high.",
    per_case: ok.map((r) => ({ product: r.product, market: r.market, taste_brief: { picks: r.taste_brief.picks, checkable: r.taste_brief.checkable, high: r.taste_brief.high },
      plain: { picks: r.plain.picks, checkable: r.plain.checkable, high: r.plain.high } })),
    failed: rows.filter((r) => r.error).map((r) => ({ product: r.product, market: r.market, error: r.error.slice(0, 160) })),
  };
  mkdirSync(".results", { recursive: true }); mkdirSync("docs/benchmark", { recursive: true });
  writeFileSync(`.results/benchmark-${summary.run_at.slice(0, 16).replace(/[:T]/g, "-")}.json`, JSON.stringify({ summary, rows }, null, 1));
  writeFileSync("docs/benchmark/summary.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ taste_brief: summary.taste_brief, plain_model: summary.plain_model, diff: summary.per_case_share_high_difference, wins: summary.cases_where_taste_brief_has_more_high }, null, 1));
}

// run only when called directly, not when benchmark-strong.mjs imports CASES
if (/[\\/]benchmark\.mjs$/.test(process.argv[1] || "")) await main();
