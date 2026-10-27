import { test } from "node:test";
import assert from "node:assert/strict";
import { readyTests, reviewCreative, canonicalPlan, lockedPlanRows, testPlanMarkdown, creativeOf } from "../public/verdict.js";
import { normalizeBrief } from "../src/agent.js";

const product = "Specialty coffee subscription, $25/month";
const at = "2026-10-26T15:00:00Z";
const proposed = { variable: "creative", grounded: true, targeting_entity_ids: [], hypothesis: "A coffee ritual resonates",
  ad_set: "Broad Austin audience. New creative: Houndstooth quality on a Tuesday.", creative_copy: "Houndstooth quality on a Tuesday." };

test("creative: a valid audience citation does not approve a product comparison", () => {
  assert.equal(readyTests([proposed], null, product).length, 0);
  assert.match(testPlanMarkdown([proposed], null, product), /HELD: Review the product claims/);
  assert.throws(() => canonicalPlan({ product, tests: [proposed], lockedAt: at }), /Review the product claims/);
});

test("creative: the exact buyer-reviewed copy survives lock, reload and CSV without the hypothesis", () => {
  const reviewed = reviewCreative(proposed, { product, copy: "Specialty coffee, delivered for $25/month.", at });
  assert.equal(readyTests([reviewed], null, product).length, 1);
  const canonical = canonicalPlan({ product, market: "Austin", tests: [reviewed], lockedAt: at });
  const plan = JSON.parse(canonical);
  assert.equal(plan.v, 3);
  assert.equal(plan.tests[0].creative_review.reviewed_at, at);
  const rows = lockedPlanRows({ canonical, id: "test123" });
  assert.equal(rows[1].creative, "Specialty coffee, delivered for $25/month.");
  assert.doesNotMatch(rows[1].creative, /Houndstooth|resonates/);
});

test("creative: edits, a different product, placeholders or a forged model review cannot inherit approval", () => {
  const reviewed = reviewCreative(proposed, { product, copy: "Coffee subscription.", at });
  assert.equal(readyTests([{ ...reviewed, creative_copy: "Better than Houndstooth." }], null, product).length, 0);
  assert.equal(readyTests([reviewed], null, "Wool shoes").length, 0);
  assert.throws(() => reviewCreative(proposed, { product, copy: "Quality [confirm].", at }), /placeholders/);
  const normalized = normalizeBrief({ test_plan: [reviewed] });
  assert.equal(normalized.test_plan[0].creative_review, undefined);
  assert.equal(readyTests(normalized.test_plan, null, product).length, 0);
});

test("creative: historical free-text proposals remain readable, never inferred into export copy", () => {
  const legacy = { ...proposed }; delete legacy.creative_copy;
  assert.equal(creativeOf(legacy), "");
  assert.equal(readyTests([legacy], null, product).length, 0);
  assert.match(testPlanMarkdown([legacy], null, product), /not supplied as explicit copy/);
});
