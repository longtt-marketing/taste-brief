// LLM adapters. Each returns llm(messages) -> {raw, calls:[{id,name,input}]}.
// Internal message format (see agent.js): {role:"user",content:string} | {role:"assistant",content:raw} | {role:"tool",results:[...]}
import { SYSTEM, TOOLS } from "./agent.js";

// opts: {system, tools, toolChoice} override the agent defaults (used by the no-data baseline).
export function anthropicLLM({ apiKey, workspaceId, model = "claude-sonnet-5-5", fetchImpl = fetch, system = SYSTEM, tools = TOOLS, toolChoice, timeoutMs = 90000 }) {
  const toAnthropic = (messages) => messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.content })),
      };
    }
    return { role: m.role, content: m.content };
  });
  const run = async (messages) => {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      // keys not scoped to a workspace must name one (Anthropic returns 400 otherwise)
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}) },
      body: JSON.stringify({
        model, max_tokens: 16000, system, tools, messages: toAnthropic(messages),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const calls = body.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
    usage.calls++;
    // 4096 was too low once adaptive thinking counts against it: a cut off submit_brief came back as broken markup
    if (body.stop_reason === "max_tokens") usage.truncated++;
    usage.input_tokens += body.usage?.input_tokens || 0;
    usage.output_tokens += body.usage?.output_tokens || 0;
    return { raw: body.content, calls };
  };
  // token count of every call made through this adapter, to measure the real cost of one brief
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0, truncated: 0 };
  run.usage = usage;
  return run;
}

/**
 * Scripted stand-in for the model, so the app, the loop and the UI can be built and tested before any key exists.
 * It follows the same method the system prompt asks for and writes the brief only from tool results it received.
 */
export function mockLLM() {
  let step = 0;
  const seen = {};
  return async (messages) => {
    const last = messages[messages.length - 1];
    let weak = [];
    if (last.role === "tool") for (const r of last.results) {
      // the self-check report is text: drop the interests it names as weak, as the real agent is asked to
      if (String(r.content).startsWith("Self-check")) weak = (String(r.content).match(/Weak or not in Qloo: (.*?)\. Replace/) || [, ""])[1].split(", ");
      else seen[r.name + ":" + r.id] = JSON.parse(r.content);
    }
    const first = messages[0]?.content || "";
    const market = (first.match(/Market: ([^\n]*)/) || [])[1] || "";
    const product = (first.match(/Product: ([^\n]*)/) || [])[1] || "product";
    const refs = ((first.match(/competitors \(optional\): ([^\n]*)/) || [])[1] || "").split(",").map((x) => x.trim()).filter((x) => x && x !== "none");
    const seedQuery = refs[0] || product;
    const ids = () => (Object.entries(seen).find(([k]) => k.startsWith("search:"))?.[1] || []).map((e) => e.entity_id).slice(0, 2);
    const tagIds = () => (Object.entries(seen).find(([k]) => k.startsWith("tags:"))?.[1] || []).map((t) => t.tag_id).slice(0, 2);
    const plan = [
      () => [{ name: "search", input: { query: seedQuery, types: "urn:entity:brand", take: 3 } }],
      () => [{ name: "tags", input: { query: product.split(",")[0], take: 2 } }],
      () => [
        { name: "insights", input: { filter_type: "urn:entity:brand", entity_ids: ids(), tag_ids: tagIds(), location: market, take: 6 } },
        { name: "insights", input: { filter_type: "urn:entity:artist", entity_ids: ids(), location: market, take: 6 } },
        { name: "insights", input: { filter_type: "urn:entity:podcast", entity_ids: ids(), location: market, take: 4 } },
        { name: "demographics", input: { entity_ids: ids() } },
      ],
      () => [{ name: "submit_brief", input: briefFrom(seen, product, weak) }],
    ];
    const calls = (plan[step] || plan[plan.length - 1])().map((c, i) => ({ ...c, id: `mock_${step}_${i}` }));
    step++;
    return { raw: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })), calls };
  };
}

function briefFrom(seen, product, weak = []) {
  const all = Object.entries(seen);
  const pick = (re) => all.filter(([k, v]) => k.startsWith("insights") && Array.isArray(v) && v[0]?.type?.match(re)).flatMap(([, v]) => v);
  const brands = pick(/brand/), artists = pick(/artist/), pods = pick(/podcast/);
  return {
    audience_summary: `[SYNTHETIC DATA] People whose tastes overlap with "${product}" also over-index on ${brands.slice(0, 2).map((b) => b.name).join(" and ")} and listen to ${artists[0]?.name || "?"}.`,
    audience_traits: brands.slice(0, 3).map((b) => ({ trait: `Shares taste with ${b.name}`, entity_ids: [b.entity_id], evidence: [`${b.name} (affinity ${b.affinity})`] })),
    meta_interests: [...brands.slice(0, 3), ...artists.slice(0, 2)].filter((e) => !weak.includes(e.name)).map((e) => ({ interest: e.name, entity_ids: [e.entity_id], evidence: [`${e.name} (affinity ${e.affinity})`] })),
    creative_angles: pods.slice(0, 2).map((p) => ({ angle: `Speak like ${p.name}`, hook: "Placeholder hook from a synthetic run", entity_ids: [p.entity_id], evidence: [p.name] })),
    landing_page: { headline: "[SYNTHETIC] Headline written from taste signals", subheadline: "Replace by a live run", entity_ids: brands.slice(0, 1).map((b) => b.entity_id), evidence: brands.slice(0, 1).map((b) => b.name) },
    partnerships: brands.slice(3, 5).map((b) => ({ partner: b.name, idea: "Co-branded drop (synthetic)", entity_ids: [b.entity_id], evidence: [b.name] })),
    test_plan: brands.slice(0, 2).map((b, i) => ({ hypothesis: `[SYNTHETIC] This audience responds to ${b.name} cues`, variable: i ? "targeting" : "creative", ad_set: i ? `Interest: ${b.name}, with the control's usual creative` : `A creative in ${b.name}'s tone, shown to the control's broad audience`, why: "[SYNTHETIC] A plain guess would not name this brand.", kpi: "Cost per add to cart", stop_if: "Spend up to $300. Pause if cost per add to cart is 30% above the control once each arm has 20 add to carts, or at the cap.", entity_ids: [b.entity_id], evidence: [`${b.name} (affinity ${b.affinity})`] })),
    caveats: ["Synthetic run: all Qloo data is made up, not a real recommendation. Live mode uses real Qloo data."],
    holdout_rival: "Sample Rival Brand", category: "footwear",
  };
}

/** Mock of the no-data baseline: what a model writes from general knowledge alone. */
export function mockBaselineLLM() {
  const guess = "model guess, no data";
  return async (messages) => {
    const product = ((messages?.[0]?.content || "").match(/Product: ([^\n]*)/) || [])[1] || "this product";
    const input = {
      audience_summary: `[SYNTHETIC] Urban professionals aged 25 to 40 who would like "${product}".`,
      audience_traits: [{ trait: "Values quality", entity_ids: [], evidence: [guess] }, { trait: "Busy city lifestyle", entity_ids: [], evidence: [guess] }],
      meta_interests: [product, "Online shopping", "Lifestyle"].map((interest) => ({ interest, entity_ids: [], evidence: [guess] })),
      creative_angles: [{ angle: "Made for your day", hook: "Generic hook", entity_ids: [], evidence: [guess] }],
      landing_page: { headline: "[SYNTHETIC] Generic headline", subheadline: "Generic copy", entity_ids: [], evidence: [guess] },
      partnerships: [{ partner: "Local influencers", idea: "Generic cross-promo", entity_ids: [], evidence: [guess] }],
      caveats: ["Synthetic baseline: written without any data."],
    };
    return { raw: [{ type: "tool_use", id: "base_0", name: "submit_brief", input }], calls: [{ id: "base_0", name: "submit_brief", input }] };
  };
}
