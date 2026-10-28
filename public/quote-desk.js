import { compareOffers, quoteDecisionMarkdown } from "./quote-decision.js";
import { contactFor } from "./contacts.js";
import rateCards from "./data/podcast-rate-cards.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const date = () => new Date().toISOString().slice(0, 10);
const num = (s) => s === "" ? null : Number(s);
const money = (v, currency) => Number.isFinite(v) ? `${currency} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Not supplied";
const cpm = (v, currency) => `${currency} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
const statusLabels = { within_limits: "Fits entered limits", needs_details: "Needs offer details", over_budget: "Over budget", over_cpm: "Above CPM cap", delivery_sensitive: "Depends on delivery", below_fit: "Below taste floor", excluded: "Excluded", invalid: "Check the inputs", needs_policy: "Set your limits" };
const reviewed = (q, value) => Object.assign(q, { reviewed: value, all_in_confirmed: value, dates_confirmed: value, exclusivity_clear: value });
const fields = ["entity_id", "unit_price", "min_placements", "placements", "fees", "impressions_low", "impressions_high", "currency", "market", "format", "delivery_metric", "source_note", "checked_at", "valid_until", "kind"];
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Local-only quote handling. Quote values are never sent to the Worker or an LLM. */
export function mountQuoteDesk(host, run, selected) {
  const shows = (selected || []).filter((s, i, a) => s.entity_id && a.findIndex((x) => x.entity_id === s.entity_id) === i);
  if (!shows.length) return;
  const showProvenance = run.mode === "live" ? "live Qloo show data" : run.mode === "replay" ? "recorded Qloo show data" : "synthetic sample show data";
  const empty = (s) => reviewed({ entity_id: s.entity_id, unit_price: null, min_placements: null, placements: null, fees: null,
    impressions_low: null, impressions_high: null, delivery_metric: "target_market_ad_impressions", market: run.market,
    currency: "USD", format: "host_read", source_note: "", checked_at: "", valid_until: "", kind: "quote" }, false);
  const actual = { policy: { budget: null, max_cpm: null, min_affinity: 0, currency: "USD", market: run.market, rival_policy: run.rival_policy || "allow" }, offers: shows.map(empty) };
  let scenario = null, isScenario = false, active = 0, notice = "", result;
  const bundle = () => isScenario ? scenario : actual;
  const offer = () => bundle().offers[active];
  const evaluate = () => compareOffers({ shows, ...bundle() });
  const cardFor = (s) => rateCards.find((r) => r.names.some((n) => n.toLowerCase() === s.name.toLowerCase()));
  const currencies = (value) => ["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => `<option${c === value ? " selected" : ""}>${c}</option>`).join("");
  const numeric = (key, label, options = {}) => `<label>${esc(label)}<input data-offer="${key}" type="number" min="${options.min ?? 0}" step="${options.step ?? "0.01"}" inputmode="decimal" value="${esc(offer()[key])}" placeholder="Not supplied"${options.help ? ` aria-describedby="qd-${key}-help"` : ""}>${options.help ? `<small id="qd-${key}-help">${esc(options.help)}</small>` : ""}</label>`;

  function render() {
    const anchorTop = host.querySelector(".qd-heading")?.getBoundingClientRect().top;
    host.innerHTML = `<section class="qd" id="quote-desk" tabindex="-1" aria-labelledby="qd-title">
      <header class="qd-heading"><div><p class="stepk">02 / Compare the offers</p><h2 id="qd-title">Taste finds the fit.<br>The terms decide the pilot.</h2><p>Bring back quotes for this shortlist. Compare one show at a time against your budget and delivery limits.</p></div>
      <button type="button" class="ghost" data-action="scenario">${isScenario ? "Back to my quotes" : "Try a labelled scenario"}</button></header>
      <div class="qd-mode${isScenario ? " qd-warning" : ""}">${isScenario ? `Scenario mode: ${showProvenance}, invented prices and delivery assumptions. These are not publisher quotes. Your own quotes are preserved separately.` : "Your quotes stay in this browser page. Download them to keep your work; nothing here is sent to a model, publisher or ad platform."}</div>
      <div class="qd-policy"><label>Single-show pilot budget<input data-policy="budget" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Your maximum spend" value="${esc(bundle().policy.budget)}"></label>
      <label>Maximum target-market CPM<input data-policy="max_cpm" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Your cost per 1,000 ad impressions" value="${esc(bundle().policy.max_cpm)}"></label>
      <label>Budget currency<select data-policy="currency">${currencies(bundle().policy.currency)}</select></label></div>
      <p class="qd-market">Host-read placements · delivery market: <strong>${esc(run.market)}</strong>. CPM uses ad impressions for the whole package in this market. Qloo taste does not establish local delivery.</p>
      <div class="qd-summary" aria-live="polite" aria-atomic="true"></div>
      <div class="qd-grid"><div><h3 class="qd-list-title">${shows.length} shortlisted show${shows.length === 1 ? "" : "s"}</h3><div class="qd-list" aria-label="Offers to edit"></div><div class="qd-baselines"></div></div>
      <div class="qd-editor"></div></div>
      <div class="qd-actions"><button type="button" data-action="memo">${isScenario ? "Download scenario memo" : "Download decision memo"}</button><button type="button" class="ghost" data-action="save">Save quote inputs</button><button type="button" class="ghost" data-action="load">Load saved quotes</button><input class="qd-upload" type="file" accept=".json,application/json" aria-label="Load saved quote file" hidden></div>
      <p class="qd-notice" role="status">${esc(notice)}</p><p class="qd-foot">Within this Qloo shortlist, the preference is the highest taste among offers that fit the same limits, with lower worst-case CPM breaking ties. Popularity and lowest CPM use that same shortlist and those identical limits. This plans a test; it does not predict sales, book a placement or spend money.</p>
    </section>`;
    renderEditor(); update();
    if (Number.isFinite(anchorTop)) requestAnimationFrame(() => window.scrollBy(0, host.querySelector(".qd-heading").getBoundingClientRect().top - anchorTop));
  }

  function renderEditor() {
    const q = offer(), show = shows[active], route = contactFor(show.name), card = cardFor(show);
    host.querySelector(".qd-editor").innerHTML = `<div class="qd-editor-head"><span class="stepk">Editing offer ${active + 1} of ${shows.length}</span><h3>${esc(show.name)}</h3><span class="qd-provenance">${isScenario ? "Scenario assumptions" : q.kind === "rate_card" ? "Published rate card; needs a current quote" : "Buyer-entered quote; not independently verified"}</span></div>
      <button type="button" class="ghost" data-action="terms">Copy terms request for this show</button>
      <div class="qd-offer-result"></div>
      <div class="qd-fields">${numeric("unit_price", "Price per placement")}${numeric("min_placements", "Publisher’s minimum placements", { min: 1, step: 1 })}${numeric("placements", "Placements you want", { min: 1, step: 1 })}${numeric("fees", "All additional fees", { help: "Enter 0 only if you confirmed there are no additional fees." })}
      <label>Offer currency<select data-offer="currency">${currencies(q.currency)}</select></label><div class="qd-help">The larger of your count and the publisher’s minimum determines the package cost. No currency conversion is assumed.</div>
      <div class="qd-field-heading">Expected ad impressions across the whole package in ${esc(run.market)}</div>
      ${numeric("impressions_low", "Low delivery estimate", { min: 1, step: 1 })}${numeric("impressions_high", "High delivery estimate", { min: 1, step: 1 })}
      <label class="qd-wide">Source / offer reference<textarea data-offer="source_note" rows="2" maxlength="1000" placeholder="Publisher quote, media kit or your scenario assumption">${esc(q.source_note)}</textarea></label>
      <label>Source checked on<input data-offer="checked_at" type="date" value="${esc(q.checked_at)}" max="${date()}"></label><label>Offer expires on <small>optional</small><input data-offer="valid_until" type="date" value="${esc(q.valid_until)}"></label></div>
      <label class="qd-review"><input data-review type="checkbox"${q.reviewed ? " checked" : ""}><span>${isScenario ? "Use these as scenario assumptions only. They are not verified prices, delivery or availability." : "I checked these exact host-read terms against the source, including all fees, available dates and category permission. Delivery figures are target-market ad impressions for this package."}</span></label>
      <p class="qd-review-note">${q.reviewed ? "Changing any offer detail resets this review." : "Review is required. Changing offer details resets it."}</p>
      ${route ? `<a class="qd-contact" href="${esc(route.contact_url)}" target="_blank" rel="noopener">${route.kind === "advertising" ? "Open the official advertising route" : "Open the general contact route"} ↗</a>` : ""}
      ${card && !isScenario ? `<div class="qd-rate-card"><p>Published ${esc(card.currency)} ${card.unit_price} per placement; minimum ${card.min_placements}. <a href="${esc(card.source_url)}" target="_blank" rel="noopener">Source</a>, checked ${esc(card.checked_at)}.</p><button type="button" class="ghost" data-action="rate-card">Use published price only</button>${q.kind === "rate_card" ? `<button type="button" class="ghost" data-action="current-quote">Replace with a current quote</button>` : ""}<small>${esc(card.scope)}</small></div>` : ""}`;
  }

  function update() {
    result = evaluate();
    const p = result.preferred, current = result.rows[active], currency = bundle().policy.currency;
    host.querySelector(".qd-summary").classList.toggle("qd-has-choice", !!p);
    const cheaper = result.lowest_cpm_choice;
    const costDifference = p && cheaper ? p.package_cost - cheaper.package_cost : null;
    const difference = p && cheaper && p.entity_id !== cheaper.entity_id
      ? ` The lowest-CPM option is ${cheaper.name}; the preferred package costs ${money(Math.abs(costDifference), currency)} ${costDifference >= 0 ? "more" : "less"}. Packages can differ in delivered impressions.` : "";
    const pRow = p ? result.rows.find((r) => r.entity_id === p.entity_id) : null;
    // price per placement against the ceiling that keeps each offer within both limits (low delivery estimate)
    const gauged = result.rows.filter((r) => Number.isFinite(r.unit_price) && r.price_ceiling_feasible && Number.isFinite(r.max_unit_price));
    const top = Math.max(...gauged.map((r) => Math.max(r.unit_price, r.max_unit_price))) * 1.15;
    const meter = p && gauged.length ? `<div class="qd-meter" aria-label="Price per placement against each offer's ceiling">${gauged.map((r) => `<div class="qd-meter-row${r.entity_id === p.entity_id ? " qd-meter-pick" : ""}"><span class="qd-meter-name">${esc(r.name)}</span><span class="qd-meter-bar"><i style="width:${(r.unit_price / top * 100).toFixed(1)}%"></i><em style="left:${(r.max_unit_price / top * 100).toFixed(1)}%"></em></span><span class="qd-meter-v">${esc(money(r.unit_price, currency))} now · max ${esc(money(r.max_unit_price, currency))}</span></div>`).join("")}<p class="qd-meter-key"><em></em> the highest price per placement that still fits your budget and CPM cap</p></div>` : "";
    host.querySelector(".qd-summary").innerHTML = `<div class="qd-summary-mark">${p ? "✓" : "○"}</div><div><span class="stepk">${isScenario ? "Scenario preference" : "Planning preference"}</span><h3>${p ? (pRow?.price_ceiling_feasible ? `${esc(p.name)} fits your limits up to ${esc(money(pRow.max_unit_price, currency))} a placement.` : `${esc(p.name)} fits your entered limits.`) : result.errors.length ? "Set your limits, then check the offers." : "No offer fits all entered limits yet."}</h3><p>${esc(p ? `Highest taste fit among ${result.rows.filter((r) => r.status === "within_limits").length} eligible offers.${difference} This is a tradeoff to test, not a sales forecast.` : result.errors.length ? result.errors.join(" ") : "Use the reason on each offer to ask for missing terms, negotiate price or leave it out.")}</p>${meter}</div>`;
    host.querySelector(".qd-list").innerHTML = result.rows.map((r, i) => `<button type="button" class="qd-offer${r.entity_id === p?.entity_id ? " qd-preferred" : ""}" data-select="${i}" aria-pressed="${i === active}"><span class="qd-offer-title">${esc(r.name)}<span>${String(i + 1).padStart(2, "0")}</span></span><span class="qd-metrics"><span><b>${r.affinity == null ? "Unknown" : r.affinity.toFixed(3)}</b>Qloo taste</span><span><b>${r.package_cost == null ? r.minimum_commitment == null ? "No quote" : `≥ ${esc(money(r.minimum_commitment, bundle().offers[i].currency))}` : esc(money(r.package_cost, bundle().offers[i].currency))}</b>${r.placements || "—"} placements</span></span><span class="qd-status ${r.status === "within_limits" ? "qd-ok" : ""}">${esc(statusLabels[r.status])}</span></button>`).join("");
    host.querySelector(".qd-baselines").innerHTML = `<p><span>Popularity, same limits</span><b>${esc(result.popularity_choice?.name || "No eligible scored offer")}</b></p><p><span>Lowest worst-case CPM</span><b>${esc(result.lowest_cpm_choice?.name || "No eligible offer")}</b></p><p class="qd-help">${result.qloo_changes_popularity_choice === true ? "Taste changes the choice here. That does not prove it will perform better." : result.qloo_changes_popularity_choice === false ? "Taste and popularity choose the same show here." : "A comparison appears once an offer meets the limits."}</p>`;
    host.querySelector(".qd-offer-result").innerHTML = `<p class="qd-reason">${esc(current.reason)}</p>${current.cpm_high != null ? `<p class="qd-cpm">Target-market CPM: <b>${esc(cpm(current.cpm_low, offer().currency))}–${esc(cpm(current.cpm_high, offer().currency))}</b></p>` : ""}
      ${current.price_ceiling_feasible ? `<div class="qd-ceiling"><strong>${esc(money(current.max_unit_price, offer().currency))}</strong><span>Maximum per placement at the low delivery estimate. Other exclusions and missing details still apply.</span></div>` : ""}
      ${current.status === "delivery_sensitive" ? `<p class="qd-reason">At least ${Math.ceil(current.impressions_needed).toLocaleString("en-US")} target-market ad impressions are needed to fit your CPM cap.</p>` : ""}
      ${current.missing.length ? `<details class="qd-missing"><summary>${current.missing.length} details still needed</summary><ul>${current.missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details>` : ""}`;
  }

  host.addEventListener("input", (event) => {
    const input = event.target;
    if (input.dataset.policy) {
      bundle().policy[input.dataset.policy] = input.dataset.policy === "currency" ? input.value : num(input.value); update();
    } else if (input.dataset.offer) {
      const key = input.dataset.offer;
      offer()[key] = ["unit_price", "min_placements", "placements", "fees", "impressions_low", "impressions_high"].includes(key) ? num(input.value) : input.value;
      reviewed(offer(), false);
      host.querySelector("[data-review]").checked = false;
      host.querySelector(".qd-review-note").textContent = "Offer changed. Review the updated terms before comparing it as eligible.";
      update();
    }
  });
  host.addEventListener("change", async (event) => {
    if (event.target.hasAttribute("data-review")) {
      reviewed(offer(), event.target.checked);
      host.querySelector(".qd-review-note").textContent = event.target.checked ? "Reviewed for these exact inputs. Changing any offer detail resets this review." : "Review is required. Changing offer details resets it.";
      update();
    }
    if (event.target.classList.contains("qd-upload")) {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (file.size > 64000) throw new Error("The quote file is too large.");
        const data = JSON.parse(await file.text());
        if (data?.kind !== "taste_brief_quote_desk" || data.v !== 1 || !Array.isArray(data.offers) || data.offers.length !== shows.length || !data.policy) throw new Error("This is not a compatible quote input file.");
        if (data.offers.some((q) => !q || !shows.some((s) => s.entity_id === q.entity_id)) || new Set(data.offers.map((q) => q.entity_id)).size !== shows.length) throw new Error("This file belongs to a different shortlist. Open that original brief first.");
        if (data.policy.market !== run.market || data.offers.some((q) => q.market !== run.market)) throw new Error("The saved delivery market does not match this brief.");
        if (data.offers.some((q) => !["quote", "rate_card", "scenario"].includes(q.kind))) throw new Error("Offer provenance is missing.");
        const imported = { policy: { ...actual.policy, budget: data.policy.budget, max_cpm: data.policy.max_cpm, currency: data.policy.currency },
          offers: shows.map((s) => reviewed(Object.fromEntries(fields.map((k) => [k, data.offers.find((q) => q.entity_id === s.entity_id)[k]])), false)) };
        if (data.offers.some((q) => q.kind === "scenario")) { scenario = imported; isScenario = true; }
        else { actual.policy = imported.policy; actual.offers = imported.offers; isScenario = false; }
        notice = "Loaded inputs. Results were recalculated for this run and today; review every offer again. Saved verdicts are not trusted."; render();
      } catch (e) { host.querySelector(".qd-notice").textContent = e instanceof SyntaxError ? "This file is not valid JSON. Choose a saved quote input file." : e.message || "Could not read the quote file."; }
    }
  });
  host.addEventListener("click", async (event) => {
    const selectedButton = event.target.closest("[data-select]");
    if (selectedButton) { active = Number(selectedButton.dataset.select); renderEditor(); update(); return; }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "scenario") {
      if (!scenario) scenario = { policy: { ...actual.policy, budget: 1000, max_cpm: 60, currency: "USD" }, offers: shows.map((s, i) => reviewed({ ...empty(s), kind: "scenario", unit_price: [200, 150, 600][i % 3], min_placements: 3, placements: 1, fees: 0,
        impressions_low: 10000, impressions_high: 20000, source_note: "Illustrative assumptions only; not a publisher offer", checked_at: date() }, true)) };
      isScenario = !isScenario; notice = ""; render(); host.querySelector('[data-action="scenario"]').focus({ preventScroll: true });
    } else if (action === "memo") {
      download(`taste-brief-${isScenario ? "scenario" : "decision"}-memo.md`, quoteDecisionMarkdown(evaluate()), "text/markdown");
    } else if (action === "save") {
      download(`taste-brief-${isScenario ? "scenario" : "quote"}-inputs.json`, JSON.stringify({ kind: "taste_brief_quote_desk", v: 1, saved_at: new Date().toISOString(),
        run: { at: run.run?.at || run.recorded?.at, product: run.product, market: run.market, references: run.references }, ...bundle() }, null, 2), "application/json");
    } else if (action === "terms") {
      const text = `Hello ${shows[active].name} team,\n\nWe are exploring a host-read pilot for ${run.product}. Do you accept sponsorships in this category? Please share:\n- Price per placement, currency, minimum placements and all additional fees.\n- Available dates, category exclusivity and when this quote expires.\n- Low and high estimates of ad impressions delivered across the whole package in ${run.market}, with the reporting window and measurement method. Please distinguish ad impressions from episode downloads.\n- Whether the placement and its delivery can be limited to this market.\n\nIf any figures are unavailable, please say so. This is a request for terms, not a booking.\n[YOUR NAME] / [BRAND]`;
      try { await navigator.clipboard.writeText(text); host.querySelector(".qd-notice").textContent = "Copied the terms request for this show. Nothing was sent."; }
      catch { host.querySelector(".qd-notice").textContent = "Clipboard unavailable. The needed terms are listed in this offer's missing-details panel."; }
    } else if (action === "load") host.querySelector(".qd-upload").click();
    else if (action === "current-quote" && !isScenario) {
      actual.offers[active] = empty(shows[active]); renderEditor(); update();
    } else if (action === "rate-card") {
      const card = cardFor(shows[active]);
      if (!card || isScenario) return;
      Object.assign(offer(), { unit_price: card.unit_price, min_placements: card.min_placements, currency: card.currency, source_note: card.source_url, checked_at: card.checked_at, kind: "rate_card" });
      reviewed(offer(), false); renderEditor(); update();
    }
  });
  render();
}
