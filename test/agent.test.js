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
  assert.deepEqual(b.meta_interests, [{ interest: "Running", evidence: ["x"] }]);
  assert.equal(b.creative_angles.length, 1);
  assert.equal(b.landing_page.headline, "H");
  assert.deepEqual(b.caveats, ["only one"]);
  assert.deepEqual(b.partnerships, []);
});

test("two markets: mock data differs by market and compareBriefs separates unique interests", async () => {
  const { compareBriefs } = await import("../public/compare.js");
  const a = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "London, UK" });
  const b = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "wool sneakers", market: "Hanoi, Vietnam" });
  const c = compareBriefs(a.brief, b.brief);
  assert.ok(c.interests.only_a.length + c.interests.only_b.length > 0, "two markets should differ");
  const same = compareBriefs(a.brief, a.brief);
  assert.equal(same.interests.only_a.length, 0);
  assert.equal(same.interests.shared.length, a.brief.meta_interests.length);
});

test("evidence gate: mock agent brief is grounded in Qloo results, the no-data baseline is not", async () => {
  const { checkEvidence } = await import("../src/evidence.js");
  const { runBaseline } = await import("../src/agent.js");
  const { mockBaselineLLM } = await import("../src/llm.js");
  const { brief, sources } = await runAgent({ llm: mockLLM(), qloo: mockQloo(), product: "Allbirds", market: "London" });
  assert.ok(sources.length > 5, "agent must report what Qloo returned");
  const a = checkEvidence(brief, sources);
  assert.ok(a.total >= 5 && a.ratio === 1, `agent grounded ${a.grounded}/${a.total}`);
  const base = await runBaseline({ llm: mockBaselineLLM(), product: "Allbirds", market: "London" });
  assert.equal(checkEvidence(base, sources).grounded, 0, "a guess must not pass the gate");
});

test("evidence gate: an item whose evidence names nothing Qloo returned is flagged", async () => {
  const { checkEvidence, sourcesFrom } = await import("../src/evidence.js");
  const sources = sourcesFrom([[{ name: "Sample Oat Milk Cafe" }], [{ age: { "25_to_29": 0.4 }, gender: { female: 0.2 } }]]);
  const r = checkEvidence({
    audience_traits: [{ trait: "coffee", evidence: ["Sample Oat Milk Cafe affinity 0.81"] }, { trait: "yoga", evidence: ["everyone knows"] }],
    demographics: { age: "25_to_29", evidence: ["age 25_to_29 0.41"] },
  }, sources);
  assert.deepEqual(r.rows.map((x) => x.grounded), [true, false, true]);
});

test("a malformed submit_brief (markup in a field, one item) is sent back, and the resubmitted brief is used", async () => {
  const good = {
    audience_traits: [{ trait: "a", evidence: "Qloo: X" }, { trait: "b", evidence: "Qloo: Y" }],
    meta_interests: [{ interest: "X", evidence: "Qloo: X" }, { interest: "Y", evidence: "Qloo: Y" }],
    creative_angles: [], partnerships: [], caveats: [],
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

test("evidence gate: an interest that is exactly a returned Qloo entity counts; a near name or a trait does not", async () => {
  const { checkEvidence } = await import("../src/evidence.js");
  const sources = ["Warby Parker", "Everlane"];
  const brief = {
    meta_interests: [{ interest: "Warby Parker", evidence: ["Affinity 0.957"] }, { interest: "Warby", evidence: ["Affinity 0.9"] }],
    audience_traits: [{ trait: "Everlane", evidence: ["guess"] }],
  };
  const r = checkEvidence(brief, sources);
  assert.deepEqual(r.rows.map((x) => [x.label, x.grounded]), [["Everlane", false], ["Warby Parker", true], ["Warby", false]]);
});
