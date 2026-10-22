import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE, canonicalPlan, planHash, adSetRows, toCsv, parseCsv, readResults, verdicts, num, problemWith, creativeOf } from "../public/verdict.js";

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
  assert.match(toCsv(rows).split("\n")[0], /^ad_set,changes,targeting,creative,ages,optimization,placements,budget,schedule,attribution$/);
  assert.equal(rows[2].creative, "Materials story", "a creative test without 'creative:' uses its hypothesis");
  assert.equal(creativeOf({ ad_set: "Broad New York audience, new creative: 'Run in the morning.'" }), "'Run in the morning.'");
});

test("results: exact column names win, European numbers and semicolons are read, problems are named", () => {
  const csv = `"Ad set name";"Adds to cart conversion value";"Adds to cart";"Amount spent (EUR)"
"TB-abc123de Control";"1.900,00";"25";"250,00"
"TB-abc123de Test 1";"1.500,00";"30";"1.040,00"`;
  const arms = readResults(parseCsv(csv), "abc123de");
  assert.equal(arms.Control.addsToCart, 25, "the conversion value column is not the count");
  assert.equal(arms["Test 1"].spend, 1040);
  assert.equal(num("1,040.00"), 1040); assert.equal(num("1 040,50"), 1040.5); assert.equal(num("300"), 300);
  assert.match(problemWith(parseCsv(""), "abc123de"), /no rows/);
  assert.match(problemWith(parseCsv("a,b\n1,2"), "abc123de"), /Ad set name column/);
  assert.match(problemWith(parseCsv('"Ad set name","Adds to cart"\n"TB-ffff0000 Control","3"'), "abc123de"), /another plan/);
  assert.match(problemWith(parseCsv('"Ad set name","Adds to cart","Amount spent"\n"TB-abc123de Control","3","20"'), "abc123de"), /only the control/);
  assert.equal(problemWith(parseCsv(csv), "abc123de"), null);
  assert.equal(num("1.280"), 1280, "European thousands without decimals");
  assert.match(problemWith(parseCsv(`"Ad set name","Adds to cart"
"TB-abc123de Control","3"
"TB-abc123de Test 1","4"`), "abc123de"), /Amount spent column/);
  const meta = parseCsv(`"Ad set name","Result indicator","Results","Amount spent (USD)"
"TB-abc123de Control","actions:offsite_conversion.fb_pixel_add_to_cart","25","250"
"TB-abc123de Test 1","actions:offsite_conversion.fb_pixel_add_to_cart","30","240"
"TB-abc123de Test 9","x","99","10"`);
  const got = readResults(meta, "abc123de", ["Control", "Test 1", "Test 2"]);
  assert.deepEqual(Object.keys(got).sort(), ["Control", "Test 1"], "ad sets outside the plan are left out");
  assert.equal(got["Test 1"].addsToCart, 30, "Meta's Results column counts when the indicator is add to cart");
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
  assert.equal(verdicts({ Control: { spend: 200, addsToCart: 20 }, "Test 1": { spend: 196, addsToCart: 20 } })[0].verdict, "no clear difference", "2% cheaper is not ahead");
});

test("verdict: a targeting test that names an interest Meta lacks is never ready, and is left out of the lock", async () => {
  const { missingInMeta, readyTests } = await import("../public/verdict.js");
  const meta = { taste_brief: [{ name: "Outdoor Voices", status: "not_found" }, { name: "Bombas", status: "targetable" }] };
  const tests = [
    { variable: "targeting", ad_set: "Usual creative, interests Bombas and Outdoor Voices" },
    { variable: "targeting", ad_set: "Usual creative, interests Bombas" },
    { variable: "creative", ad_set: "Broad audience; a creative about Outdoor Voices fans" },
  ];
  assert.deepEqual(missingInMeta(tests[0], meta), ["Outdoor Voices"]);
  assert.deepEqual(missingInMeta(tests[2], meta), [], "a creative test names no interest to target");
  assert.deepEqual(readyTests(tests, meta).map((t) => t.ad_set), [tests[1].ad_set, tests[2].ad_set]);
  assert.equal(readyTests(tests, null).length, 3, "without a Meta check nothing is held back");
});
