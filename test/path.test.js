import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPath } from "../public/path.js";

test("agent path: the page's decision summary is read from the run's own Qloo calls", () => {
  const p = agentPath([
    { tool: "search", input: { query: "Allbirds" }, n: 1 },
    { tool: "tags", input: { query: "running" }, n: 5 },
    { tool: "insights", input: { filter_type: "urn:entity:brand", tag_ids: ["urn:tag:genre:brand:fashion:footwear:sneaker:running"], location: "London, UK" }, n: 10 },
    { tool: "insights", input: { filter_type: "urn:entity:tv_show", location: "London, UK" }, n: 8 },
    { tool: "insights", input: { filter_type: "urn:entity:place", location: "London, UK", filter_location: "London" }, n: 8 },
    { tool: "demographics", input: {} },
    { tool: "submit_brief" },
  ]);
  assert.deepEqual(p.searched, ["Allbirds"]);
  assert.deepEqual(p.tags, ["running"]);
  assert.deepEqual(p.reads.map((r) => r.what), ["brands", "TV shows", "places"]);
  assert.deepEqual(p.reads[0].narrowed, ["running"]);
  assert.equal(p.reads[2].inCity, true);
  assert.equal(p.demographics, true);
  assert.equal(p.qlooCalls, 6);
  assert.equal(agentPath(undefined).qlooCalls, 0);
});

test("path: a note that points to a [marker] the brief never uses is left out", async () => {
  const { checkedCaveats } = await import("../public/path.js");
  const brief = { landing_page: "Hero: [BRAND] wool runners", caveats: ["Claims are marked [confirm].", "The page uses [BRAND] for the name.", "Qloo knew Allbirds."] };
  const r = checkedCaveats(brief);
  assert.deepEqual(r.dropped, ["Claims are marked [confirm]."]);
  assert.deepEqual(r.kept, ["The page uses [BRAND] for the name.", "Qloo knew Allbirds."]);
});
