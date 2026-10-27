import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQloo } from "../src/qloo.js";
import { registryFrom, verifyItem } from "../src/evidence.js";
import { runAgent } from "../src/agent.js";
import { mockLLM } from "../src/llm.js";
const nil = "00000000-0000-0000-0000-000000000000";
const valid = { entity_id: "valid", name: "Example", query: { affinity: 0.8 } };
test("provider: HTTP 200 with nil, missing or colliding identities is a fatal evidence error", async () => {
  for (const entities of [[{ ...valid, entity_id: nil }], [{ name: "Missing" }], [valid, { ...valid, name: "Someone else" }]]) {
    const q = makeQloo({ apiKey: "fixture", fetchImpl: async (url) => new Response(JSON.stringify({ results: url.includes("/search") ? entities : { entities } })) });
    await assert.rejects(q.search({ query: "Example" }), { code: "QLOO_INVALID_IDENTITIES" });
    await assert.rejects(q.insights({ filter_type: "urn:entity:brand", entity_ids: ["seed"] }), { code: "QLOO_INVALID_IDENTITIES" });
  }
});
test("provider: invalid input never reaches Qloo; valid empty results still work", async () => {
  let calls = 0;
  const q = makeQloo({ apiKey: "fixture", fetchImpl: async () => { calls++; return new Response('{"results":[]}'); } });
  await assert.rejects(q.insights({ filter_type: "urn:entity:brand", entity_ids: [nil] }), { code: "QLOO_INVALID_IDENTITIES" });
  await assert.rejects(q.demographics({ entity_ids: [nil] }), { code: "QLOO_INVALID_IDENTITIES" });
  assert.equal(calls, 0);
  assert.deepEqual(await q.search({ query: "Unknown" }), []);
});
test("provider: the agent stops after corrupted identities instead of inventing a usable brief", async () => {
  let calls = 0;
  const q = makeQloo({ apiKey: "fixture", fetchImpl: async () => { calls++; return new Response(JSON.stringify({ results: [{ ...valid, entity_id: nil }] })); } });
  await assert.rejects(runAgent({ qloo: q, llm: mockLLM(), product: "Example", market: "London" }), { code: "QLOO_INVALID_IDENTITIES" });
  assert.equal(calls, 1);
});
test("provider: stored traces with nil or ambiguous identities cannot ground claims", () => {
  const reg = registryFrom([
    { tool: "search", output: [valid, { ...valid, entity_id: nil }] },
    { tool: "insights", input: { entity_ids: ["seed"] }, output: [{ ...valid, name: "Different", affinity: 0.8 }, { ...valid, entity_id: nil, affinity: 0.8 }] },
    { tool: "insights", input: { entity_ids: ["seed"] }, output: [valid] },
  ]);
  assert.equal(reg.entities.size, 0);
  for (const id of [nil, "valid"]) assert.equal(verifyItem("meta_interests", { interest: "Example", entity_ids: [id], evidence: ["affinity 0.8"] }, reg).grounded, false);
});
