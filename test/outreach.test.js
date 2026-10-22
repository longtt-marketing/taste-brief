import { test } from "node:test";
import assert from "node:assert/strict";
import { draftOutreach, checkOutreach, outreachInput, mockOutreachLLM } from "../src/outreach.js";

const shows = [
  { name: "Absolutely Not", affinity: 0.954, advertisers: ["Quince", "Nutrafol"], rivals: [] },
  { name: "Armchair Expert with Dax Shepard", affinity: 0.926, advertisers: ["Allstate"], rivals: [] },
];
const codes = ["ABSOLUTELY", "ARMCHAIR"];

test("outreach: the model sees each show's fit, ads, category brands and code, and nothing about rates", () => {
  const msg = outreachInput({ product: "Wool sneakers, $120", market: "New York", shows, codes, category: "footwear", alsoLike: ["Everlane"] });
  assert.match(msg, /1\. Absolutely Not \| taste fit 0\.95 \| advertisers in notes: Quince, Nutrafol \| footwear brands in notes: none found \| proposed code: ABSOLUTELY/);
  assert.match(msg, /also likes \(Qloo\): Everlane/);
  assert.doesNotMatch(msg, /downloads|rate/i);
});

test("outreach: drafts are matched to the shows asked about, trimmed and cleaned of dashes", () => {
  const out = checkOutreach({ shows: [
    { show: "armchair expert with dax shepard", why_fit: "Fits — well", email_subject: "S", email_body: "B", host_read: "H" },
    { show: "Some other show", why_fit: "x", email_subject: "x", email_body: "x", host_read: "x" },
  ] }, shows, codes);
  assert.equal(out[0].show, "Absolutely Not", "falls back to the order given");
  assert.equal(out[1].show, "Armchair Expert with Dax Shepard");
  assert.equal(out[1].why_fit, "Fits, well");
  assert.equal(out[1].code, "ARMCHAIR");
});

test("outreach: the synthetic drafts are labelled and carry the code", async () => {
  const o = await draftOutreach({ llm: mockOutreachLLM(), product: "p", market: "m", shows, codes, category: "footwear" });
  assert.equal(o.shows.length, 2);
  assert.match(o.shows[0].email_subject, /^\[SYNTHETIC\]/);
  assert.match(o.shows[1].host_read, /ARMCHAIR/);
  assert.equal(await draftOutreach({ llm: mockOutreachLLM(), product: "p", market: "m", shows: [], codes: [] }), null);
});
