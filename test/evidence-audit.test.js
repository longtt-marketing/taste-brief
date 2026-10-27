import { test } from "node:test";
import assert from "node:assert/strict";
import { registryFrom, verifyItem, checkEvidence } from "../src/evidence.js";
import { briefProblem } from "../src/agent.js";

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
  const partial = { hypothesis: "Outdoor Voices audience", variable: "targeting", targeting_entity_ids: ["INSIGHT"], ad_set: "Outdoor Voices", why: "A plain guess targets runners",
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

test("agent refuses empty test rules or more than 3 experiments before finalizing", () => {
  const citation = { entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] };
  const full = { audience_traits: [{ trait: "x", ...citation }, { trait: "y", ...citation }],
    meta_interests: [{ interest: "x", ...citation }, { interest: "y", ...citation }],
    creative_angles: [], partnerships: [], caveats: [],
    test_plan: [{ hypothesis: "Studio fitness shows stronger relevance", variable: "creative", why: "A plain guess targets runners",
      ad_set: "Outdoor Voices inspired creative", kpi: "Link CTR",
      stop_if: "After 3,000 impressions, CTR below control", ...citation }] };
  assert.equal(briefProblem(full), null);
  const missingRule = { ...full, test_plan: [{ ...full.test_plan[0], stop_if: "  " }] };
  assert.match(briefProblem(missingRule), /non-empty stop_if/);
  const four = { ...full, test_plan: Array.from({ length: 4 }, () => ({ ...full.test_plan[0] })) };
  assert.match(briefProblem(four), /1 to 3/);
});

test("a cited line that reads as purchase behaviour is flagged, taste language passes", () => {
  const reg = registryFrom([seed, insight]);
  const buys = verifyItem("audience_traits", { trait: "Outdoor Voices fans will buy wool sneakers", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] }, reg);
  assert.equal(buys.grounded, false);
  assert.match(buys.problems.join(" "), /purchase behaviour/);
  const taste = verifyItem("audience_traits", { trait: "Shares taste with Outdoor Voices", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] }, reg);
  assert.equal(taste.grounded, true, taste.problems.join("; "));
});

test("an ad test must change one named variable, creative or targeting, and say why a plain guess would miss it", () => {
  const citation = { entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] };
  const base = { audience_traits: [{ trait: "x", ...citation }, { trait: "y", ...citation }],
    meta_interests: [{ interest: "x", ...citation }, { interest: "y", ...citation }], creative_angles: [], partnerships: [], caveats: [] };
  const t = { hypothesis: "h", variable: "creative", ad_set: "a", why: "w", kpi: "Cost per add to cart", stop_if: "Spend up to $300", ...citation };
  assert.equal(briefProblem({ ...base, test_plan: [t] }), null);
  assert.match(briefProblem({ ...base, test_plan: [{ ...t, variable: "both" }] }), /variable must be/);
  assert.match(briefProblem({ ...base, test_plan: [{ ...t, why: "" }] }), /non-empty why/);
});

test("signal strength counts strong non-seed insights results and calls fewer than 5 weak", async () => {
  const { signalFrom } = await import("../src/agent.js");
  const many = Array.from({ length: 6 }, (_, i) => ({ name: `B${i}`, entity_id: `B${i}`, type: "urn:entity:brand", affinity: 0.95 }));
  const strong = signalFrom(registryFrom([seed, { ...insight, output: many }]));
  assert.deepEqual(strong, { results: 6, strong: 6, weak: false });
  assert.equal(signalFrom(registryFrom([seed, insight])).weak, true);
});

test("the one variable is checked against the ad set: targeting names its Qloo interests, creative keeps the broad audience", () => {
  const reg = registryFrom([seed, insight]);
  const base = { hypothesis: "h", why: "w", kpi: "Cost per add to cart", stop_if: "Up to 300 per arm", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] };
  const ok = (t) => verifyItem("test_plan", { ...base, targeting_entity_ids: t.variable === "targeting" ? ["INSIGHT"] : [], ...t }, reg);
  assert.equal(ok({ variable: "targeting", ad_set: "Usual creative, shown to Outdoor Voices fans" }).grounded, true);
  assert.match(ok({ variable: "targeting", ad_set: "Usual creative, shown to sneaker fans" }).problems.join(), /does not name the Qloo interests/);
  assert.equal(ok({ variable: "creative", ad_set: "A materials story in an Outdoor Voices tone, shown to the control's broad audience" }).grounded, true);
  assert.match(ok({ variable: "creative", ad_set: "A materials story shown to the Outdoor Voices interest" }).problems.join(), /also seems to change the targeting/);
});

test("purchase language: 'they buy' is flagged, 'cost per purchase' as a metric is not", () => {
  const reg = registryFrom([seed, insight]);
  assert.match(verifyItem("audience_traits", { trait: "They buy Outdoor Voices", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] }, reg).problems.join(), /purchase behaviour/);
  const t = verifyItem("test_plan", { hypothesis: "A materials story lowers cost per purchase", variable: "creative", ad_set: "Materials story, broad audience", why: "w", kpi: "Cost per purchase", stop_if: "s", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] }, reg);
  assert.equal(t.grounded, true, t.problems.join("; "));
});

test("a creative test that says 'No interest targeting' passes; one that lists 'Interests:' does not", () => {
  const reg = registryFrom([seed, insight]);
  const base = { hypothesis: "h", variable: "creative", why: "w", kpi: "Cost per add to cart", stop_if: "s", entity_ids: ["INSIGHT"], evidence: ["Outdoor Voices 0.956"] };
  assert.equal(verifyItem("test_plan", { ...base, ad_set: "Control's broad London audience and ages. New creative: a materials story. No interest targeting." }, reg).grounded, true);
  assert.match(verifyItem("test_plan", { ...base, ad_set: "New creative: a materials story. Interests: Outdoor Voices." }, reg).problems.join(), /also seems to change the targeting/);
});
