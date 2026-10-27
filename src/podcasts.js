// Podcast partners: shows the brand's audience over-indexes on, ranked by Qloo, with Qloo's own explanation of which
// input drove each pick. Next to each show, the advertisers its own episode notes already name (public RSS, read for the
// podcast check in docs/podcast-check). The page orders the shows by Qloo's rank plus this ad-demand rank (public/rank.js).
import SPONSORS from "./data/podcast-sponsors.json" with { type: "json" };
import CATS from "./data/categories.json" with { type: "json" };
import ALSO from "./data/category-also.json" with { type: "json" };
import { contactFor } from "../public/contacts.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const INDEX = new Map(Object.entries(SPONSORS.shows || {}).map(([name, brands]) => [norm(name), { name, brands }]));

/** Advertisers a show's own episode notes name (at least 2 episodes each), or null when the show is not in the data. */
export function advertisersFor(showName) {
  return INDEX.get(norm(showName))?.brands ?? null;
}

const CAT_OF = new Map(Object.entries(CATS.categories).flatMap(([c, brands]) => brands.map((b) => [norm(b), c])));

/** The product's category: from a reference brand we know (Allbirds -> footwear), else the agent's own pick. */
export function categoryFor(references, agentCategory) {
  for (const r of String(references || "").split(/[,;/]| and /)) { const c = CAT_OF.get(norm(r)); if (c) return c; }
  return CATS.categories[agentCategory] ? agentCategory : null;
}

const ALSO_IN = new Map(Object.entries(ALSO.also || {}).map(([c, brands]) => [c, new Set(brands.map(norm))]));

/** Brands of that category a show's notes already read: [] means the show is open to the category. A brand counts for its
 *  main category and for any second one it also sells in (data/category-also.json). */
export function rivalsIn(advertisers, category) {
  if (!category || !Array.isArray(advertisers)) return null;
  return advertisers.filter((a) => CAT_OF.get(norm(a)) === category || !!ALSO_IN.get(category)?.has(norm(a)));
}

/**
 * @param qloo   client from makeQloo
 * @param seeds  [{ entity_id, name }] the brand (and comps) the brief was built on
 * @param take   how many shows to return
 */
export async function podcastPartners({ qloo, seeds, take = 10, category = null }) {
  const ids = (seeds || []).map((s) => s.entity_id).filter(Boolean);
  if (!ids.length) return { error: "no seed brand to read" };
  const names = new Map((seeds || []).map((s) => [s.entity_id, s.name]));
  const shows = await qloo.insights({ filter_type: "urn:entity:podcast", entity_ids: ids, explain: true, take });
  return {
    shows: shows.map((s) => ({
      name: s.name, entity_id: s.entity_id, affinity: s.affinity, popularity: s.popularity, image: s.image || null,
      about: s.description || "", tags: Array.isArray(s.tags) ? s.tags.slice(0, 4) : [],
      driven_by: (s.explain || []).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => ({ name: names.get(x.entity_id) || x.entity_id, score: x.score })),
      advertisers: advertisersFor(s.name),
      rivals: rivalsIn(advertisersFor(s.name), category),
      contact: contactFor(s.name),
    })),
    category,
    data: { shows_with_sponsor_data: INDEX.size, source: SPONSORS.source, collected: SPONSORS.collected },
  };
}
