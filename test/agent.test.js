import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent, TOOLS, briefProblem } from "../src/agent.js";
import { makeQloo } from "../src/qloo.js";
import { mockQloo } from "../src/mock-qloo.js";
import { anthropicLLM, mockLLM } from "../src/llm.js";

test("mock run ends with a brief whose items all carry evidence", async () => {
  const { brief, trace } = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "London" });
  assert.equal(trace.at(-1).tool, "submit_brief");
  assert.ok(trace.some((t) => t.tool === "demographics"));
  for (const key of ["audience_traits", "meta_interests", "creative_angles"]) {
    assert.ok(brief[key].length > 0, key + " empty");
    for (const item of brief[key]) assert.ok(item.evidence?.length, key + " item without evidence");
  }
  assert.match(brief.caveats.join(" "), /synthetic/i);
});

test("mock run: every line is verified against the Qloo registry, demographics come from Qloo, the typed product is searched", async () => {
  const out = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "Specialty coffee subscription", market: "Seoul", references: "Blue Bottle Coffee" });
  assert.equal(out.trace[0].input.query, "Blue Bottle Coffee");
  assert.equal(out.check.ratio, 1, JSON.stringify(out.check.flagged));
  for (const it of out.brief.meta_interests) assert.ok(it.grounded && it.verified.length, "interest without verified source");
  assert.ok(out.demographics?.age && out.demographics?.gender, "demographics must come from the Qloo call");
  assert.ok(out.seeds.length >= 1);
  const plain = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "Turntable for vinyl beginners", market: "Berlin" });
  assert.equal(plain.trace[0].input.query, "Turntable for vinyl beginners");
});

test("Qloo client: hackathon base URL, X-Api-Key header, GET with query params, slim output", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ results: { entities: [{ name: "A", entity_id: "1", subtype: "urn:entity:brand",
      properties: { description: "x", akas: new Array(50).fill({ value: "long" }) } }] } }), { status: 200 });
  };
  const q = makeQloo({ apiKey: "k", fetchImpl });
  const out = await q.insights({ filter_type: "urn:entity:brand", entity_ids: ["E1", "E2"], location: "London" });
  const u = new URL(calls[0].url);
  assert.equal(u.origin, "https://hackathon.api.qloo.com");
  assert.equal(u.pathname, "/v2/insights");
  assert.equal(u.searchParams.get("signal.interests.entities"), "E1,E2");
  assert.equal(u.searchParams.get("signal.location.query"), "London");
  assert.equal(calls[0].init.headers["X-Api-Key"], "k");
  assert.equal(calls[0].init.method, undefined); // GET
  assert.deepEqual(Object.keys(out[0]).sort(), ["affinity", "description", "entity_id", "name", "popularity", "tags", "type"]);
});

test("Qloo client rejects unsupported filter.type before calling the API", async () => {
  const q = makeQloo({ apiKey: "k", fetchImpl: async () => { throw new Error("should not be called"); } });
  await assert.rejects(q.insights({ filter_type: "urn:entity:music" }), /unsupported/);
});

test("agent turns tool errors into data instead of crashing", async () => {
  const qloo = { ...mockQloo(), async insights() { throw new Error("Qloo 401"); } };
  const { trace } = await runAgent({ llm: mockLLM(), qloo, product: "x product", market: "Hanoi" });
  assert.ok(trace.some((t) => t.error?.includes("401")));
});

test("Anthropic adapter sends tools and maps tool results to tool_result blocks", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "t1", name: "search", input: { query: "q" } }] }), { status: 200 });
  };
  const llm = anthropicLLM({ apiKey: "k", fetchImpl });
  const messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: [{ type: "tool_use", id: "t0", name: "search", input: { query: "a" } }] },
    { role: "tool", results: [{ id: "t0", name: "search", content: "[]" }] },
  ];
  const turn = await llm(messages);
  assert.equal(sent.tools.length, TOOLS.length);
  assert.deepEqual(sent.messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "t0", content: "[]" }] });
  assert.equal(turn.calls[0].name, "search");
});

test("baseline: one call, forced onto submit_brief, no Qloo involved", async () => {
  const { runBaseline } = await import("../src/agent.js");
  const { mockBaselineLLM } = await import("../src/llm.js");
  const brief = await runBaseline({ llm: mockBaselineLLM(), product: "wool sneakers", market: "London" });
  assert.ok(brief.meta_interests.length);
  for (const i of brief.meta_interests) assert.deepEqual(i.evidence, ["model guess, no data"]);
});

test("Anthropic adapter passes tool_choice for the baseline", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ content: [{ type: "tool_use", id: "b", name: "submit_brief", input: {} }] }), { status: 200 });
  };
  const llm = anthropicLLM({ apiKey: "k", fetchImpl, system: "S", tools: [TOOLS.at(-1)], toolChoice: { type: "tool", name: "submit_brief" } });
  await llm([{ role: "user", content: "x" }]);
  assert.equal(sent.system, "S");
  assert.deepEqual(sent.tool_choice, { type: "tool", name: "submit_brief" });
  assert.equal(sent.tools.length, 1);
});

test("normalizeBrief fixes shapes a real model sent (list as JSON string, single object)", async () => {
  const { normalizeBrief } = await import("../src/agent.js");
  const b = normalizeBrief({
    meta_interests: JSON.stringify([{ interest: "Running", evidence: ["x"] }]),
    creative_angles: { angle: "A", hook: "H", evidence: ["y"] },
    landing_page: JSON.stringify({ headline: "H" }),
    caveats: "only one",
  });
  assert.deepEqual(b.meta_interests, [{ interest: "Running", evidence: ["x"], entity_ids: [] }]);
  assert.equal(b.creative_angles.length, 1);
  assert.equal(b.landing_page.headline, "H");
  assert.deepEqual(b.caveats, ["only one"]);
  assert.deepEqual(b.partnerships, []);
});

test("a malformed submit_brief (markup in a field, one item) is sent back, and the resubmitted brief is used", async () => {
  const good = {
    audience_traits: [{ trait: "a", entity_ids: ["X"], evidence: "Qloo: X" }, { trait: "b", entity_ids: ["Y"], evidence: "Qloo: Y" }],
    meta_interests: [{ interest: "X", entity_ids: ["X"], evidence: "Qloo: X" }, { interest: "Y", entity_ids: ["Y"], evidence: "Qloo: Y" }],
    creative_angles: [], partnerships: [], caveats: [],
    test_plan: [{ hypothesis: "h", variable: "creative", ad_set: "X", why: "w", kpi: "CTR", stop_if: "s", entity_ids: ["X"], evidence: "Qloo: X" }],
  };
  const bad = { audience_traits: [{ trait: '\n<parameter name="trait">Loves minimalist' }] };
  let n = 0;
  const llm = async () => {
    n++;
    const input = n === 1 ? bad : good;
    return { raw: [], calls: [{ id: "c" + n, name: "submit_brief", input }] };
  };
  const { brief, trace } = await runAgent({ llm, qloo: mockQloo(), product: "p", market: "London" });
  assert.equal(n, 2);
  assert.match(trace[0].error, /markup|fewer/);
  assert.equal(brief.audience_traits.length, 2);
  assert.equal(briefProblem(brief), null);
});

test("onStep reports every trace entry as it happens, ending with submit_brief", async () => {
  const seen = [];
  const { trace } = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "London", onStep: (s) => seen.push(s.tool) });
  assert.deepEqual(seen, trace.map((t) => t.tool));
  assert.equal(seen.at(-1), "submit_brief");
});

test("Qloo client: a 429 is retried after a wait, and at most `concurrency` requests run at once", async () => {
  let inFlight = 0, peak = 0, n = 0;
  const waits = [];
  const fetchImpl = async () => {
    inFlight++; peak = Math.max(peak, inFlight); const mine = ++n;
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (mine === 1) return new Response(JSON.stringify({ error_msg: "Rate limit exceeded" }), { status: 429 });
    return new Response(JSON.stringify({ results: [{ name: "A", entity_id: "1" }] }), { status: 200 });
  };
  const q = makeQloo({ apiKey: "k", fetchImpl, concurrency: 2, sleep: async (ms) => { waits.push(ms); } });
  const out = await Promise.all([1, 2, 3, 4, 5].map((i) => q.search({ query: "q" + i })));
  assert.equal(out.every((r) => r.length === 1), true);
  assert.equal(waits.length, 1);
  assert.ok(peak <= 2, `peak ${peak}`);
});

test("Qloo client: gives up after the retries and reports the 429", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error_msg: "Rate limit exceeded" }), { status: 429 });
  const q = makeQloo({ apiKey: "k", fetchImpl, retries: 2, sleep: async () => {} });
  await assert.rejects(q.search({ query: "x" }), /429/);
});

// --- evidence gate v2 (entity ids checked against what Qloo returned in the run) ---
const REG_CALLS = [
  { tool: "search", input: { query: "Allbirds" }, output: [{ name: "Allbirds", entity_id: "SEED", type: "urn:entity:brand", affinity: null }] },
  { tool: "insights", input: { filter_type: "urn:entity:brand", entity_ids: ["SEED"], location: "London" }, output: [
    { name: "Outdoor Voices", entity_id: "OV", type: "urn:entity:brand", affinity: 0.966 },
    { name: "Everlane", entity_id: "EV", type: "urn:entity:brand", affinity: 0.956 },
    { name: "Hozier", entity_id: "HZ", type: "urn:entity:artist", affinity: 0.957 }] },
];

test("evidence gate v2: cited ids must be ones Qloo returned; seed-only, combos, wrong numbers and uncited lines are flagged", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom(REG_CALLS);
  assert.deepEqual([...reg.seeds], ["SEED"]);
  const brief = {
    audience_traits: [
      { trait: "Studio fitness", entity_ids: ["OV"], evidence: ["Outdoor Voices (affinity 0.966)"] },  // ok
      { trait: "Runner", entity_ids: ["SEED"], evidence: ["Allbirds tag: Running"] },                  // seed only, not about the seed
      { trait: "Made up", entity_ids: ["NOPE"], evidence: ["x"] },                                      // id never returned
      { trait: "No ids", evidence: ["Everlane"] },                                                      // nothing cited
      { trait: "Wrong number", entity_ids: ["EV"], evidence: ["Everlane (affinity 0.991)"] },           // number mismatch
    ],
    meta_interests: [
      { interest: "Allbirds", entity_ids: ["SEED"], evidence: ["seed"] },                               // ok: about the seed
      { interest: "Hozier / HONNE", entity_ids: ["HZ"], evidence: ["Hozier 0.957"] },                   // combination
      { interest: "Everlane (check in Ads Manager)", entity_ids: ["EV"], evidence: ["Everlane 0.956"] }, // ok
    ],
  };
  const r = checkEvidence(brief, reg);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false, false, false, false, true, false, true]);
  assert.match(r.rows[1].problems.join(), /seed/);
  assert.match(r.rows[2].problems.join(), /did not return/);
  assert.match(r.rows[4].problems.join(), /0\.991 does not match/);
  assert.match(r.rows[6].problems.join(), /combines/);
});

test("evidence gate v2: the mock agent passes 100%, the no-data baseline scores 0", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const { runBaseline } = await import("../src/agent.js");
  const { mockBaselineLLM } = await import("../src/llm.js");
  const out = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "London", references: "Allbirds" });
  assert.equal(out.check.ratio, 1, JSON.stringify(out.check.flagged));
  const reg = { entities: new Map(out.registry.map((e) => [e.entity_id, e])), seeds: new Set(out.seeds) };
  const base = await runBaseline({ llm: mockBaselineLLM(), product: "wool sneakers", market: "London" });
  assert.equal(checkEvidence(base, reg).grounded, 0, "a guess must not pass the gate");
});

test("markets: diffLists splits two Qloo lists into shared (both affinities), only A, only B, in Qloo's order", async () => {
  const { diffLists } = await import("../src/markets.js");
  const a = [{ entity_id: "1", name: "A1", affinity: 0.9 }, { entity_id: "2", name: "S", affinity: 0.8 }, { entity_id: "3", name: "A3", affinity: 0.7 }];
  const b = [{ entity_id: "2", name: "S", affinity: 0.95 }, { entity_id: "9", name: "B9", affinity: 0.6 }];
  const d = diffLists(a, b);
  assert.deepEqual(d.shared, [{ entity_id: "2", name: "S", affinity_a: 0.8, affinity_b: 0.95, rank_a: 2, rank_b: 1 }]);
  assert.deepEqual(d.only_a.map((e) => [e.name, e.rank]), [["A1", 1], ["A3", 3]]);
  assert.deepEqual(d.only_b.map((e) => e.name), ["B9"]);
  assert.equal(d.overlap, 1);
});

test("markets: compareMarkets makes the same Qloo call per market and type, with no model involved, and reports steps", async () => {
  const { compareMarkets, COMPARE_TYPES } = await import("../src/markets.js");
  const calls = [], steps = [];
  const qloo = { ...mockQloo(), async insights(args) { calls.push(args); return mockQloo().insights(args); } };
  const m = await compareMarkets({ qloo, seedIds: ["S1"], marketA: "London", marketB: "Hanoi", onStep: (s) => steps.push(s) });
  assert.equal(calls.length, COMPARE_TYPES.length * 2);
  assert.ok(calls.every((c) => c.entity_ids[0] === "S1"));
  assert.deepEqual([...new Set(calls.map((c) => c.location))].sort(), ["Hanoi", "London"]);
  assert.equal(steps.length, COMPARE_TYPES.length);
  assert.equal(m.types.length, COMPARE_TYPES.length);
  assert.deepEqual((await compareMarkets({ qloo, seedIds: [], marketA: "a", marketB: "b" })).error, "no seed entity to compare");
});

test("normalizeBrief: evidence and entity_ids sent as a lone string become lists at every level", async () => {
  const { normalizeBrief } = await import("../src/agent.js");
  const b = normalizeBrief({ audience_traits: [{ trait: "t", evidence: "one note", entity_ids: "E1" }], landing_page: { headline: "h", evidence: "x" } });
  assert.deepEqual(b.audience_traits[0].evidence, ["one note"]);
  assert.deepEqual(b.audience_traits[0].entity_ids, ["E1"]);
  assert.deepEqual(b.landing_page.evidence, ["x"]);
});

test("evidence gate v2: an age/gender line may rest on the seed when its numbers are Qloo's demographics for that seed", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom([...REG_CALLS, { tool: "demographics", input: { entity_ids: ["SEED"] },
    output: [{ entity_id: "SEED", age: { "30_to_34": 0.42, "45_to_54": -0.53 }, gender: { female: 0.33, male: -0.33 } }] }]);
  const r = checkEvidence({ audience_traits: [
    { trait: "Skews female and 30-34", entity_ids: ["SEED"], evidence: ["30_to_34 +0.42, female +0.33, 45_to_54 -0.53"] },
    { trait: "Skews male", entity_ids: ["SEED"], evidence: ["male +0.71"] },
  ] }, reg);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false]);
  assert.match(r.rows[1].problems.join(), /0\.71 does not match/);
});

test("evidence gate v3: a Meta interest must be named like the Qloo result it cites", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom(REG_CALLS);
  const r = checkEvidence({ meta_interests: [
    { interest: "Outdoor Voices", entity_ids: ["OV"], evidence: ["0.966"] },
    { interest: "Studio fitness", entity_ids: ["OV"], evidence: ["Outdoor Voices"] },
  ] }, reg);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false]);
  assert.match(r.rows[1].problems.join(), /named "Studio fitness" but cites Outdoor Voices/);
});

test("markets: places are filtered to each city, other types only nudged", async () => {
  const { compareMarkets } = await import("../src/markets.js");
  const calls = [];
  const qloo = { ...mockQloo(), async insights(args) { calls.push(args); return mockQloo().insights(args); } };
  const m = await compareMarkets({ qloo, seedIds: ["S1"], marketA: "London", marketB: "Hanoi" });
  const place = calls.filter((c) => c.filter_type === "urn:entity:place");
  assert.deepEqual(place.map((c) => c.filter_location).sort(), ["Hanoi", "London"]);
  assert.ok(calls.filter((c) => c.filter_type !== "urn:entity:place").every((c) => c.filter_location === undefined));
  assert.equal(m.types.find((t) => t.type === "urn:entity:place").filtered, true);
});

test("evidence gate v3: an entity returned by two calls keeps both affinities, and either may be quoted", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom([...REG_CALLS, { tool: "insights", input: { filter_type: "urn:entity:brand", entity_ids: ["SEED"], tag_ids: ["T"] },
    output: [{ name: "Outdoor Voices", entity_id: "OV", type: "urn:entity:brand", affinity: 0.912 }] }]);
  assert.equal(reg.entities.get("OV").affinity, 0.966);
  const r = checkEvidence({ meta_interests: [{ interest: "Outdoor Voices", entity_ids: ["OV"], evidence: ["0.912"] },
    { interest: "Outdoor Voices", entity_ids: ["OV"], evidence: ["0.950"] }] }, reg);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false]);
});

test("test plan: each ad test goes through the evidence gate like any other line", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom(REG_CALLS);
  const brief = { test_plan: [
    { hypothesis: "Studio fitness cues beat running cues", variable: "targeting", ad_set: "Interest: Outdoor Voices", why: "A plain guess targets runners", kpi: "CTR", stop_if: "CTR under control after 3,000 impressions", entity_ids: ["OV"], evidence: ["Outdoor Voices (affinity 0.966)"] },
    { hypothesis: "Runners convert", ad_set: "Interest: Strava", kpi: "CTR", stop_if: "x", entity_ids: [], evidence: ["guess"] },
  ] };
  assert.deepEqual(checkEvidence(brief, reg).rows.map((r) => [r.field, r.grounded]), [["test_plan", true], ["test_plan", false]]);
  const out = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "London", references: "Allbirds" });
  assert.ok(out.brief.test_plan.length >= 1 && out.brief.test_plan.every((t) => t.grounded));
});

test("unbackedBy: the plain guess's interests and partners that Qloo did not return in this run, by name, no model", async () => {
  const { unbackedBy } = await import("../src/evidence.js");
  const base = {
    meta_interests: [{ interest: "Strava" }, { interest: "Outdoor Voices" }, { interest: "parkrun (check in Ads Manager)" }],
    partnerships: [{ partner: "Peloton" }, { partner: "Local running clubs" }],
  };
  const returned = [{ name: "Outdoor Voices" }, { name: "Peloton" }, { name: "Everlane" }];
  assert.deepEqual(unbackedBy(base, returned).map((x) => x.label), ["Strava", "parkrun (check in Ads Manager)", "Local running clubs"]);
  assert.deepEqual(unbackedBy(null, returned), []);
});

test("baseline: a brief with leaked tool markup is asked for again, and the clean one is used", async () => {
  const { runBaseline } = await import("../src/agent.js");
  const bad = { audience_summary: "x", meta_interests: ["\n<parameter name=\"interest\">Running"], audience_traits: [] };
  const good = { audience_summary: "y", meta_interests: [{ interest: "Strava" }, { interest: "parkrun" }], audience_traits: [] };
  const seen = [];
  const llm = async (m) => { seen.push(m[0].content); const input = seen.length === 1 ? bad : good; return { raw: [], calls: [{ id: "b", name: "submit_brief", input }] }; };
  const b = await runBaseline({ llm, product: "p", market: "m" });
  assert.equal(b.audience_summary, "y");
  assert.match(seen[1], /rejected: a field contains tool-call markup/);
  await assert.rejects(runBaseline({ llm: async () => ({ raw: [], calls: [] }), product: "p", market: "m" }), /no brief/);
});

test("unbackedBy: a tag Qloo returned in the run (e.g. running) counts as returned", async () => {
  const { unbackedBy } = await import("../src/evidence.js");
  const out = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "running sneakers", market: "London", references: "Allbirds" });
  assert.ok(out.tags.length >= 1);
  const name = out.tags[0].name;
  assert.deepEqual(unbackedBy({ meta_interests: [{ interest: name }, { interest: "Zzz unknown" }] }, [...out.registry, ...out.tags]).map((x) => x.label), ["Zzz unknown"]);
});

test("evidence gate: a popularity score Qloo returned for the cited entity may be quoted, a made up one may not", async () => {
  const { registryFrom, checkEvidence } = await import("../src/evidence.js");
  const reg = registryFrom([{ tool: "insights", input: { filter_type: "urn:entity:brand", entity_ids: ["SEED"] }, output: [
    { name: "Herschel Supply Co", entity_id: "HS", type: "urn:entity:brand", affinity: 0.919, popularity: 0.986 }] }]);
  const r = checkEvidence({ meta_interests: [
    { interest: "Herschel Supply Co", entity_ids: ["HS"], evidence: ["Herschel Supply Co (affinity 0.919), popularity 0.986"] },
    { interest: "Herschel Supply Co", entity_ids: ["HS"], evidence: ["Herschel Supply Co (affinity 0.919), popularity 0.777"] },
  ] }, reg);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false]);
});
