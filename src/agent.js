import { sourcesFrom, registryFrom, annotateBrief, checkEvidence } from "./evidence.js";
// The agent: an LLM that plans Qloo calls, reads the taste signals, and must finish by calling submit_brief.
// Every claim in the brief carries the Qloo evidence it came from, so the output is checkable, not a guess.
import { INSIGHT_TYPES } from "./qloo.js";

export const SYSTEM = `You are Taste Brief, a strategist for performance marketers.
Given a product and a market, you use Qloo's taste graph to find whose tastes overlap with the product and what else
that audience loves, then you write a campaign brief grounded ONLY in what Qloo returned.

Method:
1. search: find 1-3 Qloo entities that stand for the product: the product or brand itself if Qloo knows it, else the
   closest comparable brands (use the reference brands when given). If a search match is clearly the wrong thing (a
   magazine for a shoe brand), do not use it, and say so in caveats.
2. tags: look up 1 or 2 Qloo tags for the product category itself (e.g. "running" for running shoes, "coffee" for a
   coffee subscription); prefer brand or keyword tags. Then make at least one insights call that passes those tag_ids
   together with the seed entity_ids, so the brief reflects the product and not only the comparable brand.
3. insights: from the seed entity ids, pull cross-domain affinities in the market: at least brands, artists and one of
   tv_show / movie / podcast. Pass the market as location. For places, also pass filter_location = the city, so the
   places are really in that city.
4. demographics: get the age and gender skew of the seed entities (Qloo's demographics are not location-specific).
5. submit_brief. Rules for every item:
   - entity_ids: the Qloo entity_id(s) of the results the item rests on, copied exactly from the tool output. Cite the
     non-seed results that support the item. A seed may be cited only for an item about the seed itself.
   - evidence: short notes in the form "Name (affinity 0.956)", using the exact numbers Qloo returned.
   - One Meta interest or partner per item, never "A / B", and name it as the Qloo result you cite.
   - Affinity describes aggregate taste overlap, not purchases and not any individual: write "over-indexes on",
     "shares taste with", never "buys" or "will".
   - Creative angles and the landing page are your interpretation: cite the results they are built on.
   - test_plan (required): 1 to 3 ad tests a marketer can run this week. hypothesis = what the Qloo results suggest about this
     audience; ad_set = the creative angle to test and the interests to try it on (the angle is the variable, so it can also
     run on a broad audience); kpi = cost per add to cart or cost per purchase, with CTR only as a diagnostic; stop_if = a
     rule against the control that a small four week test can reach (e.g. "cost per add to cart 30% above the control after
     150 clicks"). The control is always the obvious ad set: broad targeting in the market, same ages, the brand's usual
     message. Qloo adds angles to test against it; it does not replace it. Prefer interests big enough to reach in that
     market. Cite the results each test rests on.
   - Any item that quotes the age or gender index must also cite the seed entity id those numbers belong to.
   If Qloo returned nothing useful for a section, leave it short and say so in caveats; never invent.
Keep copy concrete and short, in plain natural English a marketer would write. Never use dashes (— or –) as
punctuation: use commas or full stops. No buzzwords. Meta interests must be names that plausibly exist as Meta Ads interests.`;

const str = { type: "string" };
const strArr = { type: "array", items: str };
const cited = (fields) => ({
  type: "array",
  items: {
    type: "object",
    properties: { ...fields, entity_ids: { ...strArr, description: "Qloo entity_id values from the tool results this item rests on" }, evidence: strArr },
    required: [...Object.keys(fields), "entity_ids", "evidence"],
  },
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
        location: { type: "string", description: "city or country in natural language: nudges the ranking toward it" },
        filter_location: { type: "string", description: "for places only: keep places located in this city" },
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
        audience_traits: cited({ trait: str }),
        meta_interests: cited({ interest: str }),
        creative_angles: cited({ angle: str, hook: str }),
        landing_page: { type: "object", properties: { headline: str, subheadline: str, entity_ids: strArr, evidence: strArr } },
        partnerships: cited({ partner: str, idea: str }),
        test_plan: cited({ hypothesis: str, ad_set: str, kpi: str, stop_if: str }),
        caveats: strArr,
      },
      required: ["audience_summary", "audience_traits", "meta_interests", "creative_angles", "landing_page", "test_plan"],
    },
  },
];

/** Run the loop. llm(messages) -> {raw, calls:[{id,name,input}]}.
 *  Returns {brief, trace, sources, registry, seeds, check, demographics}:
 *  brief items carry {verified, problems, grounded} from the evidence gate (src/evidence.js);
 *  demographics is Qloo's own age/gender output for the seeds, not the model's summary of it. */
/** onStep (optional) is called with each trace entry as it happens, so a page can show the agent working live. */
export async function runAgent({ llm, qloo, product, market, references = "", maxSteps = 10, onStep = () => {} }) {
  const messages = [{
    role: "user",
    content: `Product: ${product}\nMarket: ${market}\nReference brands or competitors (optional): ${references || "none"}`,
  }];
  const trace = [];
  const seen = [];
  const calls = []; // {tool, input, output} of every successful Qloo call: the evidence registry is built from these
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
          onStep(trace.at(-1));
          results.push({ id: call.id, name: call.name, content: JSON.stringify({ error: `Brief rejected: ${problem}. Call submit_brief again with the full brief as plain JSON values.` }) });
          continue;
        }
        trace.push({ tool: "submit_brief" });
        onStep(trace.at(-1));
        const reg = registryFrom(calls);
        const demo = calls.find((c) => c.tool === "demographics" && c.output?.length);
        return {
          brief: annotateBrief(brief, reg), trace, sources: sourcesFrom(seen),
          registry: [...reg.entities.values()], seeds: [...reg.seeds], check: summary(checkEvidence(brief, reg)),
          // tags have no entity_id, so they are not in the registry; kept so "did Qloo return this?" can see them
          tags: calls.filter((c) => c.tool === "tags").flatMap((c) => c.output || []).filter((t) => t?.name).map((t) => ({ tag_id: t.tag_id, name: t.name })),
          demographics: demo ? {
            seeds: ids(demo.input?.entity_ids).map((id) => reg.entities.get(id)?.name || id),
            age: demo.output[0]?.age || null, gender: demo.output[0]?.gender || null,
          } : null,
        };
      }
      let out;
      try {
        out = await qloo[call.name](call.input);
      } catch (e) {
        out = { error: String(e.message || e) };
      }
      if (!out?.error) { seen.push(out); calls.push({ tool: call.name, input: call.input, output: out }); }
      trace.push({ tool: call.name, input: call.input, n: Array.isArray(out) ? out.length : undefined, error: out?.error });
      onStep(trace.at(-1));
      results.push({ id: call.id, name: call.name, content: JSON.stringify(out).slice(0, 6000) });
    }
    messages.push({ role: "tool", results });
  }
  throw new Error(`agent did not submit a brief in ${maxSteps} steps`);
}

export const BASELINE_SYSTEM = `You are a marketing strategist with no data access. Write the same campaign brief from general knowledge only.
In every "evidence" field write exactly: "model guess, no data", and leave every entity_ids list empty. Plain English, no dashes as
punctuation. Call submit_brief.`;

/** The comparison column: same brief, same schema, no Qloo. One model call, forced onto submit_brief. */
export async function runBaseline({ llm, product, market, references = "" }) {
  const ask = `Product: ${product}
Market: ${market}
References: ${references || "none"}`;
  // A live run (20/10) sent the baseline with tool markup inside the lists, which left the comparison empty:
  // ask again (at most twice) when there is no brief, or a broken one, as the agent does.
  let note = "", problem = "no brief";
  for (let attempt = 0; attempt < 3; attempt++) {
    const turn = await llm([{ role: "user", content: ask + note }]);
    const call = turn.calls.find((c) => c.name === "submit_brief");
    if (call) {
      const brief = normalizeBrief(call.input);
      problem = baselineProblem(brief);
      if (!problem) return brief;
    }
    note = `
Call submit_brief now, with every list field as a JSON list of objects (plain values, no markup).${problem !== "no brief" ? ` The last one was rejected: ${problem}.` : ""}`;
  }
  throw new Error(`baseline did not return a usable brief (${problem})`);
}

/** The baseline cites nothing by design, so only shape is checked: no leaked markup, at least two interests. */
export function baselineProblem(brief) {
  if (/<\/?(parameter|invoke|function_calls)\b/.test(JSON.stringify(brief))) return "a field contains tool-call markup";
  if (brief.meta_interests.filter((i) => i && typeof i === "object" && i.interest).length < 2) return "fewer than 2 meta_interests";
  return null;
}

const LIST_FIELDS = ["audience_traits", "meta_interests", "creative_angles", "partnerships", "test_plan", "caveats"];
const OBJ_FIELDS = ["demographics", "landing_page"];
const ids = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String);
const summary = (c) => ({ grounded: c.grounded, total: c.total, ratio: c.ratio,
  flagged: c.rows.filter((r) => !r.grounded).map((r) => ({ field: r.field, label: r.label, problems: r.problems })) });

/** Why a submitted brief cannot be used as is (null when it can): leaked tool-call markup, or a near-empty core. */
export function briefProblem(brief) {
  const text = JSON.stringify(brief);
  if (/<\/?(parameter|invoke|function_calls)\b/.test(text)) return "a field contains tool-call markup";
  if (brief.audience_traits.length < 2) return "fewer than 2 audience_traits";
  if (brief.meta_interests.length < 2) return "fewer than 2 meta_interests";
  if (brief.test_plan.length < 1) return "no test_plan: add 1 to 3 ad tests";
  const items = ["audience_traits", "meta_interests", "creative_angles", "partnerships", "test_plan"].flatMap((k) => brief[k]);
  const uncited = items.filter((i) => !ids(i?.entity_ids).length).length;
  if (items.length && uncited > items.length / 2) return `${uncited} of ${items.length} items cite no Qloo entity_ids`;
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
  // evidence / entity_ids inside items: a lone string becomes a one-item list (a real reply once broke the page this way)
  const fix = (it) => {
    if (!it || typeof it !== "object") return it;
    const o = { ...it };
    for (const f of ["evidence", "entity_ids"]) { const v = parse(o[f]); o[f] = v == null ? [] : Array.isArray(v) ? v : [v]; }
    return o;
  };
  for (const k of LIST_FIELDS) if (k !== "caveats") out[k] = out[k].map(fix);
  for (const k of OBJ_FIELDS) if (out[k]) out[k] = fix(out[k]);
  out.caveats = out.caveats.map((c) => (typeof c === "string" ? c : JSON.stringify(c)));
  return out;
}
