// Server receipts for locked test plans. The browser hashes the plan; the server hashes the same text again and stores
// it under its hash with the server's own clock, and does not replace a receipt it already has. A results upload is
// checked against the stored receipt, so a plan rewritten after the numbers came in shows up as a different plan with a
// later receipt. KV has no conditional write: two locks of the SAME plan at the same instant could both store, with
// times a moment apart. That cannot backdate a plan or swap one plan for another, since a different plan is a
// different hash and the time is always the server's.
import { planHash } from "../public/verdict.js";

const MAX = 16000;                        // a plan is a few KB; anything larger is not a plan
const TTL = 120 * 86400;                  // keep receipts beyond judging and follow-up
const HEX = /^[0-9a-f]{64}$/;

export function makeReceipts(kv, now = () => new Date().toISOString()) {
  return {
    /** Store a plan once. Returns {receipt, created} or {error}. */
    async lock(canonical) {
      if (typeof canonical !== "string" || !canonical || canonical.length > MAX) return { error: "send the plan text" };
      let plan;
      try { plan = JSON.parse(canonical); } catch { return { error: "the plan must be JSON" }; }
      if (![1, 2, 3].includes(plan?.v) || !Array.isArray(plan.tests) || !plan.rule) return { error: "not a Taste Brief plan" };
      const hash = await planHash(canonical);
      const key = `lock:${hash}`;
      const old = await kv.get(key);
      if (old) return { receipt: JSON.parse(old), created: false };
      const receipt = { hash, id: hash.slice(0, 8), received_at: now(), canonical };
      await kv.put(key, JSON.stringify(receipt), { expirationTtl: TTL });
      return { receipt, created: true };
    },
    async get(hash) {
      if (!HEX.test(String(hash || ""))) return null;
      const s = await kv.get(`lock:${hash}`);
      return s ? JSON.parse(s) : null;
    },
  };
}
