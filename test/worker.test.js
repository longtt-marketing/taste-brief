// End-to-end Worker route checks. All requests use synthetic Qloo + LLM or exit at the access gate.
// No API keys, live calls, advertising spends, or access codes from production are used.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const url = "https://test.example";
const publicAssets = { fetch: async () => new Response("<h1>Static</h1>", { status: 200 }) };
const post = (data) => new Request(url + "/api/brief", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});
const example = {
  product: "Wool running sneakers, $120", market: "London",
  references: "Allbirds", compare_market: "Hanoi",
};
const mockEnv = { MOCK: "1", ASSETS: publicAssets };

test("health correctly discloses synthetic-only mode without secrets", async () => {
  const response = await worker.fetch(new Request(url + "/api/health"), mockEnv);
  const status = await response.json();
  assert.equal(response.status, 200);
  assert.equal(status.ok, true);
  assert.equal(status.live_qloo, false);
  assert.equal(status.live_llm, false);
  assert.equal(status.code_required, false);
});

test("Worker accepts a synthetic brief and returns a grounded, usable test plan", async () => {
  const response = await worker.fetch(post(example), mockEnv);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data).slice(0, 500));
  assert.equal(data.mode, "synthetic");
  assert.equal(data.check.ratio, 1);
  assert.ok(data.brief.test_plan.length >= 1);
  assert.equal(data.markets.market_a, "London");
  assert.equal(data.markets.market_b, "Hanoi");
  assert.ok(data.baseline?.meta_interests?.length >= 2);
});

test("streaming Worker delivers progress then complete synthetic result", async () => {
  const response = await worker.fetch(post({ ...example, stream: true }), mockEnv);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /ndjson/);
  const records = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records[0].type, "start");
  assert.equal(records[0].mode, "synthetic");
  assert.ok(records.some((event) => event.type === "step"));
  const finish = records.find((event) => event.type === "result");
  assert.ok(finish?.brief?.test_plan?.length >= 1);
  assert.equal(finish.check.ratio, 1);
});

test("incorrect judge code returns 401, never downgrades silently to mock", async () => {
  const env = {
    MOCK: "0", QLOO_API_KEY: "test-dummy-key", ANTHROPIC_API_KEY: "test-dummy-key",
    DEMO_CODE: "correct-test-code", ASSETS: publicAssets,
  };
  const response = await worker.fetch(post({ ...example, code: "incorrect" }), env);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.match(body.error, /not recognised/);
  assert.equal(body.mode, undefined);
});

test("public quota exhaustion emits an explicitly synthetic result, and static assets are routed", async () => {
  const env = {
    MOCK: "0", QLOO_API_KEY: "test-dummy-key", ANTHROPIC_API_KEY: "test-dummy-key",
    DEMO_CODE: "correct-test-code", FREE_DAILY: "25",
    QUOTA: { get: async () => "25", put: async () => { throw new Error("should not increment"); } },
    ASSETS: publicAssets,
  };
  const response = await worker.fetch(post(example), env);
  const result = await response.json();
  assert.equal(result.mode, "synthetic");
  assert.match(result.access, /free live runs are used up/);
  const page = await worker.fetch(new Request(url + "/judge.html"), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Static/);
});

test("replay: a live run of the page's example is kept in KV and served at /api/replay; other inputs never are", async () => {
  const { isExample, EXAMPLE } = await import("../src/worker.js");
  assert.equal(isExample({ ...EXAMPLE, code: "x" }), true);
  assert.equal(isExample({ ...EXAMPLE, product: "My secret product" }), false);
  const store = new Map();
  const env = { MOCK: "1", ASSETS: publicAssets, QUOTA: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  assert.equal((await worker.fetch(new Request(url + "/api/replay"), env)).status, 404);
  await worker.fetch(post(EXAMPLE), env); // synthetic run: not live, so nothing is kept
  assert.equal(store.size, 0);
  store.set("replay:example", JSON.stringify({ mode: "replay", market: "London, UK" }));
  const r = await worker.fetch(new Request(url + "/api/replay"), env);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mode, "replay");
});

test("replay: only the owner's live run of the example replaces it, never a visitor's free run", async () => {
  const { keepsReplay, EXAMPLE } = await import("../src/worker.js");
  assert.equal(keepsReplay({ live: true, reason: "access code" }, EXAMPLE, {}), true);
  assert.equal(keepsReplay({ live: true, reason: "free daily quota" }, EXAMPLE, {}), false);
  assert.equal(keepsReplay({ live: false, reason: "no API keys configured" }, EXAMPLE, {}), false);
  assert.equal(keepsReplay({ live: true, reason: "access code" }, { ...EXAMPLE, market: "Paris" }, {}), false);
  assert.equal(keepsReplay({ live: true, reason: "access code" }, EXAMPLE, { incomplete: "bad brief" }), false);
});

test("replay: a recording without the Meta check gets it once, marked as added later; a failed check is not stored", async () => {
  const rec = { mode: "replay", brief: { meta_interests: [{ interest: "Bombas" }, { interest: "Tracksmith (check in Ads Manager)" }] }, baseline: { meta_interests: [{ interest: "Running" }] }, seeds: [], registry: [] };
  const store = new Map([["replay:example", JSON.stringify(rec)]]);
  const env = { MOCK: "1", ASSETS: publicAssets, META_ACCESS_TOKEN: "test-token", QUOTA: { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } } };
  const real = globalThis.fetch;
  try {
    let sent = null;
    globalThis.fetch = async (u, init) => { sent = { u: String(u), init }; return new Response(JSON.stringify([
      { code: 200, body: JSON.stringify({ data: [{ id: "1", name: "Bombas", audience_size_lower_bound: 1, audience_size_upper_bound: 2 }] }) },
      { code: 200, body: JSON.stringify({ data: [] }) },
      { code: 200, body: JSON.stringify({ data: [{ id: "3", name: "Running" }] }) }]), { status: 200 }); };
    const j = await (await worker.fetch(new Request(url + "/api/replay"), env)).json();
    assert.ok(!sent.u.includes("test-token") && !String(sent.init.body).includes("test-token"), "the token travels only in the header");
    assert.deepEqual(j.meta_check.taste_brief.map((m) => m.status), ["targetable", "not_found"]);
    assert.equal(j.meta_check.plain[0].status, "targetable");
    assert.equal(j.meta_check.added_after_recording, true);
    assert.ok(JSON.parse(store.get("replay:example")).meta_check, "stored once");
    // a bad token: every lookup fails, so the page hears that the check did not run, and nothing is stored
    store.set("replay:example", JSON.stringify(rec));
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Error validating access token" } }), { status: 400 });
    const k = await (await worker.fetch(new Request(url + "/api/replay"), env)).json();
    assert.equal(k.meta_check, undefined);
    assert.equal(JSON.parse(store.get("replay:example")).meta_check, undefined);
  } finally {
    globalThis.fetch = real;
  }
});
