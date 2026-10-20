// Synthetic stand-in for the Qloo API: same function shapes as makeQloo(), made-up names and numbers.
// Never real Qloo data (Qloo's terms forbid publishing their responses in a public repo).
const fake = (prefix, type, names) => names.map((n, i) => ({
  name: `${prefix} ${n}`, entity_id: `MOCK-${type.split(":").pop().toUpperCase()}-${i + 1}`, type,
  affinity: Math.round((0.95 - i * 0.07) * 100) / 100, popularity: null, tags: [], description: "synthetic sample",
}));

const DATA = {
  "urn:entity:brand": fake("Sample", "urn:entity:brand", ["Trail Shoe Co.", "Merino Basics", "Oat Milk Cafe", "Slow Fashion Label", "Bike Commuter Gear", "Refill Shop"]),
  "urn:entity:artist": fake("Sample", "urn:entity:artist", ["Indie Folk Duo", "Lo-fi Producer", "Acoustic Singer", "Ambient Band", "Jazz Trio", "Synth Pop Act"]),
  "urn:entity:podcast": fake("Sample", "urn:entity:podcast", ["Climate Weekly", "Design Matters Show", "Founder Stories", "Morning Run Talk"]),
  "urn:entity:tv_show": fake("Sample", "urn:entity:tv_show", ["Nature Docuseries", "Kitchen Competition", "Startup Drama"]),
};

export function mockQloo() {
  return {
    async search({ query, types = "urn:entity:brand", take = 3 }) {
      // seed ids must not collide with the insights results, as with the real API
      return fake("Sample match for", types, [query, query + " (alt)", query + " (similar)"]).slice(0, take)
        .map((e, i) => ({ ...e, entity_id: `MOCK-SEED-${i + 1}` }));
    },
    async insights({ filter_type, take = 6, location = "" }) {
      // shift the synthetic list by a hash of the location so two markets give visibly different (still fake) answers
      const list = DATA[filter_type] || [];
      const shift = [...String(location)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 0) % Math.max(1, list.length);
      return [...list.slice(shift), ...list.slice(0, shift)].slice(0, take);
    },
    async demographics({ entity_ids = [] }) {
      return entity_ids.slice(0, 1).map((id) => ({
        entity_id: id,
        age: { "24_and_younger": 0.12, "25_to_29": 0.41, "30_to_34": 0.33, "35_to_44": -0.02, "45_to_54": -0.21, "55_and_older": -0.4 },
        gender: { female: 0.18, male: -0.18 },
      }));
    },
    async tags({ query }) {
      return [{ tag_id: `urn:tag:keyword:mock:${query.toLowerCase().replace(/\W+/g, "_")}`, name: query, type: "mock" }];
    },
  };
}
