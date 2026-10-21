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
