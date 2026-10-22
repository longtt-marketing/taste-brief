// What the agent chose to do in a run, read from its own trace of Qloo calls, so the page can show the decisions first.
// Pure function, used by the page and by test/path.test.js.

const TYPE = { brand: "brands", artist: "artists", podcast: "podcasts", tv_show: "TV shows", movie: "films", book: "books",
  place: "places", destination: "destinations", videogame: "video games", person: "people" };
const typeName = (urn) => TYPE[String(urn || "").split(":").pop()] || String(urn || "").split(":").pop() || "results";

/** {searched, tags, reads:[{what, where, narrowed}], demographics, qlooCalls} from a run's trace. */
export function agentPath(trace) {
  const t = Array.isArray(trace) ? trace : [];
  const out = { searched: [], tags: [], reads: [], demographics: false, qlooCalls: 0 };
  for (const s of t) {
    if (!["search", "tags", "insights", "demographics"].includes(s.tool)) continue; // the brief and the self-check are not Qloo calls the agent chose
    out.qlooCalls++;
    const i = s.input || {};
    if (s.tool === "search" && i.query) out.searched.push(String(i.query));
    else if (s.tool === "tags" && i.query) out.tags.push(String(i.query));
    else if (s.tool === "demographics") out.demographics = true;
    else if (s.tool === "insights") {
      out.reads.push({ what: typeName(i.filter_type), where: i.filter_location || i.location || "",
        narrowed: Array.isArray(i.tag_ids) && i.tag_ids.length ? i.tag_ids.map((x) => String(x).split(":").pop().replace(/_/g, " ")) : [],
        n: s.n ?? null, inCity: !!i.filter_location });
    }
  }
  return out;
}
