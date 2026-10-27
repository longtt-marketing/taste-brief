// Closing the loop: lock the test plan before any money is spent, then read the results back with the rule that was
// locked. Pure functions, no model, run in the browser and in the tests (test/verdict.test.js).

// One rule for every test, fixed by the tool rather than written by the model, so the result can't be argued later.
// ahead needs a clear margin too (betterBy), so a 1% cheaper test does not move the budget (media buyer review, 22 Oct)
export const RULE = { cap: 300, minAddsToCart: 20, worseBy: 0.3, betterBy: 0.15 };

const list = (v) => (Array.isArray(v) ? v : []);
// Formatting equivalence only: keep all words, accents and qualifiers. Never guess that Pitchfork means Pitchfork Media.
const lookupName = (name) => String(name || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");

/** A single explicit target list feeds the readiness decision, plan receipt and CSV. Old recorded targeting tests
 * without a selection remain readable, but cannot silently become a launchable plan. */
export function testReadiness(test, metaCheck, product = "") {
  const issues = [], targets = [], missing = [];
  if (test?.grounded !== true) issues.push("The test's Qloo evidence has not passed its checks.");
  if (!["creative", "targeting"].includes(test?.variable)) issues.push("Choose one variable: creative or targeting.");
  const selected = list(test?.targeting_entity_ids);
  if (test?.variable === "creative" && selected.length) issues.push("A creative test must keep the broad control audience.");
  if (test?.variable === "creative") issues.push(...creativeIssues(test, product));
  if (test?.variable === "targeting") {
    if (!Array.isArray(test.targeting_entity_ids) || !selected.length) issues.push("This plan has no explicit targeting selection. Generate a new plan before locking it.");
    for (const id of new Set(selected)) {
      const entity = list(test.verified).find((e) => e.entity_id === id);
      if (!entity?.name || !list(test.entity_ids).includes(id)) { issues.push("A selected target has no verified Qloo citation."); continue; }
      const matches = list(metaCheck?.taste_brief).filter((m) => lookupName(m.name) === lookupName(entity.name));
      const identities = new Set(matches.filter((m) => m.status === "targetable").map((m) => String(m.interest?.id || "")));
      if (identities.size > 1) { issues.push(`Meta has ambiguous identities for ${entity.name}.`); continue; }
      const check = matches.find((m) => m.status === "targetable") || matches[0];
      if (check?.status === "not_found") { missing.push(entity.name); issues.push(`Meta did not find ${entity.name}.`); }
      else if (metaCheck?.error || check?.status !== "targetable" || !/^\d+$/.test(String(check?.interest?.id || "")) || !check?.interest?.name) {
        issues.push(`Meta has not verified ${entity.name}.`);
      } else targets.push({ entity_id: id, name: entity.name, meta_id: String(check.interest.id), meta_name: check.interest.name });
    }
  }
  return { ready: issues.length === 0, issues, targets, missing };
}

/** Kept for callers that need the specific missing names; readiness also rejects unknown/error states. */
export function missingInMeta(test, metaCheck) {
  if (test?.variable !== "targeting") return [];
  return testReadiness(test, metaCheck).missing;
}

/** Tests that passed the evidence and interest checks, ready for a planning sheet (not an advertising approval). Two AI reviews on 22 Oct asked that a test
 *  naming a missing interest never be presented, or locked, as ready. */
export function readyTests(tests, metaCheck, product = "") {
  return list(tests).flatMap((t) => {
    const checked = testReadiness(t, metaCheck, product);
    return checked.ready ? [{ ...t, targets: checked.targets }] : [];
  });
}

/** The human-readable download uses the same gate as the page, receipt and planning sheet. */
export function testPlanMarkdown(tests, metaCheck, product = "") {
  return list(tests).map((test, i) => {
    const check = testReadiness(test, metaCheck, product);
    return `- Test ${i + 1}: ${check.ready ? "ELIGIBLE for the planning sheet; review in Ads Manager before spending" : `HELD: ${check.issues.join(" ")}`}\n`
      + `  Hypothesis: ${test.hypothesis || ""}\n  Proposed change (${test.variable || "unknown"}): ${test.ad_set || ""}\n`
      + (test.variable === "creative" ? `  Proposed copy: ${creativeOf(test) || "not supplied as explicit copy"}\n  Buyer review: ${creativeIssues(test, product).length ? "not completed for this copy and product" : test.creative_review.reviewed_at}\n` : "")
      + (check.targets.length ? `  Verified targets: ${check.targets.map((t) => `${t.meta_name} (${t.meta_id})`).join("; ")}\n` : "")
      + `  Why: ${test.why || ""}`;
  }).join("\n");
}

/** The plan as it gets locked: control, tests and rule, in a fixed key order so the same plan always hashes the same. */
export function canonicalPlan({ product, market, references, tests, rule = RULE, lockedAt }) {
  return JSON.stringify({
    v: 3, product: String(product || ""), market: String(market || ""), references: String(references || ""),
    rule: { cap: rule.cap, minAddsToCart: rule.minAddsToCart, worseBy: rule.worseBy, betterBy: rule.betterBy },
    control: "Broad targeting in the market, same ages, the usual message",
    tests: (tests || []).map((t, i) => ({ arm: `Test ${i + 1}`, variable: t.variable || "", hypothesis: t.hypothesis || "", ad_set: t.ad_set || "",
      cited: (t.verified || []).map((e) => e.name).filter(Boolean), targets: checkedTargets(t),
      ...(t.variable === "creative" ? lockedCreative(t, product) : {}) })),
    locked_at: lockedAt,
  });
}

/** SHA-256 of the canonical plan, hex. Works in browsers and in Node 20+ (globalThis.crypto.subtle). */
export async function planHash(canonical) {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Exact copy only. A hypothesis or a loose substring of ad_set must never become an ad in the CSV. */
export function creativeOf(t) {
  return typeof t?.creative_copy === "string" ? t.creative_copy.trim() : "";
}

export function creativeIssues(test, product = "") {
  const copy = creativeOf(test), review = test?.creative_review;
  const issues = [];
  if (!copy) issues.push("Enter the exact ad copy; a hypothesis is not ad copy.");
  if (/\[[^\]]+\]/.test(copy)) issues.push("Resolve the copy's bracketed placeholders before reviewing it.");
  if (!review || review.copy !== copy || review.product !== String(product || "") || !Number.isFinite(Date.parse(review.reviewed_at))) {
    issues.push("Review the product claims in this exact copy. Qloo checks audience evidence, not product quality or endorsements.");
  }
  return issues;
}

/** Buyer attestation, not an automated fact check. Editing the copy or product invalidates it. */
export function reviewCreative(test, { copy, product, at }) {
  const text = String(copy || "").trim();
  if (test?.variable !== "creative" || !text || /\[[^\]]+\]/.test(text) || !Number.isFinite(Date.parse(at))) {
    throw new Error("Enter complete creative copy without bracketed placeholders before reviewing it.");
  }
  return { ...test, creative_copy: text,
    ad_set: "Keep the control's broad audience and ages. Use the reviewed copy below instead of the usual creative.",
    creative_review: { copy: text, product: String(product || ""), reviewed_at: at } };
}

function lockedCreative(test, product) {
  const issues = creativeIssues(test, product);
  if (issues.length) throw new Error(issues.join(" "));
  return { creative_copy: creativeOf(test), creative_review: { ...test.creative_review } };
}

function checkedTargets(test) {
  if (test.variable !== "targeting") return [];
  if (!Array.isArray(test.targets) || !test.targets.length || test.targets.some((t) =>
    !t.entity_id || !t.name || !t.meta_name || !/^\d+$/.test(String(t.meta_id || "")))) {
    throw new Error("This plan has no verified targeting list. Generate and check it before exporting.");
  }
  return test.targets.map(({ entity_id, name, meta_id, meta_name }) => ({ entity_id, name, meta_id, meta_name }));
}

/** The ad set sheet: one row per arm, named with the plan id so results can be matched back to the locked plan, with the
 *  settings every arm shares so they differ only in the one thing each test changes. */
export function adSetRows({ market, product = "", tests, planId, rule = RULE }) {
  const city = String(market || "").split(",")[0];
  const same = { ages: "same as your usual ad", optimization: "Add to cart", placements: "Advantage+ placements", budget: `lifetime, up to ${rule.cap} in your account currency`, schedule: "7 days, all arms start together", attribution: "7-day click, 1-day view" };
  const rows = [{ ad_set: `TB-${planId} Control`, changes: "nothing (the control)", targeting: `Broad, ${city}`, meta_interest_ids: "", creative: "Your usual ad", ...same }];
  (tests || []).forEach((t, i) => rows.push({
    ad_set: `TB-${planId} Test ${i + 1}`,
    changes: t.variable === "targeting" ? "targeting only" : t.variable === "creative" ? "creative only" : String(t.variable || ""),
    targeting: t.variable === "targeting" ? `Interests: ${checkedTargets(t).map((x) => x.meta_name).join("; ")}, ${city}` : `Broad, ${city}`,
    meta_interest_ids: checkedTargets(t).map((x) => x.meta_id).join("; "),
    creative: t.variable === "creative" ? lockedCreative(t, product).creative_copy : "Your usual ad",
    ...same,
  }));
  return rows;
}

/** A loaded receipt is the sole source of every exported setting, regardless of the brief currently on screen. */
export function lockedPlanRows(locked) {
  const plan = JSON.parse(locked.canonical);
  if (![1, 2, 3].includes(plan.v) || !Array.isArray(plan.tests)) throw new Error("Unsupported locked plan.");
  return adSetRows({ market: plan.market, product: plan.product, tests: plan.tests, rule: plan.rule, planId: locked.id });
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => q(r[k])).join(","))].join("\n");
}

/** Minimal CSV reader for an Ads Manager export: quoted fields, header row; comma, semicolon or tab separated (European
 *  exports use semicolons). */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  const head0 = String(text || "").split(/\r?\n/)[0] || "";
  const count = (c) => head0.split(c).length;
  const sep = count("\t") > count(",") && count("\t") > count(";") ? "\t" : count(";") > count(",") ? ";" : ",";
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') inQ = false; else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// Ads Manager column names vary by language and report setup: accept the common ones. An exact name wins over a prefix
// ("Adds to cart" before "Adds to cart conversion value"), and a prefix match skips value, rate and cost columns.
const pick = (row, names) => {
  const keys = Object.keys(row);
  for (const x of names) { const k = keys.find((n) => n.toLowerCase().trim() === x); if (k) return row[k]; }
  const pre = keys.filter((n) => names.some((x) => n.toLowerCase().startsWith(x)) && !/value|rate|cost|per /i.test(n)).sort((a, b) => a.length - b.length);
  return pre.length ? row[pre[0]] : undefined;
};
/** A number as Ads Manager writes it: "1,040.00", "1.040,00", "1 040,00" or "300". */
export const num = (v) => {
  let t = String(v ?? "").replace(/[^0-9.,\-]/g, "");
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // "1.280": European thousands without decimals
  else if (t.lastIndexOf(",") > t.lastIndexOf(".") && /,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

// Adds to cart: its own column, or Meta's default Results column when the result indicator is an add to cart
const addsOf = (row) => {
  const v = pick(row, ["adds to cart", "add to cart", "website adds to cart"]);
  if (v !== undefined) return v;
  const ind = pick(row, ["result indicator"]);
  return ind !== undefined && /cart/i.test(String(ind)) ? pick(row, ["results"]) : undefined;
};

/** Results per arm from an Ads Manager export, matched to the locked plan by the "TB-<planId> ..." ad set names. With
 *  `arms` (the plan's own arm names) any other ad set is left out. */
export function readResults(csvRows, planId, arms = null) {
  const out = {};
  for (const r of csvRows) {
    const name = String(pick(r, ["ad set name", "ad set"]) ?? "");
    const m = name.match(/^TB-([0-9a-f]{6,})\s+(Control|Test \d+)\b/i);
    if (!m) continue;
    if (planId && m[1].toLowerCase() !== String(planId).toLowerCase()) continue;
    const arm = m[2].replace(/^control$/i, "Control").replace(/^test/i, "Test");
    if (arms && !arms.includes(arm)) continue;
    const a = (out[arm] ||= { spend: 0, addsToCart: 0 });
    a.spend += num(pick(r, ["amount spent", "spend"]));
    a.addsToCart += num(addsOf(r));
  }
  return out;
}

/** Why an uploaded file gave no results for this plan, in plain words (null when it did). */
export function problemWith(csvRows, planId) {
  if (!csvRows.length) return "That file has no rows. Export a CSV from Ads Manager at the ad set level.";
  if (pick(csvRows[0], ["ad set name", "ad set"]) === undefined) return "That file has no Ad set name column. Export at the ad set level, with Amount spent and Adds to cart.";
  const ids = [...new Set(csvRows.map((r) => (String(pick(r, ["ad set name", "ad set"]) ?? "").match(/^TB-([0-9a-f]{6,})\s/i) || [])[1]).filter(Boolean).map((x) => x.toLowerCase()))];
  if (!ids.length) return `No ad sets in that file are named TB-${planId}. Name each ad set as in the planning sheet.`;
  if (!ids.includes(String(planId).toLowerCase())) return `The ad sets in that file belong to another plan (TB-${ids.slice(0, 2).join(", TB-")}). This plan is TB-${planId}.`;
  if (addsOf(csvRows[0]) === undefined) return "That file has no Adds to cart column. Add it to the report and export again.";
  if (pick(csvRows[0], ["amount spent", "spend"]) === undefined) return "That file has no Amount spent column. Add it to the report and export again.";
  const arms = readResults(csvRows, planId);
  if (!arms.Control) return `The file has ad sets for TB-${planId} but no control. Add the Control ad set to the export.`;
  if (Object.keys(arms).length < 2) return `The file has only the control for TB-${planId}. Add the test ad sets to the export.`;
  return null;
}

/**
 * The locked rule, applied: an arm is judged only when it and the control both have enough adds to cart. Worse means a
 * cost per add to cart more than `worseBy` above the control's. Hitting the cap first is inconclusive, never a loss.
 */
export function verdicts(arms, rule = RULE) {
  const c = arms.Control;
  const cpa = (a) => (a && a.addsToCart > 0 ? a.spend / a.addsToCart : null);
  return Object.keys(arms).filter((k) => k !== "Control").sort().map((arm) => {
    const a = arms[arm];
    const out = { arm, spend: a.spend, addsToCart: a.addsToCart, cost: cpa(a), controlCost: cpa(c) };
    if (!c) return { ...out, verdict: "no control", why: "The export has no control ad set for this plan." };
    const enough = a.addsToCart >= rule.minAddsToCart && c.addsToCart >= rule.minAddsToCart;
    if (!enough) {
      const capped = a.spend >= rule.cap || c.spend >= rule.cap;
      return capped
        ? { ...out, verdict: "inconclusive", why: `Hit the ${rule.cap} cap before both arms had ${rule.minAddsToCart} adds to cart.` }
        : { ...out, verdict: "keep running", why: `Not enough data yet: needs ${rule.minAddsToCart} adds to cart in this arm and the control.` };
    }
    const ratio = out.cost / out.controlCost;
    if (ratio > 1 + rule.worseBy) return { ...out, ratio, verdict: "pause", why: `Cost per add to cart is ${Math.round((ratio - 1) * 100)}% above the control.` };
    const better = rule.betterBy ?? 0;
    if (ratio < 1 && ratio <= 1 - better) return { ...out, ratio, verdict: "ahead", why: `Cost per add to cart is ${Math.round((1 - ratio) * 100)}% below the control.` };
    return { ...out, ratio, verdict: "no clear difference", why: `${ratio < 1 ? `${Math.round((1 - ratio) * 100)}% cheaper` : `${Math.round((ratio - 1) * 100)}% dearer`} than the control, inside the band (${Math.round(better * 100)}% cheaper to ${Math.round(rule.worseBy * 100)}% dearer).` };
  });
}
