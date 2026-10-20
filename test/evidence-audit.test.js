import { test } from "node:test";
import assert from "node:assert/strict";
import { registryFrom, verifyItem, checkEvidence } from "../src/evidence.js";

const seed = { tool: "search", input: { query: "Allbirds" }, output: [
  { name: "Allbirds", entity_id: "SEED", type: "urn:entity:brand", affinity: null },
] };
const search = { tool: "search", input: { query: "Unrelated Brand" }, output: [
  { name: "Unrelated Brand", entity_id: "SEARCH_ONLY", type: "urn:entity:brand", affinity: null },
] };
const insight = { tool: "insights", input: {
  entity_ids: ["SEED"], location: "London", filter_type: "urn:entity:brand",
}, output: [
  { name: "Outdoor Voices", entity_id: "INSIGHT", type: "urn:entity:brand", affinity: 0.956 },
] };

test("a search-only result cannot justify a non-seed taste claim", () => {
  const reg = registryFrom([seed, search, insight]);
  const claim = { trait: "Fans of Unrelated Brand", entity_ids: ["SEARCH_ONLY"],
    evidence: ["Unrelated Brand"] };
  const result = verifyItem("audience_traits", claim, reg);
  assert.equal(result.grounded, false);
  assert.match(result.problems.join(" "), /search, not supported by an insights affinity/);
});

test("an actual insights result can justify a non-seed taste citation", () => {
  const reg = registryFrom([seed, search, insight]);
  const result = verifyItem("meta_interests", {
    interest: "Outdoor Voices", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices (affinity 0.956)"],
  }, reg);
  assert.equal(result.grounded, true, result.problems.join("; "));
});

test("search seed can still support a claim about the seed itself", () => {
  const reg = registryFrom([seed, insight]);
  const result = verifyItem("meta_interests", {
    interest: "Allbirds", entity_ids: ["SEED"], evidence: ["Allbirds was the seed brand"],
  }, reg);
  assert.equal(result.grounded, true, result.problems.join("; "));
});

test("ad test needs all four action fields despite having a valid Qloo citation", () => {
  const reg = registryFrom([seed, insight]);
  const partial = { hypothesis: "Outdoor Voices audience", ad_set: "Outdoor Voices",
    kpi: "", stop_if: "", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] };
  const result = verifyItem("test_plan", partial, reg);
  assert.equal(result.grounded, false);
  assert.match(result.problems.join(" "), /missing kpi/);
  assert.match(result.problems.join(" "), /missing stop_if/);
  const complete = { ...partial, kpi: "CTR", stop_if: "Stop if CTR trails the control after 3,000 impressions" };
  assert.equal(checkEvidence({ test_plan: [complete] }, reg).ratio, 1);
});

test("a valid citation must not conceal a search-only citation in the same line", () => {
  const reg = registryFrom([seed, search, insight]);
  const result = verifyItem("audience_traits", {
    trait: "Both audiences", entity_ids: ["INSIGHT", "SEARCH_ONLY"], evidence: ["Outdoor Voices 0.956"],
  }, reg);
  assert.equal(result.grounded, false);
  assert.match(result.problems.join(" "), /Unrelated Brand/);
});
