import { sourcesFrom } from "./evidence.js";
// The agent: an LLM that plans Qloo calls, reads the taste signals, and must finish by calling submit_brief.
// Every claim in the brief carries the Qloo evidence it came from, so the output is checkable, not a guess.
import { INSIGHT_TYPES } from "./qloo.js";

export const SYSTEM = `You are Taste Brief, a strategist for performance marketers.
Given a product and a market, you use Qloo's taste graph to find out who the real audience is and what else they love,
then you write a campaign brief grounded ONLY in what Qloo returned.

Method:
1. search: find 1-3 Qloo entities that represent the product (comparable brands, or the product itself).
2. insights: from those entity ids, pull cross-domain affinities - at least brands, artists and one of tv_show / movie / podcast / place.
   Pass the market as location when it is a city or country.
3. demographics: get the age and gender skew of the seed entities.
4. submit_brief: write the brief. Each audience trait, interest, angle and partnership MUST cite the Qloo entity names or
   demographic numbers it comes from in "evidence". If Qloo returned nothing useful for a section, say so - never invent.
Keep copy concrete and short. Meta interests must be names that plausibly exist as Meta Ads interests; mark them "check in Ads Manager".`;

const str = { type: "string" };
const strArr = { type: "array", items: str };
const cited = (fields) => ({
  type: "array",
  items: { type: "object", properties: { ...fields, evidence: strArr }, required: [...Object.keys(fields), "evidence"] },
});

export const TOOLS = [
  {
    name: "search",
    description: "Find Qloo entities by name. Use to turn a product, brand, artist or show name into an entity_id.",
    input_schema: {
      type: "object",
      properties: { query: str, types: { type: "string", description: "e.g. urn:entity:brand" }, take: { type: "integer" } },
      required: ["query"],
    },
  },
  {
    name: "insights",
    description: "Cross-domain taste affinities: entities of filter_type that the audience of the given entity ids also loves.",
    input_schema: {
      type: "object",
      properties: {
        filter_type: { type: "string", enum: INSIGHT_TYPES },
        entity_ids: strArr,
        tag_ids: strArr,
        location: { type: "string", description: "city or country in natural language" },
        take: { type: "integer" },
      },
      required: ["filter_type"],
    },
  },
  {
    name: "demographics",
    description: "Age and gender affinity of the audience behind entity ids or tags (positive = over-indexes).",
    input_schema: { type: "object", properties: { entity_ids: strArr, tag_ids: strArr } },
  },
  {
    name: "tags",
    description: "Find Qloo tag ids (genres, keywords, cuisines) by text, to use as tag_ids signals.",
    input_schema: { type: "object", properties: { query: str, take: { type: "integer" } }, required: ["query"] },
  },
  {
    name: "submit_brief",
    description: "Finish. Submit the campaign brief. Every item must cite Qloo evidence.",
    input_schema: {
      type: "object",
      properties: {
        audience_summary: str,
        demographics: { type: "object", properties: { age: str, gender: str, evidence: strArr } },
        audience_traits: cited({ trait: str }),
        meta_interests: cited({ interest: str }),
        creative_angles: cited({ angle: str, hook: str }),
        landing_page: { type: "object", properties: { headline: str, subheadline: str, evidence: strArr } },
        partnerships: cited({ partner: str, idea: str }),
        caveats: strArr,
      },
      required: ["audience_summary", "audience_traits", "meta_interests", "creative_angles", "landing_page"],
    },
  },
];

/** Run the loop. llm(messages) -> {text, calls:[{id,name,input}]}. Returns {brief, trace, sources}.
 *  sources = names the Qloo tools returned (for the evidence gate, src/evidence.js). */
export async function runAgent({ llm, qloo, product, market, references = "", maxSteps = 10 }) {
  const messages = [{
    role: "user",
    content: `Product: ${product}\nMarket: ${market}\nReference brands or competitors (optional): ${references || "none"}`,
  }];
  const trace = [];
  const seen = [];
  let rejected = 0;
  for (let step = 0; step < maxSteps; step++) {
    const turn = await llm(messages);
    messages.push({ role: "assistant", content: turn.raw });
    if (!turn.calls.length) {
      // the model stopped without the finishing tool: ask once more, then give up
      messages.push({ role: "user", content: "Finish now by calling submit_brief with what you have." });
      continue;
    }
    const results = [];
    for (const call of turn.calls) {
      if (call.name === "submit_brief") {
        const brief = normalizeBrief(call.input);
        const problem = briefProblem(brief);
        // A real run (20/10, London) once sent tool-call markup inside a field and a one-item brief: send it back once
        // or twice instead of accepting it; after that, return what came so the evidence gate can flag it.
        if (problem && rejected < 2) {
          rejected++;
          trace.push({ tool: "submit_brief", error: `rejected: ${problem}` });
          results.push({ id: call.id, name: call.name, content: JSON.stringify({ error: `Brief rejected: ${problem}. Call submit_brief again with the full brief as plain JSON values.` }) });
          continue;
        }
        trace.push({ tool: "submit_brief" });
        return { brief, trace, sources: sourcesFrom(seen) };
      }
      let out;
      try {
        out = await qloo[call.name](call.input);
      } catch (e) {
        out = { error: String(e.message || e) };
      }
      if (!out?.error) seen.push(out);
      trace.push({ tool: call.name, input: call.input, n: Array.isArray(out) ? out.length : undefined, error: out?.error });
      results.push({ id: call.id, name: call.name, content: JSON.stringify(out).slice(0, 6000) });
    }
    messages.push({ role: "tool", results });
  }
  throw new Error(`agent did not submit a brief in ${maxSteps} steps`);
}

export const BASELINE_SYSTEM = `You are a marketing strategist with no data access. Write the same campaign brief from general knowledge only.
In every "evidence" field write exactly: "model guess, no data". Call submit_brief.`;

/** The comparison column: same brief, same schema, no Qloo. One model call, forced onto submit_brief. */
export async function runBaseline({ llm, product, market, references = "" }) {
  const turn = await llm([{ role: "user", content: `Product: ${product}
Market: ${market}
References: ${references || "none"}` }]);
  let call = turn.calls.find((c) => c.name === "submit_brief");
  if (!call) { // answered in prose: ask once more for the tool
    const again = await llm([{ role: "user", content: `Product: ${product}. Market: ${market}. Call submit_brief now.` }]);
    call = again.calls.find((c) => c.name === "submit_brief");
  }
  if (!call) throw new Error("baseline did not return a brief");
  return normalizeBrief(call.input);
}

const LIST_FIELDS = ["audience_traits", "meta_interests", "creative_angles", "partnerships", "caveats"];
const OBJ_FIELDS = ["demographics", "landing_page"];

/** Why a submitted brief cannot be used as is (null when it can): leaked tool-call markup, or a near-empty core. */
export function briefProblem(brief) {
  const text = JSON.stringify(brief);
  if (/<\/?(parameter|invoke|function_calls)\b/.test(text)) return "a field contains tool-call markup";
  if (brief.audience_traits.length < 2) return "fewer than 2 audience_traits";
  if (brief.meta_interests.length < 2) return "fewer than 2 meta_interests";
  return null;
}

/** Models sometimes send a list field as a JSON string, or one object instead of a list. Fix shape, never content. */
export function normalizeBrief(b) {
  const out = { ...(b || {}) };
  const parse = (v) => {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return v; }
  };
  for (const k of LIST_FIELDS) {
    let v = parse(out[k]);
    if (v == null) v = [];
    else if (!Array.isArray(v)) v = [v];
    out[k] = v;
  }
  for (const k of OBJ_FIELDS) {
    const v = parse(out[k]);
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  }
  return out;
}
