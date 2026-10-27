import { test } from "node:test";
import assert from "node:assert/strict";
import { askFirst } from "../public/rank.js";
import { availabilityFor } from "../public/contacts.js";

test("buying availability: archive is excluded operationally without rewriting the historical rank", () => {
  const old = { name: "Harmontown", affinity: 0.99, advertisers: null, rivals: null };
  const current = { name: "Giant Bombcast", affinity: 0.95, advertisers: null, rivals: null };
  assert.deepEqual(askFirst([old, current], 1).shows, [old], "registered historical ranking is unchanged");
  assert.deepEqual(askFirst([old, current], 1, { checkAvailability: true }).shows, [current]);
  const decision = buyerDecision(old);
  assert.equal(decision.status, "archive");
  assert.equal(decision.readyToAsk, false);
  assert.equal(decision.publishing.latest_observed, "2021-03-18");
  assert.equal(availabilityFor("Harmontown Fan Show"), null);
});
import { buyerDecision, decisionMarkdown } from "../public/buyer-decision.js";

test("buyer decision: official ad route supports a quote request without inventing sponsor coverage", () => {
  const s = { name: "Home Cooking", affinity: .92, advertisers: null, rivals: null };
  const d = buyerDecision(s, { market: "Austin, TX", category: "coffee" });
  assert.equal(d.status, "request_rates");
  assert.equal(d.readyToAsk, true);
  assert.equal(s.advertisers, null);
  assert.match(d.basis, /competition is unknown/);
  assert.ok(d.questions.some((x) => x.includes("Austin, TX")));
  assert.ok(d.questions.some((x) => /reporting window/.test(x)));
  assert.match(decisionMarkdown(s), /Rates, reach, availability and exclusivity are not verified/);
});

test("buyer decision: detected sponsors without a contact are a contact-research task", () => {
  const d = buyerDecision({ name: "Unknown Show", affinity: .96, advertisers: ["Brand"], rivals: [] });
  assert.equal(d.status, "find_ad_team");
  assert.equal(d.readyToAsk, false);
  assert.equal(d.contact, null);
});

test("buyer decision: no data and zero detected sponsors do not mean the same thing", () => {
  const base = { name: "Unknown Show", affinity: .96, rivals: null };
  const missing = buyerDecision({ ...base, advertisers: null });
  const empty = buyerDecision({ ...base, advertisers: [] });
  assert.equal(missing.status, "verify_ad_sales");
  assert.equal(empty.status, "verify_ad_sales");
  assert.notEqual(missing.basis, empty.basis);
  assert.match(empty.basis, /does not establish an ad-free show/);
  assert.match(missing.questions.join(" "), /accept host-read sponsorships/);
});

test("buyer decision: a general contact is never silently upgraded to ad sales", () => {
  const d = buyerDecision({ name: "The Liz Moody Podcast", affinity: .94, advertisers: ["Brand"], rivals: [] });
  assert.equal(d.status, "find_ad_team");
  assert.equal(d.contact.kind, "general");
  assert.equal(d.readyToAsk, false);
});

test("buyer decision: rival exclusion wins even when an official ad route exists", () => {
  const s = { name: "Home Cooking", affinity: .98, advertisers: ["Brand"], rivals: ["Brand"] };
  const skipped = buyerDecision(s, { policy: "skip" });
  assert.equal(skipped.status, "excluded");
  assert.deepEqual(skipped.questions, []);
  assert.equal(buyerDecision(s).status, "request_rates");
  assert.match(buyerDecision(s).basis, /confirm exclusivity/);
});

test("buyer decision: incomplete or invalid scores cannot become an action-ready recommendation", () => {
  for (const affinity of [null, undefined, NaN, Infinity, -1, 1.2, "0.9"]) {
    assert.equal(buyerDecision({ name: "Home Cooking", affinity }).status, "hold");
  }
});
