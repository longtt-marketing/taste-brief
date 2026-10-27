// Qloo client. Hackathon keys only work against this base URL (see Qloo hackathon developer guide).
export const QLOO_BASE = "https://hackathon.api.qloo.com";
import { assertIdentities, invalidEntityId, identityError } from "./provider-integrity.js";

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
    type: e.subtype || e.type || e.types?.[0], // search results carry types[], insights results carry type
    affinity: e.query?.affinity ?? e.affinity ?? null,
    popularity: e.popularity ?? null,
    tags: (e.tags || []).slice(0, 6).map((t) => t.name || t.tag_id || t.id),
    description: (e.properties?.description || "").slice(0, 160),
    // Qloo's own image for the entity (podcast cover art), shown on the page; only its own CDN is kept
    ...(/^https:\/\/images\.qloo\.com\//.test(e.properties?.image?.url || "") ? { image: e.properties.image.url } : {}),
    // feature.explainability: Qloo's own account of which input drove this result, and how much (0 to 1)
    ...(e.query?.explainability ? { explain: (e.query.explainability["signal.interests.entities"] || []).map((x) => ({ entity_id: x.entity_id, score: x.score })) } : {}),
  };
}

/**
 * The hackathon key is rate limited: two markets in parallel (about 16 calls in a few seconds) got HTTP 429 on a live run
 * (20 Oct). So one client keeps at most `concurrency` requests in flight and retries a 429 with a growing wait.
 */
export function makeQloo({ apiKey, fetchImpl = fetch, base = QLOO_BASE, concurrency = 2, retries = 4, backoffMs = 700, timeoutMs = 20000,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let active = 0;
  const waiting = [];
  async function slot(fn) {
    while (active >= concurrency) await new Promise((r) => waiting.push(r));
    active++;
    try { return await fn(); } finally { active--; waiting.shift()?.(); }
  }

  async function get(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
      qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
    }
    // /v2/insights is GET with query params; key goes in X-Api-Key, not Bearer.
    for (let attempt = 0; ; attempt++) {
      // a hung call must not hold the page forever: give up after timeoutMs (the agent turns the error into data)
      const res = await slot(() => fetchImpl(`${base}${path}?${qs}`, { headers: { "X-Api-Key": apiKey }, signal: AbortSignal.timeout(timeoutMs) }));
      if (res.status === 429 && attempt < retries) {
        await sleep(backoffMs * 2 ** attempt + Math.floor(Math.random() * 250));
        continue;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Qloo ${path} ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      return body;
    }
  }

  return {
    async search({ query, types, take = 5 }) {
      const r = await get("/search", { query, types, take });
      return assertIdentities(r.results || []).map(slimEntity);
    },
    // location nudges the ranking toward a city (signal); filter_location keeps only entities located there (places)
    // result_ids restricts the results to given entities: used to score a named pick against the same audience
    async insights({ filter_type, entity_ids, tag_ids, location, filter_location, result_ids, explain, take = 10 }) {
      if (!INSIGHT_TYPES.includes(filter_type)) throw new Error(`unsupported filter.type ${filter_type}`);
      if ([...(entity_ids || []), ...(result_ids || [])].some(invalidEntityId)) throw identityError();
      const r = await get("/v2/insights", {
        "filter.type": filter_type,
        "signal.interests.entities": entity_ids,
        "signal.interests.tags": tag_ids,
        "signal.location.query": location,
        "filter.location.query": filter_location,
        "filter.results.entities": result_ids,
        "feature.explainability": explain ? "true" : undefined,
        take,
      });
      return assertIdentities(r.results?.entities || []).map(slimEntity);
    },
    async demographics({ entity_ids, tag_ids }) {
      if ((entity_ids || []).some(invalidEntityId)) throw identityError();
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
