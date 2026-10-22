import { test } from "node:test";
import assert from "node:assert/strict";
import { sponsorReady } from "../public/rank.js";

test("sponsorReady adds the taste rank and the ad-demand rank", () => {
  const shows = [
    { name: "A", affinity: 0.95, advertisers: null },
    { name: "B", affinity: 0.93, advertisers: ["x", "y", "z"] },
    { name: "C", affinity: 0.91, advertisers: ["x"] },
    { name: "D", affinity: 0.90, advertisers: null },
  ];
  assert.deepEqual(sponsorReady(shows).map((s) => s.name), ["B", "A", "C", "D"]);
});

test("sponsorReady breaks ties on Qloo affinity and keeps every show", () => {
  const shows = [{ name: "low", affinity: 0.9, advertisers: [] }, { name: "high", affinity: 0.95, advertisers: [] }];
  assert.deepEqual(sponsorReady(shows).map((s) => s.name), ["high", "low"]);
  assert.deepEqual(sponsorReady(null), []);
});

import { askFirst, promoCodes } from "../public/rank.js";
test("askFirst: open shows by taste, then shows a rival uses; with no ad data, the best taste fits", () => {
  const shows = [
    { name: "Top fit, no data", affinity: 0.99, advertisers: null },
    { name: "Open low", affinity: 0.90, advertisers: ["x"], rivals: [] },
    { name: "Open high", affinity: 0.95, advertisers: ["y"], rivals: [] },
    { name: "Rival", affinity: 0.97, advertisers: ["Hoka"], rivals: ["Hoka"] },
  ];
  assert.deepEqual(askFirst(shows).shows.map((s) => s.name), ["Open high", "Open low", "Rival"]);
  assert.equal(askFirst([{ name: "a", affinity: 0.9, advertisers: null }]).selling, false);
});
test("promoCodes: a readable word per show, never twice", () => {
  assert.deepEqual(promoCodes(["Absolutely Not", "Armchair Expert with Dax Shepard", "A Beautiful Mess Podcast", "Absolutely Fine"]), ["ABSOLUTELY", "ARMCHAIR", "BEAUTIFUL", "ABSOLUTELY2"]);
});
