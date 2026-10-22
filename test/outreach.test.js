import { test } from "node:test";
import assert from "node:assert/strict";
import { draftOutreach, checkOutreach, outreachInput, mockOutreachLLM, lintDraft } from "../src/outreach.js";

const shows = [
  { name: "Absolutely Not", affinity: 0.954, advertisers: ["Quince", "Nutrafol"], rivals: [], about: "Comedian Heather McMahan | on life", tags: ["Comedy", "Society"] },
  { name: "Armchair Expert with Dax Shepard", affinity: 0.926, advertisers: ["Allstate"], rivals: [] },
];
const codes = ["ABSOLUTELY", "ARMCHAIR"];

test("outreach: the model sees each show's fit, ads, category brands and code, and nothing about rates", () => {
  const msg = outreachInput({ product: "Wool sneakers, $120", market: "New York", shows, codes, category: "footwear", alsoLike: ["Everlane"] });
  assert.match(msg, /1\. Absolutely Not \| about: Comedian Heather McMahan \/ on life \| tags: Comedy, Society \| taste fit 0\.95 \| advertisers in notes: Quince, Nutrafol \| footwear brands in notes: none found \| proposed code: ABSOLUTELY/);
  assert.match(msg, /2\. Armchair Expert with Dax Shepard \| about: no description \| taste fit 0\.93/, "a show without a description says so, so nothing is made up for it");
  assert.match(msg, /also likes \(Qloo\): Everlane/);
  assert.doesNotMatch(msg, /downloads|rate/i);
});

test("outreach: drafts are matched to the right show, never handed to another, never used twice", () => {
  const out = checkOutreach({ shows: [
    { show: "Armchair Expert", why_fit: "Fits — well", email_subject: "S", email_body: "Hello Armchair team", host_read: "code ARMCHAIR" },
    { show: "Some other show", why_fit: "x", email_subject: "x", email_body: "Hi Absolutely Not, code ABSOLUTELY", host_read: "x" },
  ] }, shows, codes);
  assert.deepEqual(out.map((o) => [o.show, o.code]), [["Absolutely Not", "ABSOLUTELY"], ["Armchair Expert with Dax Shepard", "ARMCHAIR"]]);
  assert.equal(out[1].why_fit, "Fits, well", "a shortened name still matches its own show");
  const none = checkOutreach({ shows: [{ show: "Unrelated", why_fit: "x", email_subject: "x", email_body: "Hello Unrelated team", host_read: "code XYZ" }] }, shows, codes);
  assert.equal(none.length, 0, "a draft that names neither show nor code is dropped, not given to the first show");
});

test("outreach: the lint flags missing asks, invented numbers and extra brackets", () => {
  const good = { show: "Absolutely Not", code: "ABSOLUTELY", why_fit: "Allbirds fans like this show (Qloo taste fit 0.95).",
    email_subject: "Sponsorship rates for Absolutely Not", email_body: "Hello Absolutely Not team,\nCould you share your rate per episode, average downloads, host-read slots, next open dates and whether footwear is exclusive? Code ABSOLUTELY.",
    host_read: "Wool running sneakers, sustainable, $120. [HOST: one line about trying them] Use code ABSOLUTELY. [OFFER] [LANDING PAGE]" };
  const g = lintDraft(good, { product: "Wool running sneakers, $120, sustainable", fit: 0.954 });
  assert.equal(g.asks_all, true); assert.equal(g.code, true); assert.deepEqual(g.invented_numbers, []); assert.equal(g.host_read_brackets, 3); assert.equal(g.opens_with_show, true);
  const bad = lintDraft({ ...good, email_body: "Hi there, what is your rate? We see 50,000 listeners. Code ABSOLUTELY." }, { product: "Wool running sneakers, $120", fit: 0.954 });
  assert.equal(bad.asks_all, false); assert.deepEqual(bad.invented_numbers, ["50,000"]); assert.equal(bad.opens_with_show, false);
  // the subject line alone does not ask for rates, and "availability" alone does not ask for dates
  const thin = lintDraft({ ...good, email_body: "Hello Absolutely Not team,\nCould you share average downloads, host-read slots, your availability and whether footwear is exclusive? Code ABSOLUTELY." }, { product: "Wool running sneakers, $120, sustainable", fit: 0.954 });
  assert.equal(thin.asks.rate, false); assert.equal(thin.asks.dates, false);
});

test("outreach: the synthetic drafts are labelled and carry the code", async () => {
  const o = await draftOutreach({ llm: mockOutreachLLM(), product: "p", market: "m", shows, codes, category: "footwear" });
  assert.equal(o.shows.length, 2);
  assert.match(o.shows[0].email_subject, /^\[SYNTHETIC\]/);
  assert.match(o.shows[1].host_read, /ARMCHAIR/);
  assert.equal(await draftOutreach({ llm: mockOutreachLLM(), product: "p", market: "m", shows: [], codes: [] }), null);
});

test("outreach: the lint flags a draft that names a brand of the product's own category", () => {
  const d = { show: "Absolutely Not", code: "ABSOLUTELY", why_fit: "x", email_subject: "Rates", email_body: "Hello Absolutely Not team, we see you already read for Quince and Lululemon. Could you share your rate, downloads, host-read slots, dates and exclusivity? Code ABSOLUTELY.", host_read: "[BRAND] sneakers. Code ABSOLUTELY." };
  assert.deepEqual(lintDraft(d, { product: "Wool sneakers", rivals: ["Lululemon"] }).names_rival, ["Lululemon"]);
  assert.deepEqual(lintDraft(d, { product: "Wool sneakers", rivals: [] }).names_rival, []);
});
