import { test } from "node:test";
import assert from "node:assert/strict";
import { compareOffers, quoteDecisionMarkdown } from "../public/quote-decision.js";
import rateCards from "../public/data/podcast-rate-cards.js";

// Synthetic offers exercise buyer decisions; they are not publisher quotes or pilot outcomes.
const today = "2026-10-27";
const shows = [
  { entity_id: "a", name: "Niche show", affinity: .97, popularity: .4, rivals: [] },
  { entity_id: "b", name: "Famous show", affinity: .90, popularity: .9, rivals: [] },
];
const policy = { budget: 1000, max_cpm: 60, min_affinity: .85, currency: "USD", market: "US", rival_policy: "allow" };
const offer = (entity_id, patch = {}) => ({ entity_id, unit_price: 200, min_placements: 3, placements: 1, fees: 0,
  impressions_low: 10000, impressions_high: 20000, format: "host_read", delivery_metric: "target_market_ad_impressions", market: "US", currency: "USD",
  source_note: "Synthetic test fixture only", checked_at: today, kind: "scenario", all_in_confirmed: true,
  dates_confirmed: true, exclusivity_clear: true, reviewed: true, ...patch });
const compare = (offers, extra = {}) => compareOffers({ shows, offers, policy, today, ...extra });

test("quote memo preserves a mismatched offer currency and refuses a cross-currency price ceiling", () => {
  const r = compare([offer("a", { currency: "EUR" })]);
  assert.equal(r.preferred, null);
  assert.equal(r.rows[0].max_unit_price, null);
  assert.match(quoteDecisionMarkdown(r), /3 placements; EUR 600.00/);
  assert.ok(compare([offer("a")], { policy: null }).errors.length);
  assert.equal(compare([offer("a", { currency: ["USD"] })]).preferred, null);
});

test("quote decision: taste changes the choice with identical eligibility rules for each comparator", () => {
  const r = compare([offer("a"), offer("b", { unit_price: 150 })]);
  assert.equal(r.preferred.entity_id, "a");
  assert.equal(r.popularity_choice.entity_id, "b");
  assert.equal(r.lowest_cpm_choice.entity_id, "b");
  assert.equal(r.qloo_changes_popularity_choice, true);
  assert.equal(r.mode, "scenario");
  assert.match(r.interpretation, /illustration/);
  assert.equal(r.rows[0].placements, 3);
  assert.equal(r.rows[0].package_cost, 600);
});

test("quote decision: minimum commitment defeats a cheap headline price before missing details are filled", () => {
  const card = rateCards.find((r) => r.names.includes("Software Defined Talk"));
  const r = compare([offer("a", { unit_price: card.unit_price, min_placements: card.min_placements, fees: null, kind: "rate_card", impressions_low: null, impressions_high: null, reviewed: false })],
    { shows: [{ ...shows[0], name: "Software Defined Talk", affinity: null, popularity: null }] });
  assert.equal(r.rows[0].minimum_commitment, 1800);
  assert.equal(r.rows[0].minimum_is_floor, true);
  assert.equal(r.rows[0].package_cost, null);
  assert.equal(r.rows[0].status, "over_budget");
  assert.equal(r.preferred, null);
  assert.ok(r.rows[0].missing.length);
});

test("quote decision: an exported price ceiling never rounds up beyond the buyer's cap", () => {
  const p = { ...policy, max_cpm: 10 };
  const r = compare([offer("a", { unit_price: 33.33 })], { policy: p });
  assert.equal(r.preferred.max_unit_price, 33.33);
  assert.equal(compare([offer("a", { unit_price: 33.34 })], { policy: p }).preferred, null);
  assert.equal(compare([offer("a")], { policy: { ...policy, max_cpm: null } }).rows[0].status, "needs_policy");
});

test("quote decision: price ceiling is a real boundary; one cent above changes the verdict", () => {
  const r = compare([offer("a")]);
  assert.equal(r.preferred.max_unit_price, 200);
  assert.equal(r.preferred.cpm_low, 30);
  assert.equal(r.preferred.cpm_high, 60);
  assert.equal(compare([offer("a", { unit_price: 200.01 })]).rows[0].status, "delivery_sensitive");
  assert.equal(compare([offer("a", { unit_price: 450 })], { policy: { ...policy, budget: 2000 } }).rows[0].status, "over_cpm");
});

test("quote decision: exact CPM boundaries are not rejected by floating-point noise", () => {
  const r = compare([offer("a", { unit_price: 128.46, min_placements: 1, placements: 1, impressions_low: 2141, impressions_high: 2141 })], {
    policy: { ...policy, budget: 2000, max_cpm: 60 },
  });
  assert.equal(r.rows[0].cpm_high, 60);
  assert.equal(r.rows[0].status, "within_limits");
  assert.equal(r.preferred.entity_id, "a");
  const over = compare([offer("a", { unit_price: 128.47, min_placements: 1, placements: 1, impressions_low: 2141, impressions_high: 2141 })], {
    policy: { ...policy, budget: 2000, max_cpm: 60 },
  });
  assert.equal(over.rows[0].status, "over_cpm");
});

test("quote decision: missing source, ad-delivery definition or review never becomes eligible", () => {
  for (const patch of [{ source_note: "" }, { checked_at: "2026-99-99" }, { checked_at: "2026-10-28" },
    { valid_until: "2026-10-26" }, { delivery_metric: "episode_downloads" }, { format: "display_banner" }, { market: "Austin" },
    { dates_confirmed: false }, { all_in_confirmed: false }, { exclusivity_clear: false }, { reviewed: false },
    { min_placements: null }, { impressions_low: null }, { kind: "rate_card" }]) {
    const r = compare([offer("a", patch)]);
    assert.equal(r.preferred, null, JSON.stringify(patch));
    assert.equal(r.rows[0].status, "needs_details", JSON.stringify(patch));
  }
});

test("quote decision: invalid amounts, counts, ranges and currencies cannot win", () => {
  for (const patch of [{ unit_price: -1 }, { unit_price: "200" }, { unit_price: Infinity }, { unit_price: .001 },
    { min_placements: 1.5 }, { placements: 0 }, { fees: NaN }, { impressions_low: -1 },
    { impressions_high: 9999 }, { impressions_low: .5 }, { currency: "EUR" }]) {
    const r = compare([offer("a", patch)]);
    assert.equal(r.preferred, null);
    assert.equal(r.rows[0].status, "invalid", JSON.stringify(patch));
  }
  assert.equal(compare([offer("a")], { policy: { ...policy, max_cpm: NaN } }).preferred, null);
  assert.equal(compare([offer("a")], { today: "2026-02-30" }).preferred, null);
});

test("quote decision: exact entity identity, duplicate IDs and rival/archive exclusions remain binding", () => {
  assert.equal(compare([offer("wrong", { name: "Niche show" })]).rows[0].status, "invalid");
  assert.equal(compare([offer("a"), offer("a")]).preferred, null);
  assert.equal(compare([offer("a")], { shows: [shows[0], { ...shows[0] }] }).rows[0].status, "invalid");
  const archived = compare([offer("a")], { shows: [{ ...shows[0], name: "Harmontown" }] });
  assert.equal(archived.rows[0].status, "excluded");
  const rival = compare([offer("a")], { shows: [{ ...shows[0], rivals: ["Rival"] }], policy: { ...policy, rival_policy: "skip" } });
  assert.equal(rival.rows[0].status, "excluded");
});

test("quote decision: all-in fees and decimal cents are included without false floating-point budget failure", () => {
  const r = compare([offer("a", { unit_price: .10, fees: 0, min_placements: 3 })], { policy: { ...policy, budget: .30 } });
  assert.equal(r.preferred.package_cost, .30);
  const expensiveFees = compare([offer("a", { fees: 1001 })]);
  assert.equal(expensiveFees.rows[0].status, "over_budget");
  assert.equal(expensiveFees.rows[0].price_ceiling_feasible, false);
});

test("quote decision: missing popularity stays unavailable, and an unchanged choice is explicit", () => {
  const r = compare([offer("a")]);
  assert.equal(r.qloo_changes_popularity_choice, false);
  const noPopularity = compare([offer("a")], { shows: [{ ...shows[0], popularity: null }] });
  assert.equal(noPopularity.qloo_changes_popularity_choice, null);
  assert.equal(noPopularity.popularity_choice, null);
  assert.equal(noPopularity.preferred.entity_id, "a");
});

test("quote decision: exported memo preserves the limitations, exclusions and switching threshold", () => {
  const text = quoteDecisionMarkdown(compare([offer("a"), offer("b", { unit_price: 600 })]));
  assert.match(text, /Scenario assumptions/);
  assert.match(text, /Qloo entity: a/);
  assert.match(text, /Entered terms: USD 200\.00 per placement/);
  assert.match(text, /delivery 10000–20000 target-market ad impressions/);
  assert.match(text, /USD 200.00/);
  assert.match(text, /over_budget/);
  assert.match(text, /No message was sent/);
  assert.match(text, /Popularity, under the same limits: Niche show/);
});
