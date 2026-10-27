import { test } from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/agent.js";
import { mockLLM } from "../src/llm.js";
import { mockQloo } from "../src/mock-qloo.js";
import { makeSelfCheck, verdictOf, pickRival, feedback } from "../src/selfcheck.js";
import { resolvePick } from "../src/grade.js";
import { categoryFor, rivalsIn } from "../src/podcasts.js";

test("citation failures join self-check feedback even when all interests pass", async () => {
  for (const repair of [true, false]) {
    const inner = mockLLM(); let cleanBrief, feedbackSeen = false;
    const llm = async (messages) => {
      const note = messages.at(-1)?.results?.find((r) => String(r.content).includes("Citation repair is also required"));
      if (note) {
        feedbackSeen = true;
        assert.match(note.content, /FULL corrected brief/);
        assert.match(note.content, /audience_traits/);
        const input = structuredClone(cleanBrief);
        if (!repair) input.audience_traits[0].entity_ids = ["invented-id"];
        const call = { id: "repair", name: "submit_brief", input };
        return { calls: [call], raw: [{ type: "tool_use", ...call }] };
      }
      const turn = await inner(messages);
      const submit = turn.calls.find((x) => x.name === "submit_brief");
      if (submit) {
        cleanBrief = structuredClone(submit.input);
        submit.input.audience_traits[0].entity_ids = ["invented-id"];
      }
      return turn;
    };
    const result = await runAgent({ llm, qloo: mockQloo(), product: "Wool sneakers", market: "London",
      check: async () => ({ picks: [], weak: [], not_in_meta: [] }) });
    assert.equal(feedbackSeen, true);
    assert.equal(result.check.ratio === 1, repair);
    if (!repair) assert.equal(result.brief.audience_traits[0].grounded, false, "failed repair stays visibly unverified");
  }
});

test("self-check overlaps providers and keeps the same rival across revisions", async () => {
  let metaStarted = false, releaseRival, searches = 0;
  const qloo = {
    search: () => { searches++; return new Promise((resolve) => { releaseRival = resolve; }); },
    insights: async ({ result_ids }) => result_ids.map((entity_id) => ({ entity_id, affinity: 0.95 })),
  };
  const check = makeSelfCheck({ qloo, market: "London", meta: async (names) => {
    metaStarted = true; return new Map(names.map((name) => [name, { status: "not_found" }]));
  } });
  const context = { seeds: ["seed"], registry: [{ entity_id: "pick", name: "Pick", type: "urn:entity:brand" }] };
  const brief = { holdout_rival: "Rival", meta_interests: [{ interest: "Pick", entity_ids: ["pick"] }] };
  const pending = check(brief, context);
  await Promise.resolve();
  assert.equal(metaStarted, true, "Meta begins while the rival request is unresolved");
  releaseRival([{ entity_id: "rival", name: "Rival", type: "urn:entity:brand" }]);
  const first = await pending;
  const second = await check({ ...brief, holdout_rival: "Different" }, context);
  assert.equal(searches, 1);
  assert.deepEqual(second.rival, first.rival);
  assert.equal(first.picks[0].verdict, "strong");
  assert.deepEqual(first.not_in_meta, ["Pick"], "good Qloo fit never overrides a missing Meta interest");
});

test("revision patch keeps other sections but rechecks every replaced interest and test", async () => {
  const inner = mockLLM(); let original, checks = 0;
  const llm = async (messages) => {
    if (messages.at(-1)?.results?.some((r) => String(r.content).startsWith("Self-check"))) {
      const input = { meta_interests: original.meta_interests.map((x, i) => i ? x : { ...x, interest: "Invented unrelated interest" }),
        test_plan: original.test_plan, audience_traits: [], audience_summary: "MUST NOT REPLACE" };
      const call = { id: "patch", name: "revise_interests", input };
      return { calls: [call], raw: [{ type: "tool_use", ...call }] };
    }
    const turn = await inner(messages);
    const submitted = turn.calls.find((c) => c.name === "submit_brief");
    if (submitted) original = structuredClone(submitted.input);
    return turn;
  };
  const out = await runAgent({ llm, qloo: mockQloo(), product: "Wool sneakers", market: "London", check: async () => {
    checks++; return { picks: [], weak: checks === 1 ? ["replace"] : [] };
  } });
  assert.deepEqual(out.brief.audience_traits.map((t) => t.trait), original.audience_traits.map((t) => t.trait));
  assert.equal(out.brief.audience_summary, original.audience_summary);
  assert.equal(checks, 2);
  assert.equal(out.incomplete, null);
  assert.equal(out.brief.meta_interests[0].grounded, false, "partial revision cannot bypass evidence checking");
  assert.equal(out.trace.some((t) => /fewer than 2 audience_traits/.test(t.error || "")), false);
});

test("self-check: weak picks go back to the agent once, and the revised brief drops them", async () => {
  const qloo = mockQloo();
  const out = await runAgent({ llm: mockLLM(), qloo, product: "wool sneakers", market: "London", references: "Allbirds", check: makeSelfCheck({ qloo, market: "London" }) });
  const tools = out.trace.map((s) => s.tool);
  assert.equal(tools.filter((t) => t === "self_check").length, 2, "checked the first brief and the revised one");
  assert.ok(out.trace.some((s) => s.tool === "submit_brief" && s.revised), "the second submission is marked revised");
  assert.equal(out.self_check.revised, true);
  const weakFirst = out.self_check.first.weak;
  assert.ok(weakFirst.length > 0, "the synthetic data has picks below the bar");
  for (const w of weakFirst) assert.ok(!out.brief.meta_interests.some((i) => i.interest === w), `${w} was dropped`);
  assert.ok(out.self_check.final.rival?.name, "the picks were scored on a named rival");
  assert.ok(!out.seeds.includes(out.self_check.final.rival.entity_id), "the rival is never a seed");
});

test("self-check: if the agent never sends its rewrite, the first brief is kept, not lost", async () => {
  const qloo = mockQloo();
  const inner = mockLLM();
  let sawFeedback = false;
  const llm = async (messages) => {
    const last = messages.at(-1);
    if (sawFeedback || (last.role === "tool" && last.results.some((r) => String(r.content).startsWith("Self-check")))) { sawFeedback = true; return { raw: [{ type: "text", text: "done" }], calls: [] }; }
    return inner(messages);
  };
  const out = await runAgent({ llm, qloo, product: "wool sneakers", market: "London", references: "Allbirds", check: makeSelfCheck({ qloo, market: "London" }) });
  assert.ok(sawFeedback, "the self-check sent its report");
  assert.equal(out.self_check.rewrite_failed, true);
  assert.ok(out.brief.meta_interests.length >= 2, "the first brief came back");
});

test("self-check: verdict bands and the agent's report", () => {
  assert.equal(verdictOf({ status: "scored", affinity: 0.93 }), "strong");
  assert.equal(verdictOf({ status: "scored", affinity: 0.85 }), "fair");
  assert.equal(verdictOf({ status: "scored", affinity: 0.7 }), "weak");
  assert.equal(verdictOf({ status: "no_score" }), "weak");
  assert.equal(verdictOf({ status: "no_match" }), "not_in_qloo");
  const text = feedback({ rival: { name: "Veja" }, picks: [{ name: "A", verdict: "weak", affinity: 0.7 }], weak: ["A"] });
  assert.match(text, /^Self-check/);
  assert.match(text, /Weak or not in Qloo: A\. Replace/);
});

test("self-check: a rival the brief already cites is not used; the closest uncited brand is", async () => {
  const qloo = { search: async () => [{ name: "Veja", entity_id: "V", type: "urn:entity:brand" }] };
  const brief = { holdout_rival: "Veja", meta_interests: [{ interest: "Veja", entity_ids: ["V"] }] };
  const reg = [{ name: "Veja", entity_id: "V", type: "urn:entity:brand", affinity: 0.99 }, { name: "Everlane", entity_id: "E", type: "urn:entity:brand", affinity: 0.95 }];
  assert.deepEqual(await pickRival(qloo, brief, reg, []), { name: "Everlane", entity_id: "E", source: "closest uncited brand", named: ["Veja"] });
});

test("self-check: the agent's rival names are tried in order until Qloo knows one", async () => {
  const known = { "rega": { name: "Rega Research", entity_id: "R", type: "urn:entity:brand" } };
  const qloo = { search: async ({ query }) => (known[query.toLowerCase()] ? [known[query.toLowerCase()]] : []) };
  const r = await pickRival(qloo, { holdout_rival: "Victrola, Rega" }, [], []);
  assert.equal(r.name, "Rega Research", "a hit that starts with the name counts");
  assert.equal(r.source, "named by the agent");
  const q2 = { search: async ({ query }) => (query === "Rega" ? [{ name: "Regal Cinemas", entity_id: "C", type: "urn:entity:brand" }] : []) };
  assert.equal(await pickRival(q2, { holdout_rival: "Rega" }, [], []), null, "Rega is not Regal Cinemas");
});

test("grader: a brand comes before a town of the same name", async () => {
  const qloo = { search: async () => [{ name: "Bombas", entity_id: "TOWN", type: "urn:entity:locality" }, { name: "Bombas", entity_id: "SOCKS", type: "urn:entity:brand" }] };
  assert.equal((await resolvePick(qloo, "Bombas")).entity_id, "SOCKS");
});

test("open shows: category from a known reference brand, rivals in a show's notes", () => {
  assert.equal(categoryFor("Allbirds", "apparel"), "footwear", "a known reference brand wins over the agent's pick");
  assert.equal(categoryFor("Some New Brand", "drinks"), "drinks");
  assert.equal(categoryFor("", "not a category"), null);
  assert.deepEqual(rivalsIn(["Hoka", "Squarespace", "Rothy's"], "footwear"), ["Hoka", "Rothy's"]);
  assert.deepEqual(rivalsIn(["Squarespace"], "footwear"), [], "open to the category");
  assert.equal(rivalsIn(null, "footwear"), null, "a show we have no notes for is unknown, not open");
  assert.deepEqual(rivalsIn(["Lululemon", "Quince"], "footwear"), ["Lululemon"], "a brand that also sells shoes counts for footwear");
  assert.deepEqual(rivalsIn(["Lululemon"], "apparel"), ["Lululemon"], "and still for its main category");
});

test("self-check: an interest Meta does not have sends the brief back, even when Qloo scores it well", async () => {
  const { needsRewrite } = await import("../src/selfcheck.js");
  const qloo = mockQloo();
  const brief = { holdout_rival: "", meta_interests: [{ interest: "Patagonia" }, { interest: "Outdoor Voices" }] };
  const meta = async (names) => new Map(names.map((n) => [n, n === "Outdoor Voices" ? { name: n, status: "not_found", nearest: [] } : { name: n, status: "targetable" }]));
  const report = await makeSelfCheck({ qloo, market: "London", meta })(brief, { registry: [], seeds: [] });
  assert.deepEqual(report.not_in_meta, ["Outdoor Voices"]);
  assert.equal(needsRewrite(report), true);
  const text = feedback(report);
  assert.match(text, /Outdoor Voices[^\n]*NOT in Meta/);
  assert.match(text, /No targeting test may name an interest that is not in Meta/);
  // without a Meta lookup, and with nothing weak, the brief stands
  const plain = await makeSelfCheck({ qloo, market: "London" })({ holdout_rival: "", meta_interests: [] }, { registry: [], seeds: [] });
  assert.equal(needsRewrite(plain), false);
});
