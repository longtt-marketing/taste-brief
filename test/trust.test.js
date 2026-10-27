import { test } from "node:test";
import assert from "node:assert/strict";
import * as verdict from "../public/verdict.js";
import * as rank from "../public/rank.js";
import { registryFrom, verifyItem } from "../src/evidence.js";

const everlane = { entity_id: "E", name: "Everlane", via: "insights", affinity: 0.75 };
const warby = { entity_id: "W", name: "Warby Parker", via: "insights", affinity: 0.82 };
const targeting = { variable: "targeting", grounded: true, hypothesis: "Test an audience", ad_set: "Interests: Everlane",
  entity_ids: ["E", "W"], targeting_entity_ids: ["E"], verified: [everlane, warby] };
const creative = verdict.reviewCreative({ variable: "creative", grounded: true, targeting_entity_ids: [], hypothesis: "Materials story",
  ad_set: "Broad audience. New creative: Materials story", verified: [everlane] }, { copy: "A materials story.", product: "", at: "2026-10-26T00:00:00Z" });
const meta = { taste_brief: [
  { name: "Everlane", status: "targetable", interest: { id: "123", name: "Everlane" } },
  { name: "Warby Parker", status: "not_found" },
] };

test("trust: terminal punctuation can match a verified Meta name, added words and ambiguous identities cannot", () => {
  const selected = { ...targeting, entity_ids: ["H"], targeting_entity_ids: ["H"], verified: [{ entity_id: "H", name: "Herschel Supply Co" }] };
  const checked = { taste_brief: [{ name: "Herschel Supply Co.", status: "targetable", interest: { id: "123", name: "Herschel Supply Co." } }] };
  assert.equal(verdict.readyTests([selected], checked).length, 1);
  assert.equal(verdict.readyTests([selected], { taste_brief: [{ ...checked.taste_brief[0], name: "Herschel Supply Co Media" }] }).length, 0);
  assert.equal(verdict.readyTests([selected], { taste_brief: [...checked.taste_brief, { ...checked.taste_brief[0], interest: { id: "456", name: "Herschel Supply Co" } }] }).length, 0);
});

test("trust: targeting fails closed on missing, errored, unknown or ID-less Meta checks", () => {
  for (const check of [null, { error: "expired" }, { taste_brief: [] },
    { taste_brief: [{ name: "Everlane", status: "unknown" }] },
    { taste_brief: [{ name: "Everlane", status: "targetable" }] }]) {
    assert.equal(verdict.readyTests([targeting, creative], check).length, 1);
    assert.equal(verdict.readyTests([targeting, creative], check)[0].variable, "creative");
  }
});

test("trust: only explicit verified targets reach the lock and exported sheet", () => {
  const ready = verdict.readyTests([targeting], meta);
  assert.equal(ready.length, 1);
  assert.deepEqual(ready[0].targets, [{ entity_id: "E", name: "Everlane", meta_id: "123", meta_name: "Everlane" }]);
  const saved = JSON.parse(verdict.canonicalPlan({ product: "Shoes", market: "London", tests: ready, lockedAt: "2026-10-26T00:00:00Z" }));
  const sheet = verdict.adSetRows({ market: saved.market, tests: saved.tests, planId: "abc", rule: saved.rule });
  assert.match(sheet[1].targeting, /Everlane/);
  assert.doesNotMatch(sheet[1].targeting, /Warby/);
  assert.equal(sheet[1].meta_interest_ids, "123");
  assert.equal(saved.tests[0].targets[0].meta_id, "123");
});

test("trust: legacy, uncited, unavailable and ungrounded targeting cannot be marked ready", () => {
  for (const candidate of [
    { ...targeting, targeting_entity_ids: undefined },
    { ...targeting, targeting_entity_ids: [] },
    { ...targeting, targeting_entity_ids: ["unknown"] },
    { ...targeting, targeting_entity_ids: ["W"] },
    { ...targeting, grounded: false },
    { ...targeting, grounded: undefined },
    { ...targeting, variable: "both" },
  ]) assert.equal(verdict.readyTests([candidate], meta).length, 0);
  assert.equal(verdict.readyTests([{ ...creative, targeting_entity_ids: ["E"] }], meta).length, 0);
});

test("trust: exporting an unprepared targeting test is rejected instead of guessing", () => {
  assert.throws(() => verdict.adSetRows({ market: "London", tests: [targeting], planId: "abc" }), /verified targeting/);
});

test("trust: false numeric claims cannot pass by changing decimal or percentage notation", () => {
  const registry = registryFrom([{ tool: "insights", input: { entity_ids: ["seed"] }, output: [everlane] }]);
  const check = (value) => verifyItem("meta_interests", { interest: "Everlane", entity_ids: ["E"], evidence: [`Qloo affinity ${value}`] }, registry);
  for (const value of ["0.99", "99%", "99 %", "0.9900", ".99", "9.9e-1", "1.00", "99"]) {
    assert.equal(check(value).grounded, false, value);
  }
  for (const value of ["0.75", "0.7500", "75%", "7.5e-1"]) assert.equal(check(value).grounded, true, value);
});

test("trust: missing sponsor data stays unknown in a mixed shortlist", () => {
  const shows = [{ name: "Known", advertisers: ["Brand"], rivals: [] }, { name: "Unknown", advertisers: null, rivals: null }];
  const summary = rank.shortlistEvidence(shows, "drinks");
  assert.equal(summary.adsFound, 1);
  assert.equal(summary.adsUnknown, 1);
  assert.match(summary.text, /1 of 2/);
  assert.match(summary.text, /unknown/i);
  assert.doesNotMatch(summary.text, /They sell ads|no drinks brand was found/);
  assert.equal(rank.sponsorEvidence({ advertisers: ["Brand"], rivals: null }).category, "unknown");
});

test("trust: an agent superset is not falsely described as the same three as the rule", () => {
  const shared = { name: "Known seller" }, added = { name: "Unknown seller" };
  const comparison = rank.compareShortlists([shared, added], [shared]);
  assert.equal(comparison.same, false);
  assert.deepEqual(comparison.added, ["Unknown seller"]);
  assert.match(comparison.text, /selects 1 show/);
  assert.match(comparison.text, /adds Unknown seller/);
  assert.equal(rank.compareShortlists([shared, added], [added, shared]).same, true);
});

test("trust: the Markdown download identifies held tests and exact verified targets", () => {
  const md = verdict.testPlanMarkdown([targeting, { ...targeting, targeting_entity_ids: ["W"] }], meta);
  assert.match(md, /Test 1: ELIGIBLE/);
  assert.match(md, /Everlane \(123\)/);
  assert.match(md, /Test 2: HELD: Meta did not find Warby Parker/);
  assert.doesNotMatch(verdict.testPlanMarkdown([targeting], null), /ELIGIBLE/);
});

test("trust: reloaded planning sheet uses saved market, targets and cap", () => {
  const canonical = verdict.canonicalPlan({ market: "Tokyo", tests: verdict.readyTests([targeting], meta), rule: { ...verdict.RULE, cap: 222 }, lockedAt: "2026-10-26T00:00:00Z" });
  const rows = verdict.lockedPlanRows({ canonical, id: "saved123" });
  assert.equal(rows[1].ad_set, "TB-saved123 Test 1");
  assert.match(rows[1].targeting, /Everlane, Tokyo/);
  assert.match(rows[1].budget, /222/);
  assert.equal(rows[1].meta_interest_ids, "123");
  const legacy = JSON.parse(canonical); legacy.v = 1; delete legacy.tests[0].targets;
  assert.throws(() => verdict.lockedPlanRows({ canonical: JSON.stringify(legacy), id: "old" }), /verified targeting/);
});
