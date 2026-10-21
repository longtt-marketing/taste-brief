// The stronger baseline for scripts/benchmark.mjs: the same model, still with no data, but told to name specific brands,
// artists, shows, podcasts or places (as Taste Brief does), not categories. Graded by the same Qloo grader against the
// same seed brand and market. It answers the fair objection: "the plain answer only lost because it named categories".
// Run after benchmark.mjs: node --env-file=.dev.vars scripts/benchmark-strong.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { gradePicks, summarize } from "../src/grade.js";
import { CASES } from "./benchmark.mjs";

const SYSTEM = `You are a senior paid social strategist with no data access. Name the Meta Ads interests you would test for
this product's audience. Use only specific, named entities: brands, artists, TV shows, films, podcasts, books or places.
No generic categories such as "Running" or "Sustainable fashion", and not the reference brand itself. Call submit_interests
with 7 names.`;
const TOOL = [{ name: "submit_interests", description: "Submit the interests.", strict: true,
  input_schema: { type: "object", properties: { interests: { type: "array", items: { type: "string" } } }, required: ["interests"], additionalProperties: false } }];

const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const llm = anthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID, system: SYSTEM, tools: TOOL });
const summary = JSON.parse(readFileSync("docs/benchmark/summary.json", "utf8"));
const rows = [];
for (const [product, market, references] of CASES) {
  const seed = (await qloo.search({ query: references, take: 3 })).find((e) => e.name?.toLowerCase() === references.toLowerCase())
    || (await qloo.search({ query: references, take: 1 }))[0];
  let names = [];
  for (let i = 0; i < 2 && !names.length; i++) {
    const turn = await llm([{ role: "user", content: `Product: ${product}\nMarket: ${market}\nReference brand: ${references}` }]);
    names = (turn.calls.find((c) => c.name === "submit_interests")?.input?.interests || [])
      .filter((n) => n && n.toLowerCase() !== references.toLowerCase()).slice(0, 10);
  }
  const g = await gradePicks(qloo, names, seed ? [seed.entity_id] : [], market);
  const s = summarize(g);
  rows.push({ product, market, ...s });
  console.log(`${product} / ${market}: named-entity plain ${s.high}/${s.picks} at 0.9+, ${s.checkable} checkable, mean ${s.mean_affinity?.toFixed(3) ?? "n/a"}`);
}
const tot = rows.reduce((a, r) => ({ picks: a.picks + r.picks, checkable: a.checkable + r.checkable, high: a.high + r.high }), { picks: 0, checkable: 0, high: 0 });
const scoredMeans = rows.filter((r) => r.mean_affinity != null);
summary.plain_model_named_entities = { ...tot, share_checkable: tot.checkable / tot.picks, share_high: tot.high / tot.picks,
  mean_affinity_of_checkable_cases_avg: scoredMeans.reduce((a, r) => a + r.mean_affinity, 0) / (scoredMeans.length || 1),
  per_case: rows.map(({ product, market, picks, checkable, high }) => ({ product, market, picks, checkable, high })),
  note: "Same model, no data, told to name specific entities; seed = the reference brand found in Qloo search." };
writeFileSync("docs/benchmark/summary.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.plain_model_named_entities, (k, v) => (k === "per_case" ? undefined : v), 1));
