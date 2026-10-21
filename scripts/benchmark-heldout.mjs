// The less circular version of the benchmark. The agent wrote each brief from one reference brand (Allbirds, ...); here
// every list of picks is graded against the audience of a different competitor the agent never saw (Veja, ...), in the
// same city. Taste Brief's picks came from the reference brand's Qloo results, not the held-out brand's, so a high score
// here means the picks fit the category's audience, not only the signal they were drawn from.
// Uses the picks saved by the last benchmark.mjs run (.results/benchmark-*.json) and asks the same model again for the
// named-entity baseline. Run: node --env-file=.dev.vars scripts/benchmark-heldout.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { gradePicks, summarize } from "../src/grade.js";

// reference brand the agent saw -> held-out competitor used only for grading
export const HELD_OUT = {
  "Allbirds": "Veja", "Blue Bottle Coffee": "Intelligentsia Coffee", "Audio-Technica": "Sonos", "RXBAR": "Kind Snacks",
  "LaCroix": "Perrier", "The Ordinary": "CeraVe", "Lululemon": "Alo Yoga", "White Claw": "Truly Hard Seltzer",
  "Sierra Nevada": "Lagunitas Brewing Company", "Duolingo": "Babbel", "HelloFresh": "Blue Apron", "Supreme": "Stüssy",
  "Exploding Kittens": "Hasbro", "Native": "Schmidt's Naturals", "Patagonia": "The North Face", "Sony": "Bose Corporation",
  "Starbucks": "Dunkin' Donuts", "Bellroy": "Herschel Supply Co", "Steam": "Epic Games",
};

const SYSTEM = `You are a senior paid social strategist with no data access. Name the Meta Ads interests you would test for
this product's audience. Use only specific, named entities: brands, artists, TV shows, films, podcasts, books or places.
No generic categories such as "Running" or "Sustainable fashion", and not the reference brand itself. Call submit_interests
with 7 names.`;
const TOOL = [{ name: "submit_interests", description: "Submit the interests.", strict: true,
  input_schema: { type: "object", properties: { interests: { type: "array", items: { type: "string" } } }, required: ["interests"], additionalProperties: false } }];

const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const llm = anthropicLLM({ apiKey: process.env.ANTHROPIC_API_KEY, workspaceId: process.env.ANTHROPIC_WORKSPACE_ID, system: SYSTEM, tools: TOOL });
const last = readdirSync(".results").filter((f) => /^benchmark-\d/.test(f)).sort().at(-1);
const { rows } = JSON.parse(readFileSync(`.results/${last}`, "utf8"));
const norm = (s) => String(s || "").toLowerCase();

const out = [];
for (const r of rows.filter((x) => !x.error)) {
  const heldName = HELD_OUT[r.references];
  const hits = await qloo.search({ query: heldName, take: 5 });
  const held = hits.find((e) => norm(e.name) === norm(heldName) && /brand/.test(e.type || "")) || hits.find((e) => /brand/.test(e.type || ""));
  if (!held) { console.log(`${r.product} / ${r.market}: no held-out brand`); continue; }
  const exclude = new Set([norm(r.references), norm(heldName), norm(held.name)]);
  const keep = (names) => names.filter((n) => !exclude.has(norm(n).replace(/\s*\(check in ads manager\)\s*/, "")));
  const tbNames = keep(r.taste_brief.graded.map((g) => g.name));
  const plainNames = keep(r.plain.graded.map((g) => g.name));
  let strongNames = [];
  for (let i = 0; i < 2 && !strongNames.length; i++) {
    const turn = await llm([{ role: "user", content: `Product: ${r.product}\nMarket: ${r.market}\nReference brand: ${r.references}` }]);
    strongNames = keep(turn.calls.find((c) => c.name === "submit_interests")?.input?.interests || []).slice(0, 10);
  }
  const seed = [held.entity_id];
  const [tb, strong, plain] = [await gradePicks(qloo, tbNames, seed, r.market), await gradePicks(qloo, strongNames, seed, r.market), await gradePicks(qloo, plainNames, seed, r.market)];
  const row = { product: r.product, market: r.market, reference: r.references, held_out: held.name,
    taste_brief: summarize(tb), named_baseline: summarize(strong), app_baseline: summarize(plain) };
  out.push(row);
  const f = (s) => `${s.high}/${s.picks} at 0.9+ (${s.checkable} scored)`;
  console.log(`${r.product} / ${r.market} graded on ${held.name}: Taste Brief ${f(row.taste_brief)} | named baseline ${f(row.named_baseline)} | app baseline ${f(row.app_baseline)}`);
}

const tot = (k) => out.reduce((a, r) => ({ picks: a.picks + r[k].picks, checkable: a.checkable + r[k].checkable, high: a.high + r[k].high }), { picks: 0, checkable: 0, high: 0 });
const share = (s) => (s.picks ? s.high / s.picks : 0);
const diffs = out.map((r) => share(r.taste_brief) - share(r.named_baseline));
let seedR = 7; const rnd = () => ((seedR = (seedR * 1103515245 + 12345) % 2147483648) / 2147483648);
const means = []; for (let i = 0; i < 10000; i++) { let s = 0; for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rnd() * diffs.length)]; means.push(s / diffs.length); }
means.sort((a, b) => a - b);
const T = tot("taste_brief"), N = tot("named_baseline"), A = tot("app_baseline");
const result = {
  run_at: new Date().toISOString(), cases: out.length, picks_from: last,
  grader: "Qloo affinity for a held-out competitor's audience in the same city (the agent never saw that brand)",
  taste_brief: { ...T, share_high: share(T), share_checkable: T.checkable / T.picks },
  named_entity_baseline: { ...N, share_high: share(N), share_checkable: N.checkable / N.picks },
  app_baseline: { ...A, share_high: share(A), share_checkable: A.checkable / A.picks },
  vs_named_baseline: { mean_difference: diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1), ci95: [means[250], means[9750]],
    taste_brief_ahead: diffs.filter((d) => d > 0).length, ties: diffs.filter((d) => d === 0).length },
  per_case: out,
};
writeFileSync("docs/benchmark/heldout.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ taste_brief: result.taste_brief, named: result.named_entity_baseline, app: result.app_baseline, vs: result.vs_named_baseline }, null, 1));
