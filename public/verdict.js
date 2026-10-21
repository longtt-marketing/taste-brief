// Closing the loop: lock the test plan before any money is spent, then read the results back with the rule that was
// locked. Pure functions, no model, run in the browser and in the tests (test/verdict.test.js).

// One rule for every test, fixed by the tool rather than written by the model, so the result can't be argued later.
export const RULE = { cap: 300, minAddsToCart: 20, worseBy: 0.3 };

/** The plan as it gets locked: control, tests and rule, in a fixed key order so the same plan always hashes the same. */
export function canonicalPlan({ product, market, references, tests, rule = RULE, lockedAt }) {
  return JSON.stringify({
    v: 1, product: String(product || ""), market: String(market || ""), references: String(references || ""),
    rule: { cap: rule.cap, minAddsToCart: rule.minAddsToCart, worseBy: rule.worseBy },
    control: "Broad targeting in the market, same ages, the usual message",
    tests: (tests || []).map((t, i) => ({ arm: `Test ${i + 1}`, variable: t.variable || "", hypothesis: t.hypothesis || "", ad_set: t.ad_set || "",
      cited: (t.verified || []).map((e) => e.name).filter(Boolean) })),
    locked_at: lockedAt,
  });
}

/** SHA-256 of the canonical plan, hex. Works in browsers and in Node 20+ (globalThis.crypto.subtle). */
export async function planHash(canonical) {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The ad set sheet: one row per arm, named with the plan id so results can be matched back to the locked plan. */
export function adSetRows({ market, tests, planId, rule = RULE }) {
  const city = String(market || "").split(",")[0];
  const names = (t) => (t.verified || []).map((e) => e.name).filter(Boolean);
  const rows = [{ ad_set: `TB-${planId} Control`, changes: "nothing (the control)", targeting: `Broad, ${city}`, creative: "Your usual message",
    budget_cap: rule.cap }];
  (tests || []).forEach((t, i) => rows.push({
    ad_set: `TB-${planId} Test ${i + 1}`,
    changes: t.variable === "targeting" ? "targeting only" : t.variable === "creative" ? "creative only" : String(t.variable || ""),
    targeting: t.variable === "targeting" ? `Interests: ${names(t).join("; ")}, ${city}` : `Broad, ${city}`,
    creative: t.variable === "creative" ? String(t.ad_set || "") : "Your usual message",
    budget_cap: rule.cap,
  }));
  return rows;
}

export function toCsv(rows) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((r) => keys.map((k) => q(r[k])).join(","))].join("\n");
}

/** Minimal CSV reader for an Ads Manager export: quoted fields, commas, header row. */
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') inQ = false; else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

// Ads Manager column names vary by language and report setup: accept the common ones.
const pick = (row, names) => { for (const n of Object.keys(row)) if (names.some((x) => n.toLowerCase() === x || n.toLowerCase().startsWith(x))) return row[n]; return undefined; };
const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : 0; };

/** Results per arm from an Ads Manager export, matched to the locked plan by the "TB-<planId> ..." ad set names. */
export function readResults(csvRows, planId) {
  const arms = {};
  for (const r of csvRows) {
    const name = String(pick(r, ["ad set name", "ad set"]) ?? "");
    const m = name.match(/^TB-([0-9a-f]{6,})\s+(Control|Test \d+)\b/i);
    if (!m) continue;
    if (planId && m[1].toLowerCase() !== String(planId).toLowerCase()) continue;
    const arm = m[2].replace(/^control$/i, "Control").replace(/^test/i, "Test");
    const a = (arms[arm] ||= { spend: 0, addsToCart: 0 });
    a.spend += num(pick(r, ["amount spent", "spend"]));
    a.addsToCart += num(pick(r, ["adds to cart", "add to cart", "website adds to cart"]));
  }
  return arms;
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
    if (ratio < 1) return { ...out, ratio, verdict: "ahead", why: `Cost per add to cart is ${Math.round((1 - ratio) * 100)}% below the control.` };
    return { ...out, ratio, verdict: "no clear difference", why: `Within ${Math.round(rule.worseBy * 100)}% of the control and not cheaper.` };
  });
}
