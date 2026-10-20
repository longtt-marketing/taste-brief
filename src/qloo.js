// Qloo client. Hackathon keys only work against this base URL (see Qloo hackathon developer guide).
export const QLOO_BASE = "https://hackathon.api.qloo.com";

// Entity types the Insights API accepts for filter.type during the hackathon.
export const INSIGHT_TYPES = [
  "urn:entity:artist", "urn:entity:book", "urn:entity:brand", "urn:entity:destination", "urn:entity:movie",
  "urn:entity:person", "urn:entity:place", "urn:entity:podcast", "urn:entity:tv_show", "urn:entity:video_game",
];

/** Keep only what the model needs: Qloo responses carry long fields (akas, short_descriptions in many languages). */
export function slimEntity(e) {
  return {
    name: e.name,
    entity_id: e.entity_id,
    type: e.subtype || e.type,
    affinity: e.query?.affinity ?? e.affinity ?? null,
    popularity: e.popularity ?? null,
    tags: (e.tags || []).slice(0, 6).map((t) => t.name || t.tag_id || t.id),
    description: (e.properties?.description || "").slice(0, 160),
  };
}

export function makeQloo({ apiKey, fetchImpl = fetch, base = QLOO_BASE }) {
  async function get(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    // /v2/insights is GET with query params; key goes in X-Api-Key, not Bearer.
    const res = await fetchImpl(`${base}${path}?${qs}`, { headers: { "X-Api-Key": apiKey } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Qloo ${path} ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  }

  return {
    async search({ query, types, take = 5 }) {
      const r = await get("/search", { query, types, take });
      return (r.results || []).map(slimEntity);
    },
    async insights({ filter_type, entity_ids, tag_ids, location, take = 10 }) {
      if (!INSIGHT_TYPES.includes(filter_type)) throw new Error(`unsupported filter.type ${filter_type}`);
      const r = await get("/v2/insights", {
        "filter.type": filter_type,
        "signal.interests.entities": entity_ids,
        "signal.interests.tags": tag_ids,
        "signal.location.query": location,
        take,
      });
      return (r.results?.entities || []).map(slimEntity);
    },
    async demographics({ entity_ids, tag_ids }) {
      const r = await get("/v2/insights", {
        "filter.type": "urn:demographics",
        "signal.interests.entities": entity_ids,
        "signal.interests.tags": tag_ids,
      });
      return (r.results?.demographics || []).map((d) => ({ entity_id: d.entity_id, age: d.query?.age, gender: d.query?.gender }));
    },
    async tags({ query, take = 8 }) {
      const r = await get("/v2/tags", { "filter.query": query, "feature.typo_tolerance": true, take });
      return (r.results?.tags || []).map((t) => ({ tag_id: t.id || t.tag_id, name: t.name, type: t.type || t.subtype }));
    },
  };
}
