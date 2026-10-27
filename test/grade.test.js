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

test("parallel grading preserves input identity/order and shares duplicate lookups", async () => {
  const releases = new Map(), started = [];
  const delayed = {
    search: ({ query }) => new Promise((resolve) => { started.push(query); releases.set(query, resolve); }),
    insights: async ({ result_ids }) => result_ids.map((entity_id) => ({ entity_id, affinity: 0.92 })),
  };
  const result = gradePicks(delayed, ["Strava", "Tracksmith", "Strava", "Missing"], ["seed"], "London");
  assert.deepEqual(started, ["Strava", "Tracksmith", "Missing"]);
  releases.get("Missing")([]);
  releases.get("Tracksmith")([DB.tracksmith]);
  releases.get("Strava")([DB.strava]);
  const rows = await result;
  assert.deepEqual(rows.map((x) => x.name), ["Strava", "Tracksmith", "Strava", "Missing"]);
  assert.deepEqual(rows.map((x) => x.match?.entity_id), ["S", "T", "S", undefined]);
  assert.deepEqual(rows.map((x) => x.status), ["scored", "scored", "scored", "no_match"]);
});

test("grader: candidates split 'A or B', exact names only, and each pick ends scored, not found or not scored", async () => {
  assert.deepEqual(candidates("Veja or On Running"), ["Veja or On Running", "Veja", "On Running"]);
  assert.equal((await resolvePick(qloo, "Parkrun")), null, "a place in Poland is not the parkrun interest");
  const g = await gradePicks(qloo, ["Strava", "Tracksmith", "Veja or On Running", "Running"], ["SEED"], "London");
  assert.deepEqual(g.map((x) => x.status), ["scored", "scored", "no_score", "no_match"]);
  assert.deepEqual(summarize(g), { picks: 4, checkable: 2, mean_affinity: (0.85 + 0.922) / 2, high: 1 });
});
