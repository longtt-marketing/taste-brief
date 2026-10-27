import { test } from "node:test";
import assert from "node:assert/strict";
import { contactFor, archivedShows } from "../public/contacts.js";
import { advertisersFor } from "../src/podcasts.js";

test("a Qloo catalogue match cannot override the official WTF finale", () => {
  assert.equal(archivedShows([{ name: "WTF with Marc Maron Podcast", affinity: .99 }]).length, 1);
  assert.equal(archivedShows([{ name: "Roderick on the Line", affinity: .99 }]).length, 0);
});

test("contacts: an official route does not fabricate episode sponsor data or inventory", () => {
  const route = contactFor("Home Cooking");
  assert.equal(route.kind, "advertising");
  assert.match(route.contact_url, /radiotopia\.fm/);
  assert.equal(advertisersFor("Home Cooking"), null);
  assert.match(route.verified_scope, /remain unknown/);
  assert.equal(route.checked_at, "2026-10-26");
});

test("contacts: similar podcast names never inherit a route, punctuation aliases can", () => {
  assert.equal(contactFor("Home Cooking New York"), null);
  assert.equal(contactFor("Absolutely Not a Podcast"), null);
  assert.equal(contactFor("Absolutely Not!").contact_url, contactFor("Absolutely Not").contact_url);
  assert.equal(contactFor("Some Unknown Show"), null);
});

test("contacts: a general contact is not presented as an advertising representative", () => {
  const route = contactFor("The Liz Moody Podcast");
  assert.equal(route.kind, "general");
  assert.match(route.instruction, /not verified/);
});

test("contacts: malformed or unsafe records cannot become clickable routes", () => {
  const route = { ...contactFor("Home Cooking"), names: ["Example"] };
  assert.equal(contactFor("Example", [{ ...route, contact_url: "javascript:alert(1)" }]), null);
  assert.equal(contactFor("Example", [{ ...route, checked_at: "unknown" }]), null);
});
