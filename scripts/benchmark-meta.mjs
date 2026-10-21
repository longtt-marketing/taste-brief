// The check that doesn't use Qloo as the grader: can each suggested interest be targeted in Meta Ads as named?
// Same 20 briefs as the other benchmarks (.results/benchmark-*.json): Taste Brief's picks and the app's no-data
// baseline's picks as saved, plus a fresh named-entity baseline (same prompt as benchmark-heldout.mjs; the names are saved
// here this time). Each name is looked up in Meta's interest search; it counts only if Meta has an interest with that name.
// Needs META_ACCESS_TOKEN (a user or Business Manager system user token with ads_read; no ad spend) and ANTHROPIC_API_KEY.
// Several env files can be passed: node --env-file=<file with META_ACCESS_TOKEN> --env-file=.dev.vars ...
// Run: node --env-file=.dev.vars scripts/benchmark-meta.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { anthropicLLM } from "../src/llm.js";
import { makeMeta, matchInterest, summarizeMeta } from "../src/meta.js";

const SYSTEM = `You are a senior paid social strategist with no data access. Name the Meta Ads interests you would test for
this product's audience. Use only specific, named entities: brands, artists, TV shows, films, podcasts, books or places.
No generic categories such as "Running" or "Sustainable fashion", and not the reference brand itself. Call submit_interests
with 7 names.`;
const TOOL = [{ name: "submit_interests", description: "Submit the interests.", strict: true,
  input_schema: { type: "object", properties: { interests: { type: "array", items: { type: "string" } } }, required: ["interests"], additionalProperties: false } }];

if (!process.env.META_ACCESS_TOKEN) { console.error("META_ACCESS_TOKEN missing in .dev.vars"); process.exit(1); }
const search = makeMeta({ token: process.env.META_ACCESS_TOKEN, version: process.env.META_API_VERSION || "v26.0" });
const llm = anthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID, system: SYSTEM, tools: TOOL });
const last = readdirSync(".results").filter((f) => /^benchmark-\d/.test(f)).sort().at(-1);
const { rows } = JSON.parse(readFileSync(`.results/${last}`, "utf8"));
const norm = (s) => String(s || "").toLowerCase();

const check = async (names) => { const out = []; for (const n of names) out.push(matchInterest(n, await search(n))); return out; };

const out = [];
for (const r of rows.filter((x) => !x.error)) {
  const notRef = (names) => names.filter((n) => norm(n).replace(/\s*\(check in ads manager\)\s*/, "") !== norm(r.references));
  let named = [];
  for (let i = 0; i < 2 && !named.length; i++) {
    const turn = await llm([{ role: "user", content: `Product: ${r.product}\nMarket: ${r.market}\nReference brand: ${r.references}` }]);
    named = notRef(turn.calls.find((c) => c.name === "submit_interests")?.input?.interests || []).slice(0, 10);
  }
  const row = { product: r.product, market: r.market, reference: r.references,
    taste_brief: await check(notRef(r.taste_brief.graded.map((g) => g.name))),
    named_baseline: await check(named),
    app_baseline: await check(notRef(r.plain.graded.map((g) => g.name))) };
  out.push(row);
  const f = (c) => `${c.filter((x) => x.status === "targetable").length}/${c.length}`;
  console.log(`${r.product} / ${r.market}: Taste Brief ${f(row.taste_brief)} | named ${f(row.named_baseline)} | app ${f(row.app_baseline)}`);
}

const all = (k) => summarizeMeta(out.flatMap((r) => r[k]));
const result = {
  run_at: new Date().toISOString(), cases: out.length, picks_from: last,
  grader: "Meta Ads interest search (adinterest): the interest exists in Meta under the same name. Audience sizes are Meta's worldwide estimates.",
  taste_brief: all("taste_brief"), named_entity_baseline: all("named_baseline"), app_baseline: all("app_baseline"),
  per_case: out,
};
writeFileSync("docs/benchmark/meta-targeting.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ taste_brief: result.taste_brief, named: result.named_entity_baseline, app: result.app_baseline }, null, 1));
