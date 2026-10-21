// Both checks on the same picks: an interest is "usable and on target" only if Meta can target it as named
// (docs/benchmark/meta-targeting.json) AND it scores 0.9+ on Qloo for the held-out competitor's audience in that city.
// Uses the exact names saved by benchmark-meta.mjs, so all three lists are graded on identical picks.
// Run: node --env-file=.dev.vars scripts/benchmark-combined.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { gradePicks } from "../src/grade.js";
import { HELD_OUT } from "./benchmark-heldout-map.mjs";

const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const meta = JSON.parse(readFileSync("docs/benchmark/meta-targeting.json", "utf8"));
const norm = (s) => String(s || "").toLowerCase();
const LISTS = ["taste_brief", "named_baseline", "app_baseline"];

const out = [];
for (const r of meta.per_case) {
  const heldName = HELD_OUT[r.reference];
  const hits = await qloo.search({ query: heldName, take: 5 });
  const held = hits.find((e) => norm(e.name) === norm(heldName) && /brand/.test(e.type || "")) || hits.find((e) => /brand/.test(e.type || ""));
  if (!held) { console.log(`${r.product}: no held-out brand`); continue; }
  const row = { product: r.product, market: r.market, reference: r.reference, held_out: held.name };
  for (const k of LISTS) {
    const names = r[k].map((c) => c.name).filter((n) => norm(n) !== norm(held.name));
    const graded = await gradePicks(qloo, names, [held.entity_id], r.market);
    const aff = new Map(graded.map((g) => [g.name, g.affinity]));
    const metaOk = new Map(r[k].map((c) => [c.name, c.status === "targetable"]));
    row[k] = names.map((n) => ({ name: n, targetable: !!metaOk.get(n), affinity: aff.get(n) ?? null }));
  }
  out.push(row);
  const f = (xs) => `${xs.filter((x) => x.targetable && x.affinity >= 0.9).length}/${xs.length}`;
  console.log(`${r.product} / ${r.market} (${held.name}): Taste Brief ${f(row.taste_brief)} | named ${f(row.named_baseline)} | app ${f(row.app_baseline)}`);
}

const sum = (k) => {
  const xs = out.flatMap((r) => r[k]);
  const c = (p) => xs.filter(p).length;
  return { picks: xs.length, targetable: c((x) => x.targetable), high_on_qloo: c((x) => x.affinity >= 0.9),
    both: c((x) => x.targetable && x.affinity >= 0.9), share_both: xs.length ? c((x) => x.targetable && x.affinity >= 0.9) / xs.length : 0 };
};
const share = (xs) => (xs.length ? xs.filter((x) => x.targetable && x.affinity >= 0.9).length / xs.length : 0);
const diffs = out.map((r) => share(r.taste_brief) - share(r.named_baseline));
let s = 7; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const means = []; for (let i = 0; i < 10000; i++) { let t = 0; for (let j = 0; j < diffs.length; j++) t += diffs[Math.floor(rnd() * diffs.length)]; means.push(t / diffs.length); }
means.sort((a, b) => a - b);
const result = {
  run_at: new Date().toISOString(), cases: out.length,
  rule: "targetable in Meta Ads under that name AND Qloo affinity 0.9+ for a held-out competitor's audience in the same city",
  taste_brief: sum("taste_brief"), named_entity_baseline: sum("named_baseline"), app_baseline: sum("app_baseline"),
  vs_named_baseline: { mean_difference: diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1), ci95: [means[250], means[9750]],
    taste_brief_ahead: diffs.filter((d) => d > 0).length, ties: diffs.filter((d) => d === 0).length },
  per_case: out,
};
writeFileSync("docs/benchmark/combined.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify({ tb: result.taste_brief, named: result.named_entity_baseline, app: result.app_baseline, vs: result.vs_named_baseline }, null, 1));
