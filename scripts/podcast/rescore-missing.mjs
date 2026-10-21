// Re-fetch Qloo scores for brands whose first fetch returned nothing at all (an API error swallowed by score.mjs's
// catch). Same batches, same call. Logs every error. Run on 21 Oct 2026 after the audit flagged Quince: no brand was
// missing outright; Quince has entries but no affinity because Qloo rejects it as a signal ("invalid signal"), so
// robustness.py lists it as unscorable and leaves it out.
// Run: node --env-file=.dev.vars scripts/podcast/rescore-missing.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeQloo } from "../../src/qloo.js";

const F = ".results/podcast/heldout-scores.json";
const S = JSON.parse(readFileSync(F, "utf8"));
const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const missing = S.brands.filter((b) => Object.keys(S.scores[b.name] || {}).length === 0);
console.log("brands with no scores:", missing.map((b) => b.name));
const log = [];
for (const b of missing) {
  S.scores[b.name] = {};
  for (const [bi, ids] of S.batches.entries()) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const list = await qloo.insights({ filter_type: "urn:entity:podcast", entity_ids: [b.id], result_ids: ids, take: ids.length });
        for (const x of list) S.scores[b.name][x.entity_id] = { affinity: x.affinity, batch: bi };
        break;
      } catch (e) { log.push({ brand: b.name, batch: bi, attempt, error: String(e).slice(0, 200) }); }
    }
  }
  console.log(b.name, "scored shows:", Object.keys(S.scores[b.name]).length);
}
S.rescored = { at: new Date().toISOString(), brands: missing.map((b) => b.name), errors: log };
writeFileSync(F, JSON.stringify(S, null, 1));
