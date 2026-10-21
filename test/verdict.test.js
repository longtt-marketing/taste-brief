import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE, canonicalPlan, planHash, adSetRows, toCsv, parseCsv, readResults, verdicts } from "../public/verdict.js";

const tests = [
  { variable: "targeting", hypothesis: "Minimalist running fans", ad_set: "Usual creative to Tracksmith fans", verified: [{ name: "Tracksmith" }, { name: "Outdoor Voices" }] },
  { variable: "creative", hypothesis: "Materials story", ad_set: "Materials and price story, broad audience", verified: [{ name: "Everlane" }] },
];

test("locking: the same plan hashes the same, any change to it changes the hash", async () => {
  const base = { product: "Wool sneakers", market: "London, UK", references: "Allbirds", tests, lockedAt: "2026-10-22T10:00:00.000Z" };
  const h1 = await planHash(canonicalPlan(base));
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(await planHash(canonicalPlan({ ...base })), h1);
  assert.notEqual(await planHash(canonicalPlan({ ...base, tests: [tests[0]] })), h1);
  assert.notEqual(await planHash(canonicalPlan({ ...base, rule: { ...RULE, worseBy: 0.5 } })), h1);
});

test("ad set sheet: a control plus one row per test, named with the plan id; targeting tests list the Qloo interests", () => {
  const rows = adSetRows({ market: "London, UK", tests, planId: "abc123de" });
  assert.deepEqual(rows.map((r) => r.ad_set), ["TB-abc123de Control", "TB-abc123de Test 1", "TB-abc123de Test 2"]);
  assert.match(rows[1].targeting, /Interests: Tracksmith; Outdoor Voices, London/);
  assert.equal(rows[2].targeting, "Broad, London");
  assert.match(toCsv(rows).split("\n")[0], /^ad_set,changes,targeting,creative,budget_cap$/);
});

test("results: an Ads Manager export is matched to the locked plan and judged by the locked rule", () => {
  const csv = `"Ad set name","Amount spent (GBP)","Adds to cart"
"TB-abc123de Control","250.00","25"
"TB-abc123de Test 1","240.00","30"
"TB-abc123de Test 2","290.00","21"
"TB-zzzz9999 Test 1","999","99"
"Someone else's ad set","50","5"`;
  const arms = readResults(parseCsv(csv), "abc123de");
  assert.deepEqual(Object.keys(arms).sort(), ["Control", "Test 1", "Test 2"]);
  const v = verdicts(arms);
  assert.equal(v[0].verdict, "ahead");                 // 8.00 vs 10.00 per add to cart
  assert.equal(v[1].verdict, "pause");                 // 13.81 vs 10.00: 38% above
});

test("results: hitting the cap before enough adds to cart is inconclusive, never a loss; too little spend keeps running", () => {
  assert.equal(verdicts({ Control: { spend: 300, addsToCart: 25 }, "Test 1": { spend: 300, addsToCart: 6 } })[0].verdict, "inconclusive");
  assert.equal(verdicts({ Control: { spend: 80, addsToCart: 8 }, "Test 1": { spend: 70, addsToCart: 5 } })[0].verdict, "keep running");
  assert.equal(verdicts({ Control: { spend: 200, addsToCart: 20 }, "Test 1": { spend: 220, addsToCart: 20 } })[0].verdict, "no clear difference");
  assert.equal(verdicts({ "Test 1": { spend: 100, addsToCart: 30 } })[0].verdict, "no control");
});
