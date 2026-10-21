import { test } from "node:test";
import assert from "node:assert/strict";
import { matchInterest, summarizeMeta, makeMeta } from "../src/meta.js";

const results = [
  { id: "1", name: "Tracksmith", audience_size_lower_bound: 120000, audience_size_upper_bound: 141000, path: ["Interests", "Shopping"] },
  { id: "2", name: "Running", audience_size_lower_bound: 300000000, audience_size_upper_bound: 352800000 },
];

test("meta: an interest counts only when Meta has one with the same name", () => {
  const ok = matchInterest("tracksmith", results);
  assert.equal(ok.status, "targetable");
  assert.deepEqual(ok.audience, [120000, 141000]);
  const miss = matchInterest("Tracksmith Running Club", results);
  assert.equal(miss.status, "not_found");
  assert.deepEqual(miss.nearest, ["Tracksmith", "Running"]);
  assert.equal(matchInterest("Running (check in Ads Manager)", results).status, "targetable");
  assert.equal(matchInterest("Peloton", [{ id: "3", name: "Peloton (cycling)" }]).status, "targetable");
  assert.equal(matchInterest("Nike", [{ id: "4", name: "Nike, Inc." }]).status, "targetable");
});

test("meta: summary counts targetable picks and the median audience", () => {
  const s = summarizeMeta([matchInterest("Tracksmith", results), matchInterest("Running", results), matchInterest("Nope", results)]);
  assert.equal(s.targetable, 2);
  assert.equal(s.picks, 3);
  assert.equal(s.median_audience_upper, (141000 + 352800000) / 2);
});

test("meta: the token goes in a header, not the URL", async () => {
  let seen;
  const search = makeMeta({ token: "T0K", minGapMs: 0, fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ data: results }) }; } });
  assert.equal((await search("Tracksmith")).length, 2);
  assert.ok(!seen.url.includes("T0K"));
  assert.equal(seen.init.headers.Authorization, "Bearer T0K");
});
