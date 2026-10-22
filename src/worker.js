// Cloudflare Worker: serves the page (public/) and POST /api/brief.
// Keys come from Worker secrets: QLOO_API_KEY, ANTHROPIC_API_KEY. With MOCK=1 (or no keys) it runs on synthetic data.
//
// Who gets live data (live runs cost API money, so the public page is bounded):
// - a correct access code (DEMO_CODE secret): always live;
// - a wrong code: HTTP 401 "access code not recognised" (never a silent switch to synthetic data);
// - no code: live while today's free quota lasts (FREE_DAILY, default 25 runs, counted in the QUOTA KV namespace), then
//   synthetic data, clearly labelled. Without DEMO_CODE configured (local dev) everything is live when keys exist.
import { runAgent, runBaseline, BASELINE_SYSTEM, TOOLS } from "./agent.js";
import { unbackedBy } from "./evidence.js";
import { gradePicks, summarize, norm } from "./grade.js";
import { makeSelfCheck } from "./selfcheck.js";

const list = (v) => (Array.isArray(v) ? v : []);
import { compareMarkets } from "./markets.js";
import { makeReceipts } from "./receipt.js";
import { podcastPartners, categoryFor } from "./podcasts.js";
import { makeQloo } from "./qloo.js";
import { mockQloo } from "./mock-qloo.js";
import { anthropicLLM, mockLLM, mockBaselineLLM } from "./llm.js";
import { draftOutreach, mockOutreachLLM, lintDraft, OUTREACH_SYSTEM, OUTREACH_TOOL } from "./outreach.js";
import { askFirst, promoCodes } from "../public/rank.js";

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
const RUN_TIMEOUT_MS = 170000; // the self-check can add one model turn

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
  // Clear the timer when the work finishes: an armed timer holds the Node test process open and keeps per-request
  // resources alive on the Worker (found by an outside review, 20 Oct).
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`the run took longer than ${ms / 1000} s; please try again`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// The example on the page. Its last live run is kept so a judge can see a real result at once, without a code or a
// two minute wait. Only this exact example is kept, never what a visitor typed, and only in KV, not in git.
export const EXAMPLE = { product: "Wool running sneakers, $120, sustainable", market: "New York, NY", compare_market: "London, UK", references: "Allbirds" };
const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
export const isExample = (b) => Object.keys(EXAMPLE).every((k) => sameText(b?.[k], EXAMPLE[k]));
const REPLAY_KEY = "replay:example";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/replay") {
      const saved = env.QUOTA ? await env.QUOTA.get(REPLAY_KEY).catch(() => null) : null;
      return saved ? new Response(saved, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } })
        : json({ error: "no recorded run yet" }, 404);
    }
    if (url.pathname === "/api/lock" && req.method === "POST") {
      if (!env.QUOTA) return json({ error: "receipts are not stored here" }, 503);
      let body;
      try { body = await req.json(); } catch { return json({ error: "send JSON" }, 400); }
      const out = await makeReceipts(env.QUOTA).lock(body?.canonical);
      return out.error ? json({ error: out.error }, 400) : json(out, out.created ? 201 : 200);
    }
    if (url.pathname.startsWith("/api/lock/")) {
      if (!env.QUOTA) return json({ error: "receipts are not stored here" }, 503);
      const receipt = await makeReceipts(env.QUOTA).get(url.pathname.slice("/api/lock/".length));
      return receipt ? json({ receipt }) : json({ error: "no receipt for that plan" }, 404);
    }
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
      // every Qloo call of the run is counted here, the agent's, the self-check's and the fixed steps', so the page reports the real number
      let qlooCount = 0;
      const rawQloo = live ? makeQloo({ apiKey: env.QLOO_API_KEY }) : mockQloo();
      const qloo = Object.fromEntries(Object.entries(rawQloo).map(([k, f]) => [k, typeof f === "function" ? (...a) => { qlooCount++; return f(...a); } : f]));
      const llm = live ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined }) : mockLLM();
      const baseLLM = live
        ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: BASELINE_SYSTEM,
          tools: TOOLS.filter((t) => t.name === "submit_brief") }) // forced tool_choice is rejected by the model; the prompt asks for it
        : mockBaselineLLM();
      const outLLM = live
        ? anthropicLLM({ apiKey: env.ANTHROPIC_API_KEY, workspaceId: env.ANTHROPIC_WORKSPACE_ID, model: env.MODEL || undefined, system: OUTREACH_SYSTEM, tools: [OUTREACH_TOOL] })
        : mockOutreachLLM();
      const meta = { mode: live ? "live" : "synthetic", access: acc.reason, quota: acc.quota || null };

      // One run: the agent (Qloo + Claude) and the no-data baseline side by side; then, with a second market, the
      // Qloo-only comparison on the agent's own seed entities. A failed baseline or comparison never sinks the brief.
      const run = async (send) => {
        const t0 = Date.now();
        // the agent's buying steps: it ranks the podcasts itself and chooses which shows get drafts (src/agent.js)
        const bought = { pods: null, outreach: null };
        const alsoLikeFrom = (registry, seedIds) => registry.filter((e) => !seedIds.includes(e.entity_id) && typeof e.affinity === "number" && /brand|artist/.test(String(e.type)))
          .sort((a, b) => b.affinity - a.affinity).slice(0, 6).map((e) => e.name);
        const actions = {
          podcasts: async ({ entity_ids, category }, { registry }) => {
            const seeds = list(entity_ids).slice(0, 3).map((id) => ({ entity_id: id, name: registry.find((e) => e.entity_id === id)?.name || id }));
            if (!seeds.length) return { error: "pass the seed entity_ids" };
            const p = await podcastPartners({ qloo, seeds, take: 20, category: categoryFor(references, category) });
            if (p.error) return { error: p.error };
            bought.pods = p; bought.seeds = seeds;
            const suggested = new Set(askFirst(p.shows).shows.map((x) => x.name));
            return { n: p.shows.length, for_model: { category: p.category, shows: p.shows.map((x) => ({ name: x.name, taste_fit: Math.round(x.affinity * 1000) / 1000,
              advertisers_found: Array.isArray(x.advertisers) ? x.advertisers.length : "not in our data", sample_advertisers: list(x.advertisers).slice(0, 4),
              category_brands_found: x.rivals ?? "unknown", suggested_first: suggested.has(x.name) })) } };
          },
          draft_outreach: async ({ shows, reason }, { registry }) => {
            const p = bought.pods;
            if (!p) return { error: "call podcasts first" };
            const chosen = list(shows).slice(0, 3).map((n) => p.shows.find((x) => norm(x.name) === norm(n))).filter(Boolean);
            if (!chosen.length) return { error: "use exact show names from the podcasts result" };
            const codes = promoCodes(chosen.map((x) => x.name));
            const o = await draftOutreach({ llm: outLLM, product, market, shows: chosen, codes, category: p.category, alsoLike: alsoLikeFrom(registry, bought.seeds.map((x) => x.entity_id)),
              reference: bought.seeds.map((x) => x.name).join(", "), timeoutMs: Math.min(60000, RUN_TIMEOUT_MS - (Date.now() - t0) - 30000) });
            bought.outreach = { ...o, chosen_by: "agent", reason: String(reason || "").replace(/\s+[—–]\s+/g, ", ").slice(0, 300) };
            const checks = o.shows.map((d) => { const l = lintDraft(d, { product, fit: chosen.find((x) => x.name === d.show)?.affinity });
              return { show: d.show, passed: l.asks_all && l.code && !l.invented_numbers.length, missing_asks: Object.keys(l.asks).filter((k) => !l.asks[k]), invented_numbers: l.invented_numbers }; });
            return { n: o.shows.length, for_model: { drafts: o.shows.length, checks } };
          },
        };
        const [out, baseline] = await Promise.all([
          runAgent({ llm, qloo, product, market, references, check: makeSelfCheck({ qloo, market }), actions, onStep: (s) => send({ type: "step", run: market, step: s }) }),
          body.compare === false ? null : runBaseline({ llm: baseLLM, product, market, references })
            .then((b) => { send({ type: "step", run: "no-data baseline", step: { tool: "baseline_done" } }); return b; })
            .catch((e) => ({ error: String(e.message || e) })),
        ]);
        // demographics straight from Qloo when the agent skipped them
        if (!out.demographics && out.seeds.length) {
          const d = await qloo.demographics({ entity_ids: out.seeds }).catch(() => []);
          if (d[0]) out.demographics = { seeds: out.seeds.map((id) => out.registry.find((e) => e.entity_id === id)?.name || id), age: d[0].age, gender: d[0].gender };
        }
        // the plain guess and the brief's interests, scored by the same Qloo grader (src/grade.js), next to the city comparison
        const seedNames = new Set(out.seeds.map((id) => String(out.registry.find((e) => e.entity_id === id)?.name || "").toLowerCase()));
        const picks = (b) => list(b?.meta_interests).map((i) => String(i?.interest || "").trim())
          .filter((n) => n && !seedNames.has(n.toLowerCase().replace(/\s*\(check in ads manager\)\s*/i, ""))).slice(0, 10);
        const gradeBoth = async () => {
          if (!baseline || baseline.error || !out.seeds.length) return null;
          const known = new Map(out.registry.map((e) => [norm(e.name), e])); // the brief's own picks are graded as the entities it cited
          const [tb, plain] = [await gradePicks(qloo, picks(out.brief), out.seeds, market, known), await gradePicks(qloo, picks(baseline), out.seeds, market, known)];
          send({ type: "step", run: market, step: { tool: "graded", n: tb.length + plain.length } });
          return { taste_brief: { graded: tb, ...summarize(tb) }, plain: { graded: plain, ...summarize(plain) } };
        };
        const seedEntities = out.seeds.map((id) => ({ entity_id: id, name: out.registry.find((e) => e.entity_id === id)?.name || id }));
        const [markets, scored, podcasts] = await Promise.all([
          marketB.length >= 2
            ? compareMarkets({ qloo, seedIds: out.seeds.slice(0, 3), marketA: market, marketB,
              onStep: (s) => send({ type: "step", run: `${market} vs ${marketB}`, step: s }) }).catch((e) => ({ error: String(e.message || e) }))
            : null,
          gradeBoth().catch(() => null),
          // the agent's own podcast step when it took it; otherwise the same steps run here as a fallback
          bought.pods ? Promise.resolve({ ...bought.pods, outreach: bought.outreach || undefined }).then(async (p) => {
            if (p.outreach) return p;
            const first = askFirst(p.shows).shows;
            if (!first.length) return p;
            p.outreach = await draftOutreach({ llm: outLLM, product, market, shows: first, codes: promoCodes(first.map((x) => x.name)), category: p.category,
              alsoLike: alsoLikeFrom(out.registry, out.seeds), reference: seedEntities.map((e) => e.name).join(", "), timeoutMs: Math.min(60000, RUN_TIMEOUT_MS - (Date.now() - t0) - 15000) })
              .catch((e) => ({ error: String(e.message || e) }));
            return p;
          }) : seedEntities.length ? podcastPartners({ qloo, seeds: seedEntities, take: 20, category: categoryFor(references, out.brief?.category) })
            // the agent's outreach drafts for the shows to ask first, as soon as the shows are known
            .then(async (p) => {
              const first = askFirst(p?.shows).shows;
              if (!first.length) return p;
              const codes = promoCodes(first.map((s) => s.name));
              const seedSet = new Set(out.seeds);
              const alsoLike = out.registry.filter((e) => !seedSet.has(e.entity_id) && typeof e.affinity === "number" && /brand|artist/.test(String(e.type)))
                .sort((a, b) => b.affinity - a.affinity).slice(0, 6).map((e) => e.name);
              const left = RUN_TIMEOUT_MS - (Date.now() - t0) - 15000;
              p.outreach = await draftOutreach({ llm: outLLM, product, market, shows: first, codes, category: p.category, alsoLike,
                reference: seedEntities.map((e) => e.name).join(", "), timeoutMs: Math.min(60000, left) })
                .then((o) => { send({ type: "step", run: market, step: { tool: "outreach", n: o?.shows?.length || 0 } }); return o; })
                .catch((e) => ({ error: String(e.message || e) }));
              return p;
            })
            .catch((e) => ({ error: String(e.message || e) })) : null,
        ]);
        // what the plain guess would target that Qloo did not return anywhere in this run (entities, tags or city lists)
        const returned = [...out.registry, ...(out.tags || []), ...(markets?.types || []).flatMap((t) => [...(t.only_a || []), ...(t.only_b || []), ...(t.shared || [])])];
        const unbacked = baseline && !baseline.error ? unbackedBy(baseline, returned) : null;
        // enough to check a run later without publishing Qloo payloads: which deployed version, how long, how many calls
        // the city comparison makes one insights call per city for each list type
        const graded = [...(scored?.taste_brief?.graded || []), ...(scored?.plain?.graded || [])];
        const qlooCalls = qlooCount;
        const runInfo = { version: env.CF_VERSION_METADATA?.id || "local", seconds: Math.round((Date.now() - t0) / 1000),
          qloo_calls: qlooCalls, model_calls: (llm.usage?.calls || 0) + (baseLLM.usage?.calls || 0) + (outLLM.usage?.calls || 0), at: new Date().toISOString() };
        // the inputs go back to the same visitor only, so the page can lock the test plan with them
        const result = { ...meta, product, references, compare_market: marketB, market, ...out, baseline, unbacked, scored, markets, podcasts, run: runInfo };
        if (live && isExample(body) && env.QUOTA && !result.incomplete) {
          const { quota, access, ...keep } = result;
          await env.QUOTA.put(REPLAY_KEY, JSON.stringify({ ...keep, mode: "replay", recorded: { at: runInfo.at, version: runInfo.version, inputs: EXAMPLE } })).catch(() => {});
        }
        return result;
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
