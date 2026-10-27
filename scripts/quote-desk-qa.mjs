// Operational replay checks only. Never calls providers or collects new feeds.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { compareOffers } from "../public/quote-decision.js";
import { askFirst } from "../public/rank.js";
import { availabilityFor } from "../public/contacts.js";
import assert from "node:assert/strict";

const sources = [
  ["coffee", ".results/qa-round2/2026-10-26T18-09-50-801Z/coffee.json"],
  ["sneakers", ".results/qa-round2/2026-10-26T16-17-13-597Z/sneakers.json"],
  ["turntable", ".results/qa-round2/2026-10-26T16-17-13-597Z/turntable.json"],
];
const at = new Date().toISOString(), today = at.slice(0, 10), cases = [];
for (const [name, source] of sources) {
  const run = JSON.parse(await readFile(source, "utf8"));
  const candidates = run.podcasts.shows.filter((s) => availabilityFor(s.name)?.status !== "archive");
  const selected = run.podcasts.outreach?.chosen_by === "agent"
    ? run.podcasts.outreach.shows.map((s) => candidates.find((c) => c.name === s.show)).filter(Boolean).sort((a, b) => b.affinity - a.affinity)
    : askFirst(candidates, 3, { skipRivals: run.rival_policy === "skip", checkAvailability: true }).shows;
  const policy = { budget: 1000, max_cpm: 60, min_affinity: 0, currency: "USD", market: run.market, rival_policy: run.rival_policy || "allow" };
  const offers = selected.map((s, i) => ({ entity_id: s.entity_id, unit_price: [200, 150, 600][i % 3], min_placements: 3, placements: 1, fees: 0,
    impressions_low: 10000, impressions_high: 20000, currency: "USD", market: run.market, format: "host_read", delivery_metric: "target_market_ad_impressions",
    source_note: "Hypothetical QA assumptions only; not publisher quotes", checked_at: today, kind: "scenario", reviewed: true, all_in_confirmed: true, dates_confirmed: true, exclusivity_clear: true }));
  const first = compareOffers({ shows: selected, offers, policy, today });
  assert.equal(first.mode, "scenario"); assert.equal(first.errors.length, 0);
  assert.ok(first.preferred, `${name}: the declared scenario must have a preference`);
  const changed = structuredClone(offers);
  const target = changed.find((q) => q.entity_id === first.preferred.entity_id);
  target.unit_price = Math.round((first.preferred.max_unit_price + .01) * 100) / 100;
  const second = compareOffers({ shows: selected, offers: changed, policy, today });
  assert.notEqual(second.preferred?.entity_id, first.preferred.entity_id);
  assert.equal(second.rows.find((r) => r.entity_id === target.entity_id).status, "delivery_sensitive");
  target.reviewed = false;
  const unreviewed = compareOffers({ shows: selected, offers: changed, policy, today });
  assert.notEqual(unreviewed.preferred?.entity_id, target.entity_id);
  cases.push({ case: name, source, run_at: run.run.at, market: run.market, mode: "scenario",
    chosen: first.preferred.name, popularity_same_limits: first.popularity_choice?.name || null,
    cheapest_same_limits: first.lowest_cpm_choice?.name || null,
    qloo_changes_popularity_choice: first.qloo_changes_popularity_choice,
    offer_states: first.rows.map((r) => ({ show: r.name, status: r.status, hypothetical_package_cost: r.package_cost })),
    counterfactual: { changed_show: first.preferred.name, max_unit_price: first.preferred.max_unit_price, new_unit_price: target.unit_price,
      new_status: second.rows.find((r) => r.entity_id === target.entity_id).status, new_preference: second.preferred?.name || null,
      unreviewed_offer_remained_ineligible: true } });
}
const source_sha256 = createHash("sha256").update(await readFile("public/quote-decision.js")).digest("hex");
const result = { at, kind: "operational QA: hypothetical offers on three recorded Qloo runs", source_sha256,
  scope: "No new provider run, feed collection, human buyer test, publisher quote or ad-performance measurement. Comparators use the same Qloo-derived shortlist.",
  cases };
await writeFile("docs/decision-desk-results.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
