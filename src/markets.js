// Two markets, same seed: what Qloo itself ranks differently. No model in this step: the same insights call is made
// for each market and the two result lists are compared, so every row on the page is a Qloo number, not a choice the
// model made (the review of 20 Oct 2026 found that the first version only diffed the two model-written briefs).

export const COMPARE_TYPES = ["urn:entity:place", "urn:entity:brand", "urn:entity:artist", "urn:entity:tv_show"];
// For places the city is a filter (only places located there); for the rest it only nudges Qloo's ranking, so the
// comparison looks at the top of each list, where the city signal matters, not at the long tail.
const FILTERED = new Set(["urn:entity:place"]);

/** Compare two result lists of the same type: shared (with both affinities), only in A, only in B, in Qloo's order. */
export function diffLists(listA, listB, keep = 6) {
  const byA = new Map(listA.map((e, i) => [e.entity_id, { ...e, rank: i + 1 }]));
  const byB = new Map(listB.map((e, i) => [e.entity_id, { ...e, rank: i + 1 }]));
  const shared = [...byA.values()].filter((e) => byB.has(e.entity_id)).map((e) => ({
    entity_id: e.entity_id, name: e.name, affinity_a: e.affinity, affinity_b: byB.get(e.entity_id).affinity,
    rank_a: e.rank, rank_b: byB.get(e.entity_id).rank,
  }));
  const only = (by, other) => [...by.values()].filter((e) => !other.has(e.entity_id)).slice(0, keep)
    .map((e) => ({ entity_id: e.entity_id, name: e.name, affinity: e.affinity, rank: e.rank }));
  return { shared: shared.slice(0, keep), only_a: only(byA, byB), only_b: only(byB, byA), overlap: shared.length, size_a: listA.length, size_b: listB.length };
}

/** Run the comparison. onStep(entry) reports each pair of calls, like the agent's steps. */
export async function compareMarkets({ qloo, seedIds, marketA, marketB, types = COMPARE_TYPES, take = 12, onStep = () => {} }) {
  if (!seedIds?.length) return { error: "no seed entity to compare" };
  const rows = [];
  for (const type of types) {
    const [a, b] = await Promise.all([marketA, marketB].map((location) =>
      qloo.insights({ filter_type: type, entity_ids: seedIds, location, filter_location: FILTERED.has(type) ? location : undefined, take })
        .catch((e) => ({ error: String(e.message || e) }))));
    if (a.error || b.error) {
      onStep({ tool: "compare", input: { filter_type: type, markets: [marketA, marketB] }, error: a.error || b.error });
      rows.push({ type, error: a.error || b.error });
      continue;
    }
    const d = diffLists(a, b);
    onStep({ tool: "compare", input: { filter_type: type, markets: [marketA, marketB] }, n: d.overlap, of: Math.max(d.size_a, d.size_b) });
    rows.push({ type, filtered: FILTERED.has(type), ...d });
  }
  return { market_a: marketA, market_b: marketB, seeds: seedIds, take, types: rows };
}
