// Server receipts for locked test plans. The browser hashes the plan; the server hashes the same text again, stores it
// once under its hash with the server's own clock, and never overwrites it. A results upload is checked against the
// stored receipt, so a plan rewritten after the numbers came in shows up as a different plan with a later receipt.
import { planHash } from "../public/verdict.js";

const MAX = 16000;                        // a plan is a few KB; anything larger is not a plan
const TTL = 120 * 86400;                  // kept well past judging (16 Nov 2026)
const HEX = /^[0-9a-f]{64}$/;

export function makeReceipts(kv, now = () => new Date().toISOString()) {
  return {
    /** Store a plan once. Returns {receipt, created} or {error}. */
    async lock(canonical) {
      if (typeof canonical !== "string" || !canonical || canonical.length > MAX) return { error: "send the plan text" };
      let plan;
      try { plan = JSON.parse(canonical); } catch { return { error: "the plan must be JSON" }; }
      if (plan?.v !== 1 || !Array.isArray(plan.tests) || !plan.rule) return { error: "not a Taste Brief plan" };
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
