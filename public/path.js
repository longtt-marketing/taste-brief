// What the agent chose to do in a run, read from its own trace of Qloo calls, so the page can show the decisions first.
// Pure function, used by the page and by test/path.test.js.

const TYPE = { brand: "brands", artist: "artists", podcast: "podcasts", tv_show: "TV shows", movie: "films", book: "books",
  place: "places", destination: "destinations", videogame: "video games", person: "people" };
const typeName = (urn) => TYPE[String(urn || "").split(":").pop()] || String(urn || "").split(":").pop() || "results";

/** {searched, tags, reads:[{what, where, narrowed}], demographics, qlooCalls} from a run's trace. */
export function agentPath(trace) {
  const t = Array.isArray(trace) ? trace : [];
  const out = { searched: [], tags: [], reads: [], demographics: false, qlooCalls: 0, podcasts: false, drafted: [] };
  for (const s of t) {
    if (s.tool === "draft_outreach" && !s.error) { out.drafted = (s.input?.shows || []).map(String); continue; }
    if (!["search", "tags", "insights", "demographics", "podcasts"].includes(s.tool)) continue; // the brief and the self-check are not Qloo calls the agent chose
    if (s.tool === "podcasts") { if (!s.error) out.podcasts = true; out.qlooCalls++; continue; }
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

/** The agent's notes, without any that point to a [marker] the brief never uses: an AI review we ran found a recorded note saying
 *  claims "are marked [confirm]" when no [confirm] appears anywhere (22 Oct). Returns {kept, dropped}. */
export function checkedCaveats(brief) {
  const caveats = Array.isArray(brief?.caveats) ? brief.caveats.map(String) : [];
  const rest = JSON.stringify({ ...(brief || {}), caveats: undefined }).toLowerCase();
  const kept = [], dropped = [];
  for (const c of caveats) {
    const marks = (c.match(/\[[^\]]{1,40}\]/g) || []).map((m) => m.toLowerCase());
    (marks.some((m) => !rest.includes(m)) ? dropped : kept).push(c);
  }
  return { kept, dropped };
}
