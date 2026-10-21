// Qloo scores for the podcast sponsorship check (docs/podcast-check/PREREGISTRATION.md). Resolves held-out shows and
// dictionary brands in Qloo by exact name, then asks Qloo, per brand, for the affinity of each fixed batch of <= 50 shows.
// Input/output in .results/podcast (git-ignored; raw Qloo responses are not published).
// Run: node --env-file=.dev.vars scripts/podcast/score.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeQloo } from "../../src/qloo.js";

const DIR = ".results/podcast";
const qloo = makeQloo({ apiKey: process.env.QLOO_API_KEY });
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const mentions = JSON.parse(readFileSync(`${DIR}/heldout-mentions.json`, "utf8"));
const meta = JSON.parse(readFileSync(`${DIR}/heldout-meta.json`, "utf8"));
const brandsDict = JSON.parse(readFileSync("docs/podcast-check/brands.json", "utf8"));

// shows that list sponsors at all: >= 3 dictionary brands carried (>= 2 episodes each)
const carried = (d) => Object.entries(d || {}).filter(([, n]) => n >= 2).map(([b]) => b);
const listing = Object.keys(mentions).filter((s) => carried(mentions[s]).length >= 3);
listing.sort((a, b) => meta[a].genre.localeCompare(meta[b].genre) || meta[a].rank - meta[b].rank);

const shows = [];
for (const name of listing) {
  const hits = await qloo.search({ query: name, types: "urn:entity:podcast", take: 5 }).catch(() => []);
  const e = hits.find((x) => norm(x.name) === norm(name));
  if (e) shows.push({ name, id: e.entity_id, qname: e.name, popularity: e.popularity ?? null, ...meta[name] });
}
console.log("listing shows", listing.length, "resolved exactly", shows.length);

// brands carried by >= 3 resolved shows
const count = {};
for (const s of shows) for (const b of carried(mentions[s.name])) count[b] = (count[b] || 0) + 1;
const brandNames = Object.keys(count).filter((b) => count[b] >= 3 && brandsDict[b]);
// leakage check pairs, fixed in the pre-registration: both sides are scored even if one is carried by fewer shows
export const PAIRS = [["DraftKings", "FanDuel"], ["BetterHelp", "Talkspace"], ["HelloFresh", "Factor"], ["Mint Mobile", "Visible"], ["NordVPN", "ExpressVPN"], ["Eight Sleep", "Helix Sleep"]];
for (const pair of PAIRS) for (const b of pair) if (!brandNames.includes(b)) brandNames.push(b);
const brands = [];
for (const b of brandNames) {
  const hits = await qloo.search({ query: b, types: "urn:entity:brand", take: 5 }).catch(() => []);
  const e = hits.find((x) => norm(x.name) === norm(b));
  if (e) brands.push({ name: b, id: e.entity_id, qname: e.name });
  else console.log("brand not resolved exactly:", b);
}
console.log("brands with >= 3 shows", brandNames.length, "resolved exactly", brands.length);

// fixed batches of <= 50 shows, the same for every brand
const batches = [];
for (let i = 0; i < shows.length; i += 50) batches.push(shows.slice(i, i + 50));
const scores = {};
for (const b of brands) {
  scores[b.name] = {};
  for (const [bi, batch] of batches.entries()) {
    const res = await qloo.insights({ filter_type: "urn:entity:podcast", entity_ids: [b.id], result_ids: batch.map((s) => s.id), take: batch.length }).catch((e) => ({ error: String(e) }));
    const list = res?.entities || res?.results?.entities || res || [];
    for (const x of Array.isArray(list) ? list : []) scores[b.name][x.entity_id] = { affinity: x.affinity ?? x.query?.affinity, batch: bi };
  }
  process.stdout.write(".");
}
writeFileSync(`${DIR}/heldout-scores.json`, JSON.stringify({ run_at: new Date().toISOString(), shows, brands, batches: batches.map((b) => b.map((s) => s.id)), scores }, null, 1));
console.log("\nwrote", `${DIR}/heldout-scores.json`);
