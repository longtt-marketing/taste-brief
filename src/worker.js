// Cloudflare Worker: serves the page (public/) and POST /api/brief.
// Keys come from Worker secrets: QLOO_API_KEY, ANTHROPIC_API_KEY. With MOCK=1 (or no keys) it runs on synthetic data.
import { runAgent, runBaseline, BASELINE_SYSTEM, TOOLS } from "./agent.js";
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
  status, headers: { "content-type": "application/json; charset=utf-8" },
});

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, live_qloo: !!env.QLOO_API_KEY && env.MOCK !== "1", live_llm: !!env.ANTHROPIC_API_KEY && env.MOCK !== "1",
        code_required: !!env.DEMO_CODE });
    }
    if (url.pathname === "/api/brief" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return json({ error: "send JSON" }, 400); }
      const product = String(body.product || "").slice(0, 400).trim();
      const market = String(body.market || "").slice(0, 120).trim();
      const references = String(body.references || "").slice(0, 300).trim();
      if (product.length < 3 || market.length < 2) return json({ error: "product and market are required" }, 400);

      // Each half goes live as soon as its key exists, so the Claude path can be tested before the Qloo key arrives.
      // On the public deploy DEMO_CODE is set: live calls (which cost money) need the code; without it, synthetic data.
      const unlocked = !env.DEMO_CODE || same(String(body.code || "").slice(0, 100), env.DEMO_CODE);
      const liveQloo = unlocked && env.MOCK !== "1" && !!env.QLOO_API_KEY;
      const liveLLM = unlocked && env.MOCK !== "1" && !!env.ANTHROPIC_API_KEY;
      const live = liveQloo && liveLLM;
      const qloo = liveQloo ? makeQloo({ apiKey: env.QLOO_API_KEY }) : mockQloo();
      // one model instance per agent run: the mock keeps per-run state and usage is counted per instance
      const makeLLM = () => liveLLM
        ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined })
        : mockLLM();
      const marketB = String(body.compare_market || "").slice(0, 120).trim();
      const submitOnly = TOOLS.filter((t) => t.name === "submit_brief");
      const baseLLM = liveLLM
        ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: BASELINE_SYSTEM,
          tools: submitOnly }) // forced tool_choice is rejected by the model; the prompt asks for submit_brief
        : mockBaselineLLM();
      try {
        // grounded agent and no-data baseline run side by side; a failed baseline must not sink the real brief
        // optional second market: same product, same agent, so the page can show what Qloo says differently per market
        const [out, baseline, other] = await Promise.all([
          runAgent({ llm: makeLLM(), qloo, product, market, references }),
          body.compare === false ? null : runBaseline({ llm: baseLLM, product, market, references }).catch((e) => ({ error: String(e.message || e) })),
          marketB.length >= 2
            ? runAgent({ llm: makeLLM(), qloo, product, market: marketB, references }).catch((e) => ({ error: String(e.message || e) }))
            : null,
        ]);
        const market_b = other ? { market: marketB, ...other } : null;
        return json({ mode: live ? "live" : liveLLM ? "claude + synthetic Qloo" : "mock", market, ...out, baseline, market_b });
      } catch (e) {
        return json({ error: String(e.message || e) }, 502);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
