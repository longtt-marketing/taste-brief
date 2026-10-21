// Negative control for the held-out benchmark. If affinity only tracked popularity, Taste Brief's picks would score
// 0.9+ for any audience. Here the same picks (names saved in docs/benchmark/meta-targeting.json) are graded twice in
// the same city: on the held-out competitor (same category) and on an unrelated brand, the held-out brand of the case
// ten places further on in the list (Allbirds briefs on Babbel, coffee on Stüssy, ...). The pairing was fixed before
// the run. Specific taste = high on the competitor, lower on the unrelated brand.
// Run: node --env-file=.dev.vars scripts/benchmark-negative.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { gradePicks, summarize } from "../src/grade.js";
import { HELD_OUT } from "./benchmark-heldout-map.mjs";

const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const meta = JSON.parse(readFileSync("docs/benchmark/meta-targeting.json", "utf8"));
const norm = (s) => String(s || "").toLowerCase();
const cases = meta.per_case;
const LISTS = ["taste_brief", "named_baseline"];

const brand = async (name) => {
  const hits = await qloo.search({ query: name, take: 5 });
  return hits.find((e) => norm(e.name) === norm(name) && /brand/.test(e.type || "")) || hits.find((e) => /brand/.test(e.type || ""));
};

const out = [];
for (let i = 0; i < cases.length; i++) {
  const r = cases[i];
  const [held, other] = [await brand(HELD_OUT[r.reference]), await brand(HELD_OUT[cases[(i + 10) % cases.length].reference])];
  if (!held || !other) { console.log(`${r.product}: brand not found`); continue; }
  const row = { product: r.product, market: r.market, reference: r.reference, held_out: held.name, unrelated: other.name };
  for (const k of LISTS) {
    const names = r[k].map((c) => c.name).filter((n) => ![held.name, other.name].map(norm).includes(norm(n)));
    row[k] = {
      held_out: summarize(await gradePicks(qloo, names, [held.entity_id], r.market)),
      unrelated: summarize(await gradePicks(qloo, names, [other.entity_id], r.market)),
    };
  }
  out.push(row);
  const f = (s) => `${s.high}/${s.picks}`;
  console.log(`${r.product} / ${r.market}: Taste Brief ${f(row.taste_brief.held_out)} on ${held.name} vs ${f(row.taste_brief.unrelated)} on ${other.name} | named ${f(row.named_baseline.held_out)} vs ${f(row.named_baseline.unrelated)}`);
}

const tot = (k, g) => out.reduce((a, r) => ({ picks: a.picks + r[k][g].picks, high: a.high + r[k][g].high }), { picks: 0, high: 0 });
const share = (s) => (s.picks ? s.high / s.picks : 0);
const diffs = out.map((r) => share(r.taste_brief.held_out) - share(r.taste_brief.unrelated));
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const means = []; for (let i = 0; i < 10000; i++) { let s = 0; for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(rnd() * diffs.length)]; means.push(s / diffs.length); }
means.sort((a, b) => a - b);
const result = {
  run_at: new Date().toISOString(), cases: out.length,
  design: "same picks graded on the held-out competitor and on an unrelated brand (held-out brand of case i+10), same city",
  taste_brief: { held_out: { ...tot("taste_brief", "held_out"), share_high: share(tot("taste_brief", "held_out")) }, unrelated: { ...tot("taste_brief", "unrelated"), share_high: share(tot("taste_brief", "unrelated")) } },
  named_entity_baseline: { held_out: { ...tot("named_baseline", "held_out"), share_high: share(tot("named_baseline", "held_out")) }, unrelated: { ...tot("named_baseline", "unrelated"), share_high: share(tot("named_baseline", "unrelated")) } },
  taste_brief_specificity: { mean_difference: diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1), ci95: [means[250], means[9750]],
    higher_on_competitor: diffs.filter((d) => d > 0).length, ties: diffs.filter((d) => d === 0).length },
  per_case: out,
};
writeFileSync("docs/benchmark/negative-control.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ tb: result.taste_brief, named: result.named_entity_baseline, spec: result.taste_brief_specificity }, null, 1));
