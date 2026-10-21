import { test } from "node:test";
import assert from "node:assert/strict";
import { candidates, resolvePick, gradePicks, summarize } from "../src/grade.js";

// a tiny fake Qloo: search by exact-ish name, insights restricted to the asked entity
const DB = { strava: { name: "Strava", entity_id: "S", type: "urn:entity:brand", aff: 0.85 },
  tracksmith: { name: "Tracksmith", entity_id: "T", type: "urn:entity:brand", aff: 0.922 },
  veja: { name: "Veja", entity_id: "V", type: "urn:entity:brand", aff: null },
  "parkrun zalew": { name: "parkrun Zalew Zyrardowski", entity_id: "P", type: "urn:entity:place", aff: 0.7 } };
const qloo = {
  search: async ({ query }) => Object.entries(DB).filter(([k]) => k.startsWith(query.toLowerCase())).map(([, v]) => v),
  insights: async ({ result_ids }) => Object.values(DB).filter((e) => result_ids.includes(e.entity_id) && e.aff != null).map((e) => ({ ...e, affinity: e.aff })),
};

test("grader: candidates split 'A or B', exact names only, and each pick ends scored, not found or not scored", async () => {
  assert.deepEqual(candidates("Veja or On Running"), ["Veja or On Running", "Veja", "On Running"]);
  assert.equal((await resolvePick(qloo, "Parkrun")), null, "a place in Poland is not the parkrun interest");
  const g = await gradePicks(qloo, ["Strava", "Tracksmith", "Veja or On Running", "Running"], ["SEED"], "London");
  assert.deepEqual(g.map((x) => x.status), ["scored", "scored", "no_score", "no_match"]);
  assert.deepEqual(summarize(g), { picks: 4, checkable: 2, mean_affinity: (0.85 + 0.922) / 2, high: 1 });
});
