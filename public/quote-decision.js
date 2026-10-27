// A single-show pilot decision, using buyer-entered offers. Qloo affinity is an
// ordering signal only: it is never multiplied into reach or a sales forecast.
import { availabilityFor } from "./contacts.js";
import { policyBlocks } from "./rank.js";

const list = (x) => Array.isArray(x) ? x : [];
const number = (x, min = 0) => typeof x === "number" && Number.isFinite(x) && x >= min;
const positive = (x) => number(x) && x > 0;
const whole = (x) => Number.isSafeInteger(x) && x > 0;
const clean = (x) => typeof x === "string" ? x.trim() : "";
const validDate = (x) => {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
  const date = new Date(`${x}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === x;
};
const amount = (x) => number(x) && x < Number.MAX_SAFE_INTEGER / 100
  && Math.abs(x * 100 - Math.round(x * 100)) < 0.000001;
const cents = (x) => Math.round(x * 100);
const moneyCode = (x) => typeof x === "string" && /^[A-Z]{3}$/.test(x);
const validScore = (x) => number(x) && x <= 1;
const dateOrder = (x, now) => validDate(x) && x <= now;

function offerRow(show, offer, policy, today, duplicated) {
  const problems = [], missing = [], excluded = [];
  const q = offer || {};
  if (!show) problems.push("The offer does not identify one unique show from this Qloo run.");
  if (duplicated) problems.push("More than one offer uses this entity ID; keep one current offer per show.");
  if (show && !validScore(show.affinity)) missing.push("A valid Qloo taste score for this exact show.");
  if (availabilityFor(show?.name)?.status === "archive") excluded.push("The publishing record excludes new host reads on this archived show.");
  if (policyBlocks(show ? [show] : [], policy.rival_policy).length) excluded.push("Your rival policy excludes this show.");

  const field = (key, check, label) => {
    if (q[key] == null || q[key] === "") missing.push(label);
    else if (!check(q[key])) problems.push(label + " is invalid.");
  };
  field("unit_price", amount, "Price per placement (up to two decimal places)");
  field("min_placements", whole, "Publisher's minimum placement count");
  field("placements", whole, "Planned placement count");
  field("fees", amount, "All additional fees (enter zero if none)");
  field("impressions_low", whole, "Low estimate of total target-market ad impressions for this package");
  field("impressions_high", whole, "High estimate of total target-market ad impressions for this package");
  if (!moneyCode(q.currency)) missing.push("The offer currency.");
  else if (q.currency !== policy.currency) problems.push("Offer and budget currencies differ; no exchange rate is assumed.");
  if (positive(q.impressions_low) && positive(q.impressions_high) && q.impressions_low > q.impressions_high) problems.push("The low impression estimate exceeds the high estimate.");
  if (q.delivery_metric !== "target_market_ad_impressions") missing.push("Delivery must count ad impressions in the target market, not lifetime downloads or unique listeners.");
  if (q.format !== "host_read") missing.push("Confirm that this offer is for host-read placements.");
  if (q.market !== policy.market) missing.push("A delivery estimate for the exact target market.");
  if (!clean(q.source_note)) missing.push("A source/reference for the price and delivery estimate.");
  if (!dateOrder(q.checked_at, today)) missing.push("A valid source-check date no later than today.");
  if (q.valid_until && (!validDate(q.valid_until) || q.valid_until < today)) missing.push("An offer that has not expired.");
  if (q.all_in_confirmed !== true) missing.push("Confirmation that the price includes all fees.");
  if (q.dates_confirmed !== true) missing.push("Confirmation of placement dates and inventory.");
  if (q.exclusivity_clear !== true) missing.push("Confirmation that category restrictions permit this placement.");
  if (q.reviewed !== true) missing.push("Your review of these exact offer details.");
  if (!["quote", "scenario", "rate_card"].includes(q.kind)) missing.push("Whether these are a quote, a public rate card or scenario assumptions.");
  if (q.kind === "rate_card") missing.push("A current offer; a published rate card alone does not confirm a booking.");

  const quantitiesValid = whole(q.min_placements) && whole(q.placements);
  const placements = quantitiesValid ? Math.max(q.min_placements, q.placements) : null;
  const unitCents = amount(q.unit_price) ? cents(q.unit_price) : null;
  const feeCents = amount(q.fees) ? cents(q.fees) : null;
  const costCents = placements && unitCents != null && feeCents != null ? placements * unitCents + feeCents : null;
  const minimumCents = whole(q.min_placements) && unitCents != null ? q.min_placements * unitCents + (feeCents ?? 0) : null;
  const cost = costCents != null && Number.isSafeInteger(costCents) ? costCents / 100 : null;
  const minimum = minimumCents != null && Number.isSafeInteger(minimumCents) ? minimumCents / 100 : null;
  if (costCents != null && !Number.isSafeInteger(costCents)) problems.push("The package cost is outside the supported range.");
  const deliveryValid = q.delivery_metric === "target_market_ad_impressions" && q.market === policy.market
    && whole(q.impressions_low) && whole(q.impressions_high) && q.impressions_low <= q.impressions_high;
  const cpmLow = costCents != null && deliveryValid ? costCents * 10 / q.impressions_high : null;
  const cpmHigh = costCents != null && deliveryValid ? costCents * 10 / q.impressions_low : null;
  const policyBudgetCents = amount(policy.budget) ? cents(policy.budget) : null;
  const policyCpmCents = amount(policy.max_cpm) ? cents(policy.max_cpm) : null;
  const maxPackageCents = deliveryValid && q.currency === policy.currency && policyBudgetCents != null && policyCpmCents != null
    ? Math.min(policyBudgetCents, Math.floor(policyCpmCents * q.impressions_low / 1000)) : null;
  const availableCents = maxPackageCents != null && feeCents != null ? maxPackageCents - feeCents : null;
  const priceCeilingCents = placements && availableCents != null ? Math.max(0, Math.floor(availableCents / placements)) : null;
  const priceCeiling = priceCeilingCents == null ? null : priceCeilingCents / 100;
  const ceilingFeasible = priceCeilingCents != null && feeCents <= maxPackageCents;
  let status = "within_limits", reason = "Fits your budget and CPM cap across the entered delivery range.";
  if (excluded.length) { status = "excluded"; reason = excluded.join(" "); }
  else if (problems.length) { status = "invalid"; reason = problems.join(" "); }
  else if (policyBudgetCents != null && ((costCents != null && costCents > policyBudgetCents) || (minimumCents != null && minimumCents > policyBudgetCents))) {
    status = "over_budget"; reason = cost == null
      ? "The known minimum commitment already exceeds your budget, before any unconfirmed additional fees."
      : `The package requires ${placements} placements including the publisher's minimum, above your single-show pilot budget.`;
  } else if (validScore(show?.affinity) && validScore(policy.min_affinity) && show.affinity < policy.min_affinity) {
    status = "below_fit"; reason = "Below the minimum Qloo taste score you selected.";
  } else if (costCents != null && deliveryValid && policyCpmCents != null && costCents * 1000 > policyCpmCents * q.impressions_high) {
    status = "over_cpm"; reason = "Above your CPM cap even at the high delivery estimate.";
  } else if (missing.length) { status = "needs_details"; reason = "Resolve the missing offer details before comparing it as a pilot option."; }
  else if (costCents != null && deliveryValid && policyCpmCents != null && costCents * 1000 > policyCpmCents * q.impressions_low) {
    status = "delivery_sensitive"; reason = "Fits your CPM cap only if delivery is high enough; it fails at the low estimate.";
  }
  return {
    entity_id: q.entity_id || null, name: show?.name || clean(q.name) || "Unmatched offer", status, reason,
    kind: q.kind || null, currency: moneyCode(q.currency) ? q.currency : null, affinity: validScore(show?.affinity) ? show.affinity : null,
    popularity: validScore(show?.popularity) ? show.popularity : null,
    unit_price: amount(q.unit_price) ? q.unit_price : null, requested_placements: whole(q.placements) ? q.placements : null,
    fees: amount(q.fees) ? q.fees : null, impressions_low: whole(q.impressions_low) ? q.impressions_low : null,
    impressions_high: whole(q.impressions_high) ? q.impressions_high : null, delivery_metric: q.delivery_metric || null,
    format: q.format || null, market: clean(q.market), valid_until: q.valid_until || null, reviewed: q.reviewed === true,
    placements, minimum_commitment: minimum, minimum_is_floor: !amount(q.fees), package_cost: cost, cpm_low: cpmLow, cpm_high: cpmHigh,
    max_unit_price: priceCeiling, price_ceiling_feasible: ceilingFeasible,
    impressions_needed: costCents != null && policyCpmCents != null ? costCents * 1000 / policyCpmCents : null,
    problems, missing, source_note: clean(q.source_note), checked_at: q.checked_at || null,
  };
}

/** The comparison holds budget, delivery, review and rival rules constant.
 * It reports a planning preference, never a purchase authorization or predicted ROI. */
export function compareOffers({ shows = [], offers = [], policy = {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  policy = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  const errors = [];
  if (!validDate(today)) errors.push("A valid comparison date is required.");
  if (!positive(policy.budget) || !amount(policy.budget)) errors.push("Enter a positive single-show pilot budget with up to two decimal places.");
  if (!positive(policy.max_cpm) || !amount(policy.max_cpm)) errors.push("Enter a positive maximum target-market CPM with up to two decimal places.");
  if (!validScore(policy.min_affinity)) errors.push("Select a minimum taste score between zero and one.");
  if (!moneyCode(policy.currency)) errors.push("Select the budget currency.");
  if (!clean(policy.market)) errors.push("Specify the exact target market.");
  const index = new Map();
  for (const show of list(shows)) if (show?.entity_id) index.set(show.entity_id, index.has(show.entity_id) ? null : show);
  const counts = new Map();
  for (const offer of list(offers)) counts.set(offer?.entity_id, (counts.get(offer?.entity_id) || 0) + 1);
  const rows = list(offers).map((offer) => offerRow(index.get(offer?.entity_id), offer, policy, today, counts.get(offer?.entity_id) > 1));
  if (errors.length) for (const row of rows) if (row.status === "within_limits") {
    row.status = "needs_policy";
    row.reason = "Complete your comparison limits before treating this offer as eligible.";
  }
  const scenarios = rows.some((r) => r.kind === "scenario");
  const eligible = errors.length ? [] : rows.filter((r) => r.status === "within_limits");
  const stable = (a, b) => String(a.entity_id).localeCompare(String(b.entity_id));
  const byTaste = [...eligible].sort((a, b) => b.affinity - a.affinity || a.cpm_high - b.cpm_high || stable(a, b));
  const byPrice = [...eligible].sort((a, b) => a.cpm_high - b.cpm_high || b.affinity - a.affinity || stable(a, b));
  const byPopularity = eligible.filter((r) => r.popularity != null).sort((a, b) => b.popularity - a.popularity || stable(a, b));
  const preferred = byTaste[0] || null, popularity = byPopularity[0] || null, cheapest = byPrice[0] || null;
  return {
    v: 1, kind: "podcast_quote_comparison", today, policy: { ...policy }, errors, rows,
    mode: scenarios ? "scenario" : "buyer_entered_offers", preferred,
    popularity_choice: popularity, lowest_cpm_choice: cheapest,
    qloo_changes_popularity_choice: preferred && popularity ? preferred.entity_id !== popularity.entity_id : null,
    interpretation: scenarios ? "Scenario assumptions are present. This is an illustration, not a verified offer or booking decision."
      : "Offer details are buyer-entered and buyer-reviewed, not independently verified. Taste does not predict response or sales.",
    rule: "Within this Qloo shortlist, among offers that fit all entered limits, prefer higher taste fit; break ties with lower worst-case CPM. The comparators use this same shortlist and limits. No money is spent.",
  };
}

export function quoteDecisionMarkdown(result) {
  const money = (x, currency = result.policy.currency) => x == null || !Number.isFinite(x) || !moneyCode(currency) ? "unknown" : `${currency} ${x.toFixed(2)}`;
  const name = (x) => String(x || "").replace(/[\r\n]/g, " ");
  return ["# Podcast pilot decision", "", `Compared: ${result.today}. Market: ${name(result.policy.market)}.`,
    `Single-show budget: ${money(result.policy.budget)}. Target-market CPM cap: ${money(result.policy.max_cpm)}.`,
    result.interpretation, "", result.errors.length ? `Cannot compare: ${result.errors.join(" ")}`
      : result.preferred ? `Planning preference: ${name(result.preferred.name)}.` : "No offer currently fits all of your limits.",
    result.rule, "", `Popularity, under the same limits: ${name(result.popularity_choice?.name) || "unavailable"}.`,
    `Lowest worst-case CPM, under the same limits: ${name(result.lowest_cpm_choice?.name) || "unavailable"}.`,
    ...result.rows.flatMap((r) => ["", `## ${name(r.name)}`, `${r.status}: ${r.reason}`,
      `Qloo entity: ${name(r.entity_id) || "unknown"}; taste ${r.affinity ?? "unknown"}; popularity ${r.popularity ?? "unknown"}. Offer provenance: ${name(r.kind) || "unknown"}. Reviewed exact inputs: ${r.reviewed ? "yes" : "no"}.`,
      `Entered terms: ${money(r.unit_price, r.currency)} per placement; publisher minimum ${r.minimum_commitment == null ? "unknown" : (r.minimum_is_floor ? "at least " : "") + money(r.minimum_commitment, r.currency)}; requested ${r.requested_placements ?? "unknown"} placements; fees ${money(r.fees, r.currency)}; delivery ${r.impressions_low ?? "unknown"}–${r.impressions_high ?? "unknown"} target-market ad impressions; format ${name(r.format) || "unknown"}; market ${name(r.market) || "unknown"}; valid until ${r.valid_until || "not supplied"}.`,
      `Package: ${r.placements ?? "unknown"} placements; ${money(r.package_cost, r.currency)}. Minimum commitment: ${r.minimum_is_floor ? "at least " : ""}${money(r.minimum_commitment, r.currency)}${r.minimum_is_floor ? "; additional fees unknown" : ""}.`,
      `Target-market CPM range: ${money(r.cpm_low, r.currency)} to ${money(r.cpm_high, r.currency)} (rounded; eligibility uses unrounded values).`,
      r.price_ceiling_feasible ? `At the low delivery estimate, price per placement must be at most ${money(r.max_unit_price)} to meet both limits. This does not clear missing details or other exclusions.` : "No usable price ceiling with the current inputs.",
      `Qloo taste: ${r.affinity ?? "unknown"}. Source/reference: ${name(r.source_note) || "missing"}; checked ${r.checked_at || "unknown"}.`,
      ...r.missing.map((m) => `- Still needed: ${m}`)]),
    "", "No message was sent, placement booked or ad launched. Recheck the source and terms before making a purchase.", "",
  ].join("\n");
}
