import { test } from "node:test";
import assert from "node:assert/strict";
import { makeReceipts } from "../src/receipt.js";
import { canonicalPlan, planHash } from "../public/verdict.js";

const memKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, m }; };
const plan = (lockedAt) => canonicalPlan({ product: "Wool sneakers", market: "London, UK", references: "Allbirds", lockedAt,
  tests: [{ variable: "targeting", hypothesis: "h", ad_set: "a", verified: [{ name: "Tracksmith" }], targets: [{ entity_id: "T", name: "Tracksmith", meta_id: "1", meta_name: "Tracksmith" }] }] });

test("receipt: the server keeps the first lock with its own time and never overwrites it", async () => {
  const kv = memKV();
  let t = "2026-10-22T10:00:00.000Z";
  const r = makeReceipts(kv, () => t);
  const c = plan("2026-10-22T09:59:59.000Z");
  const a = await r.lock(c);
  assert.equal(a.created, true);
  assert.equal(a.receipt.hash, await planHash(c));
  assert.equal(a.receipt.received_at, "2026-10-22T10:00:00.000Z");
  t = "2026-11-01T00:00:00.000Z";
  const b = await r.lock(c);
  assert.equal(b.created, false);
  assert.equal(b.receipt.received_at, "2026-10-22T10:00:00.000Z");   // still the first time
  assert.deepEqual(await r.get(a.receipt.hash), a.receipt);
});

test("receipt: a changed plan is a different receipt; junk and oversize text are refused", async () => {
  const r = makeReceipts(memKV());
  const a = await r.lock(plan("2026-10-22T09:00:00.000Z"));
  const b = await r.lock(plan("2026-10-23T09:00:00.000Z"));
  assert.notEqual(a.receipt.hash, b.receipt.hash);
  assert.ok((await r.lock("not json")).error);
  assert.ok((await r.lock(JSON.stringify({ v: 2 }))).error);
  assert.ok((await r.lock("x".repeat(20000))).error);
  assert.equal(await r.get("../etc"), null);
});
