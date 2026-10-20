// Cloudflare Worker: serves the page (public/) and POST /api/brief.
// Keys come from Worker secrets: QLOO_API_KEY, ANTHROPIC_API_KEY. With MOCK=1 (or no keys) it runs on synthetic data.
//
// Who gets live data (live runs cost API money, so the public page is bounded):
// - a correct access code (DEMO_CODE secret): always live;
// - a wrong code: HTTP 401 "access code not recognised" (never a silent switch to synthetic data);
// - no code: live while today's free quota lasts (FREE_DAILY, default 25 runs, counted in the QUOTA KV namespace), then
//   synthetic data, clearly labelled. Without DEMO_CODE configured (local dev) everything is live when keys exist.
import { runAgent, runBaseline, BASELINE_SYSTEM, TOOLS } from "./agent.js";
import { compareMarkets } from "./markets.js";
import { makeQloo } from "./qloo.js";
import { mockQloo } from "./mock-qloo.js";
import { anthropicLLM, mockLLM, mockBaselineLLM } from "./llm.js";

/** Constant-time compare for the demo access code. */
function same(a, b) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const today = () => new Date().toISOString().slice(0, 10);
const RUN_TIMEOUT_MS = 150000;

async function quota(env) {
  const limit = Number(env.FREE_DAILY || 25);
  if (!env.QUOTA) return { limit, used: limit, left: 0 };
  const used = Number(await env.QUOTA.get(`free:${today()}`)) || 0;
  return { limit, used, left: Math.max(0, limit - used) };
}

/** Decide the mode for one request. Returns {live, reason, quota} or {error, status}. */
async function access(env, code) {
  const keys = env.MOCK !== "1" && !!env.QLOO_API_KEY && !!env.ANTHROPIC_API_KEY;
  if (!keys) return { live: false, reason: "no API keys configured" };
  if (!env.DEMO_CODE) return { live: true, reason: "local" };
  const c = String(code || "").slice(0, 100).trim();
  if (c) return same(c, env.DEMO_CODE) ? { live: true, reason: "access code" } : { error: "access code not recognised", status: 401 };
  const q = await quota(env);
  if (q.left > 0) {
    await env.QUOTA.put(`free:${today()}`, String(q.used + 1), { expirationTtl: 3 * 86400 });
    return { live: true, reason: "free daily quota", quota: { ...q, used: q.used + 1, left: q.left - 1 } };
  }
  return { live: false, reason: "today's free live runs are used up", quota: q };
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`the run took longer than ${ms / 1000} s; please try again`)), ms))]);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      const keys = env.MOCK !== "1" && !!env.QLOO_API_KEY && !!env.ANTHROPIC_API_KEY;
      return json({ ok: true, live_qloo: keys, live_llm: keys, code_required: !!env.DEMO_CODE, free_today: env.DEMO_CODE ? await quota(env) : null });
    }
    if (url.pathname === "/api/brief" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "send JSON" }, 400); }
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "send a JSON object" }, 400);
      const product = String(body.product || "").slice(0, 400).trim();
      const market = String(body.market || "").slice(0, 120).trim();
      const references = String(body.references || "").slice(0, 300).trim();
      const marketB = String(body.compare_market || "").slice(0, 120).trim();
      if (product.length < 3 || market.length < 2) return json({ error: "product and market are required" }, 400);

      const acc = await access(env, body.code);
      if (acc.error) return json({ error: acc.error }, acc.status);
      const live = acc.live;
      const qloo = live ? makeQloo({ apiKey: env.QLOO_API_KEY }) : mockQloo();
      const llm = live ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined }) : mockLLM();
      const baseLLM = live
        ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: BASELINE_SYSTEM,
          tools: TOOLS.filter((t) => t.name === "submit_brief") }) // forced tool_choice is rejected by the model; the prompt asks for it
        : mockBaselineLLM();
      const meta = { mode: live ? "live" : "synthetic", access: acc.reason, quota: acc.quota || null };

      // One run: the agent (Qloo + Claude) and the no-data baseline side by side; then, with a second market, the
      // Qloo-only comparison on the agent's own seed entities. A failed baseline or comparison never sinks the brief.
      const run = async (send) => {
        const [out, baseline] = await Promise.all([
          runAgent({ llm, qloo, product, market, references, onStep: (s) => send({ type: "step", run: market, step: s }) }),
          body.compare === false ? null : runBaseline({ llm: baseLLM, product, market, references })
            .then((b) => { send({ type: "step", run: "no-data baseline", step: { tool: "baseline_done" } }); return b; })
            .catch((e) => ({ error: String(e.message || e) })),
        ]);
        // demographics straight from Qloo when the agent skipped them
        if (!out.demographics && out.seeds.length) {
          const d = await qloo.demographics({ entity_ids: out.seeds }).catch(() => []);
          if (d[0]) out.demographics = { seeds: out.seeds.map((id) => out.registry.find((e) => e.entity_id === id)?.name || id), age: d[0].age, gender: d[0].gender };
        }
        const markets = marketB.length >= 2
          ? await compareMarkets({ qloo, seedIds: out.seeds.slice(0, 3), marketA: market, marketB,
            onStep: (s) => send({ type: "step", run: `${market} vs ${marketB}`, step: s }) }).catch((e) => ({ error: String(e.message || e) }))
          : null;
        return { ...meta, market, ...out, baseline, markets };
      };

      // stream: true -> NDJSON lines {type:"step"} as the agent works, then {type:"result"} or {type:"error"}: a live run
      // takes about a minute, and a page that shows each Qloo call is easier to trust than a spinner.
      if (body.stream === true) {
        const { readable, writable } = new TransformStream();
        const w = writable.getWriter();
        const enc = new TextEncoder();
        const send = (o) => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
        (async () => {
          try {
            await send({ type: "start", ...meta });
            await send({ type: "result", ...(await withTimeout(run(send), RUN_TIMEOUT_MS)) });
          } catch (e) {
            await send({ type: "error", error: String(e.message || e) });
          } finally {
            await w.close().catch(() => {});
          }
        })();
        return new Response(readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
      }
      try {
        return json(await withTimeout(run(() => {}), RUN_TIMEOUT_MS));
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
