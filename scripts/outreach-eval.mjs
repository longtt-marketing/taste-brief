// Outreach evaluation: 10 products the app was not built on, run through the same steps a live run takes for the drafts
// (Qloo seed brand, podcasts with sponsor data, the three shows to ask first, one Claude call), then each draft checked in
// plain code (src/outreach.js lintDraft): does the email ask for the five things a buyer needs, carry the code and open
// with the show's name; does any draft hold a number or a product claim the input did not give; how many brackets the
// host read leaves. Keys from .dev.vars, never printed. Full drafts go to .results/ (git-ignored: they quote Qloo
// results); only the checks are written to docs/outreach-eval.json.
//   node scripts/outreach-eval.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { makeQloo } from "../src/qloo.js";
import { anthropicLLM } from "../src/llm.js";
import { podcastPartners, categoryFor } from "../src/podcasts.js";
import { draftOutreach, lintDraft, OUTREACH_SYSTEM, OUTREACH_TOOL } from "../src/outreach.js";
import { askFirst, promoCodes } from "../public/rank.js";

const vars = {};
for (const line of (existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
  if (m && m[2]) vars[m[1]] = m[2];
}
if (!vars.QLOO_API_KEY || !vars.ANTHROPIC_API_KEY) { console.error("needs QLOO_API_KEY and ANTHROPIC_API_KEY in .dev.vars"); process.exit(2); }
const qloo = makeQloo({ apiKey: vars.QLOO_API_KEY });
const llm = anthropicLLM({ apiKey: vars.ANTHROPIC_API_KEY, workspaceId: vars.ANTHROPIC_WORKSPACE_ID || undefined, model: vars.MODEL || undefined, system: OUTREACH_SYSTEM, tools: [OUTREACH_TOOL] });

// fixed before the run; none of them is the example the app was tuned on
export const CASES = [
  ["Wool running sneakers, $120, sustainable", "Chicago, IL", "Allbirds"],
  ["Specialty coffee subscription, $25 a month", "Austin, TX", "Blue Bottle Coffee"],
  ["Plant-based protein powder, $45", "Los Angeles, CA", "Orgain"],
  ["Meal kit for two, $60 a week", "Boston, MA", "HelloFresh"],
  ["Mattress in a box, $900", "Denver, CO", "Casper"],
  ["Language learning app, $13 a month", "Seattle, WA", "Duolingo"],
  ["Natural deodorant, $13", "Miami, FL", "Native"],
  ["Sparkling prebiotic soda, $2.50 a can", "Brooklyn, NY", "Olipop"],
  ["Budgeting app, $99 a year", "San Francisco, CA", "Monarch Money"],
  ["Fresh dog food delivery, $3 a day", "Atlanta, GA", "The Farmer's Dog"],
];
// product claims a draft may not make unless the product line says them
const CLAIMS = /\b(comfortable|comfort|durable|lightweight|breathable|soft|cozy|waterproof|odor[- ]?free|award[- ]winning|best[- ]selling|clinically|organic|vegan|gluten[- ]free|keto|zero sugar|no sugar|non[- ]toxic|aluminum[- ]free|grass[- ]fed|human[- ]grade|vet[- ]approved|free shipping|money[- ]back|guarantee)\b/gi;

// what earlier runs of this file found, kept so a later run does not erase them
const PREVIOUS = existsSync("docs/outreach-eval.json") ? (({ run_at, pass, drafts, first_run, known_issue, earlier }) => ({ run_at, pass, drafts, first_run, known_issue, earlier }))(JSON.parse(readFileSync("docs/outreach-eval.json", "utf8"))) : null;
const rows = [], full = [];
for (const [product, market, reference] of CASES) {
  const row = { product, market, reference };
  try {
    const hits = await qloo.search({ query: reference, types: "urn:entity:brand", take: 5 });
    const key = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const hit = hits.find((h) => key(h.name) === key(reference)) || hits[0];
    row.seed_matched_exactly = !!hit && key(hit.name) === key(reference);
    if (!hit) throw new Error("reference brand not in Qloo");
    const seed = { entity_id: hit.entity_id, name: hit.name };
    const category = categoryFor(reference, null);
    const pods = await podcastPartners({ qloo, seeds: [seed], take: 20, category });
    const { shows } = askFirst(pods.shows);
    const codes = promoCodes(shows.map((s) => s.name));
    const likes = [...await qloo.insights({ filter_type: "urn:entity:brand", entity_ids: [seed.entity_id], location: market, take: 4 }),
      ...await qloo.insights({ filter_type: "urn:entity:artist", entity_ids: [seed.entity_id], location: market, take: 4 })]
      .filter((e) => e.entity_id !== seed.entity_id).sort((a, b) => b.affinity - a.affinity).slice(0, 6).map((e) => e.name);
    const out = await draftOutreach({ llm, product, market, shows, codes, category, alsoLike: likes, reference: seed.name });
    row.drafts = out.shows.map((d) => {
      const show = shows.find((s) => s.name === d.show);
      const lint = lintDraft(d, { product, fit: show?.affinity });
      const claimText = `${d.email_body} ${d.host_read}`.replace(/\[[^\]]*\]/g, " ");
      const claims = [...new Set((claimText.match(CLAIMS) || []).map((c) => c.toLowerCase()))].filter((c) => !product.toLowerCase().includes(c));
      return { ...lint, unsupported_claims: claims, pass: lint.asks_all && lint.code && lint.opens_with_show && !lint.invented_numbers.length && !claims.length
        && lint.host_read_brackets <= 4 && !lint.host_read_repeats.length && !lint.host_read_padding && lint.host_read_words <= 80 };
    });
    row.asked = shows.length;
    full.push({ product, market, reference, category, shows: shows.map((s) => s.name), drafts: out.shows });
  } catch (e) {
    row.error = String(e.message || e);
  }
  rows.push(row);
  console.log(product, row.error || row.drafts.map((d) => (d.pass ? "pass" : "FAIL")).join(" "));
}
const drafts = rows.flatMap((r) => r.drafts || []);
const sum = {
  run_at: new Date().toISOString(), model: vars.MODEL || "claude-sonnet-5-5", cases: rows.length, drafts: drafts.length,
  pass: drafts.filter((d) => d.pass).length, asks_all: drafts.filter((d) => d.asks_all).length, code: drafts.filter((d) => d.code).length,
  opens_with_show: drafts.filter((d) => d.opens_with_show).length, no_invented_numbers: drafts.filter((d) => !d.invented_numbers.length).length,
  no_unsupported_claims: drafts.filter((d) => !d.unsupported_claims.length).length,
  host_read_no_repeats: drafts.filter((d) => !d.host_read_repeats.length).length, host_read_no_padding: drafts.filter((d) => !d.host_read_padding).length,
  host_read_words_mean: drafts.length ? Math.round(drafts.reduce((a, d) => a + d.host_read_words, 0) / drafts.length) : null, host_read_brackets_mean: drafts.length ? +(drafts.reduce((a, d) => a + d.host_read_brackets, 0) / drafts.length).toFixed(2) : null,
  note: "Checks in plain code: the five asks (rate, downloads, host-read slots, dates, exclusivity), the proposed code, the show's name in the opening line, numbers not in the input, a fixed list of product claims not in the input, and in the host read: no number said twice, no filler remarks, at most 80 words. A pass is not a human review; it finds missing asks, invented facts and padding of these kinds only.",
  earlier: PREVIOUS,
  rows,
};
mkdirSync(".results", { recursive: true });
writeFileSync(".results/outreach-eval-full.json", JSON.stringify(full, null, 1));
writeFileSync("docs/outreach-eval.json", JSON.stringify(sum, null, 1));
console.log(JSON.stringify({ ...sum, rows: undefined }, null, 1));
