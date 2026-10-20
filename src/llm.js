// LLM adapters. Each returns llm(messages) -> {raw, calls:[{id,name,input}]}.
// Internal message format (see agent.js): {role:"user",content:string} | {role:"assistant",content:raw} | {role:"tool",results:[...]}
import { SYSTEM, TOOLS } from "./agent.js";

// opts: {system, tools, toolChoice} override the agent defaults (used by the no-data baseline).
export function anthropicLLM({ apiKey, workspaceId, model = "claude-sonnet-5-5", fetchImpl = fetch, system = SYSTEM, tools = TOOLS, toolChoice }) {
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
      // keys not scoped to a workspace must name one (Anthropic returns 400 otherwise)
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json",
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}) },
      body: JSON.stringify({
        model, max_tokens: 4096, system, tools, messages: toAnthropic(messages),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    const calls = body.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
    usage.calls++;
    usage.input_tokens += body.usage?.input_tokens || 0;
    usage.output_tokens += body.usage?.output_tokens || 0;
    return { raw: body.content, calls };
  };
  // token count of every call made through this adapter, to measure the real cost of one brief
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0 };
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
    if (last.role === "tool") for (const r of last.results) seen[r.name + ":" + r.id] = JSON.parse(r.content);
    const market = ((messages[0]?.content || "").match(/Market: ([^\n]*)/) || [])[1] || "";
    const ids = () => (Object.entries(seen).find(([k]) => k.startsWith("search:"))?.[1] || []).map((e) => e.entity_id).slice(0, 2);
    const plan = [
      () => [{ name: "search", input: { query: "Allbirds", types: "urn:entity:brand", take: 3 } }],
      () => [
        { name: "insights", input: { filter_type: "urn:entity:brand", entity_ids: ids(), location: market, take: 6 } },
        { name: "insights", input: { filter_type: "urn:entity:artist", entity_ids: ids(), location: market, take: 6 } },
        { name: "insights", input: { filter_type: "urn:entity:podcast", entity_ids: ids(), location: market, take: 4 } },
        { name: "demographics", input: { entity_ids: ids() } },
      ],
      () => [{ name: "submit_brief", input: briefFrom(seen) }],
    ];
    const calls = (plan[step] || plan[plan.length - 1])().map((c, i) => ({ ...c, id: `mock_${step}_${i}` }));
    step++;
    return { raw: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })), calls };
  };
}

function briefFrom(seen) {
  const all = Object.entries(seen);
  const pick = (re) => all.filter(([k, v]) => k.startsWith("insights") && Array.isArray(v) && v[0]?.type?.match(re)).flatMap(([, v]) => v);
  const brands = pick(/brand/), artists = pick(/artist/), pods = pick(/podcast/);
  const demo = all.find(([k]) => k.startsWith("demographics"))?.[1]?.[0] || {};
  const top = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0];
  const [age, ageV] = top(demo.age) || ["?", 0], [gen, genV] = top(demo.gender) || ["?", 0];
  return {
    audience_summary: `[MOCK DATA] Shoppers who also love ${brands.slice(0, 2).map((b) => b.name).join(" and ")} and listen to ${artists[0]?.name || "?"}.`,
    demographics: { age, gender: gen, evidence: [`age ${age} ${ageV}`, `gender ${gen} ${genV}`] },
    audience_traits: brands.slice(0, 3).map((b) => ({ trait: `Buys from ${b.name}`, evidence: [`${b.name} affinity ${b.affinity}`] })),
    meta_interests: [...brands.slice(0, 3), ...artists.slice(0, 2)].map((e) => ({ interest: `${e.name} (check in Ads Manager)`, evidence: [e.name] })),
    creative_angles: pods.slice(0, 2).map((p) => ({ angle: `Speak like ${p.name}`, hook: "Placeholder hook from mock run", evidence: [p.name] })),
    landing_page: { headline: "[MOCK] Headline written from taste signals", subheadline: "Replace by a real run", evidence: brands.slice(0, 1).map((b) => b.name) },
    partnerships: brands.slice(3, 5).map((b) => ({ partner: b.name, idea: "Co-branded drop (mock)", evidence: [b.name] })),
    caveats: ["Mock run: all Qloo data is synthetic. Not a real recommendation."],
  };
}

/** Mock of the no-data baseline: what a model writes from general knowledge alone. */
export function mockBaselineLLM() {
  const guess = "model guess, no data";
  return async () => {
    const input = {
      audience_summary: "[MOCK] Eco-minded urban professionals, 25-40, who care about sustainability.",
      demographics: { age: "25-40", gender: "all", evidence: [guess] },
      audience_traits: [{ trait: "Values sustainability", evidence: [guess] }, { trait: "Active lifestyle", evidence: [guess] }],
      meta_interests: ["Sustainability", "Running", "Eco-friendly products"].map((interest) => ({ interest, evidence: [guess] })),
      creative_angles: [{ angle: "Comfort meets sustainability", hook: "Feel good, do good", evidence: [guess] }],
      landing_page: { headline: "[MOCK] Comfort you can feel good about", subheadline: "Generic copy", evidence: [guess] },
      partnerships: [{ partner: "Local gyms", idea: "Generic cross-promo", evidence: [guess] }],
      caveats: ["Mock baseline: written without any data."],
    };
    return { raw: [{ type: "tool_use", id: "base_0", name: "submit_brief", input }], calls: [{ id: "base_0", name: "submit_brief", input }] };
  };
}
