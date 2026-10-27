// The agent's outreach pack for the shows to ask first: a rate request email and a 30 second host-read script per show,
// written by Claude from the run's own Qloo results and the product facts the user typed. Nothing is sent: the page
// offers copy buttons. Anything the model was not given goes in [brackets], to discourage invented rates, reach or
// product claims (a media buyer review on 22 Oct asked for a next step that is more than a search link).

const str = { type: "string" };
export const OUTREACH_TOOL = {
  name: "submit_outreach",
  description: "Submit one outreach draft per show, in the order given.",
  strict: true,
  input_schema: {
    type: "object", additionalProperties: false,
    properties: {
      shows: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { show: str, why_fit: str, email_subject: str, email_body: str, host_read: str },
          required: ["show", "why_fit", "email_subject", "email_body", "host_read"],
        },
      },
    },
    required: ["shows"],
  },
};

export const OUTREACH_SYSTEM = `You write podcast sponsorship outreach for a media buyer. For each show you get its Qloo taste fit
for the audience of a reference brand (0 to 1; the reference brand is the user's own brand or a close competitor), the
advertisers found in its episode notes, the brands of the product's category found there, the show's own description
and tags from Qloo, and a proposed promo code. You also get the product as the user typed it and a few things the same
audience likes, from Qloo. Each show's drafts must be written for that show: two shows must not get the same email or
the same read with only the name changed. Write, for each show:
- why_fit: one sentence under 20 words for the buyer: "[reference brand] fans like this show (Qloo taste fit 0.95)", then
  one or two things the same audience also likes, ONLY when supplied. If no other tastes were supplied, omit them. Do not say the show's listeners like them, and do not list advertisers.
- email_subject and email_body: a rate request to the show's ad sales team, under 130 words, that opens with the show's
  name (for example "Hello Absolutely Not team,"). Ask for: rate per episode, average downloads per episode, host-read
  slots, next open dates, and whether the category is exclusive. Also ask what share of the audience is in the stated
  market, which reporting window the downloads cover, and how delivery is measured. Do not infer local reach from
  Qloo popularity or assume a US-wide podcast has a local audience. Say in one line why it fits, the right way round:
  "people who like brands like ours, such as [reference brand], also like your show", and in one more line how the
  product connects to what this show is about, taken from its description or tags. You may name one or two advertisers
  found in its notes as brands it already reads for, but never a brand of the product's own category. Never claim the show's listeners like anything else. If the show has no observed ads and no verified advertising
  contact, first ask whether it accepts sponsors. A contact is not proof of available inventory. Mention the
  proposed promo code. Sign with [YOUR NAME] and [BRAND].
- host_read: a host-read script of 40 to 70 words, in a host's voice, that a host could read on air as it is. Name the
  sponsor as [BRAND]. Open with one line that ties the product to this show's subject, in the host's words, without
  claims about the listeners or the product beyond the facts given. Use every product fact given (material, product type, price, and words such as "sustainable"),
  each once, and nothing else about the product: no benefits, comfort, fit, durability or comparisons that were not
  given. Never repeat the price, never pad, never comment on the script itself (no "that is the whole pitch"). Leave the
  host room for their own words as [HOST: a line or two about trying them], then end with the promo code, [OFFER] and
  [LANDING PAGE]. No other brackets.
Rules: never invent rates, downloads, listener numbers, discounts or names of people. Plain natural English, no dashes as
punctuation, no "X, not Y" contrasts, no lists of three adjectives. Call submit_outreach once.`;

const clean = (s, max) => String(s ?? "").replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, ", ").trim().slice(0, max);
const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The model's message for the shows, with only what it needs. */
export function outreachInput({ product, market, shows, codes, category, alsoLike, reference }) {
  return `Product: ${product}
Market: ${market}
Category: ${category || "unknown"}
Reference brand (the user's brand or a close competitor): ${reference || "none given"}
The same audience also likes (Qloo): ${alsoLike.join(", ") || "none given"}
Shows:
${shows.map((s, i) => `${i + 1}. ${s.name} | about: ${String(s.about || "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 160) || "no description"}${Array.isArray(s.tags) && s.tags.length ? ` | tags: ${s.tags.join(", ")}` : ""} | taste fit ${Number(s.affinity).toFixed(2)} | advertisers in notes: ${Array.isArray(s.advertisers) ? (s.advertisers.join(", ") || "none found") : "not in our data"} | ${category || "category"} brands in notes: ${Array.isArray(s.advertisers) ? (Array.isArray(s.rivals) && s.rivals.length ? s.rivals.join(", ") : "none found") : "unknown"} | official contact type: ${s.contact?.kind || "unverified"} | proposed code: ${codes[i]}`).join("\n")}`;
}

/** Keep only drafts that belong to the shows asked about: matched by name (exact, or one name starting the other), else
 *  any unused draft that names the show or its code. A draft is never used twice; a missing one stays missing.
 *  (The independent review of 22 Oct found a shortened name could hand one show's email to another.) */
export function checkOutreach(out, shows, codes) {
  const got = Array.isArray(out?.shows) ? out.shows : [];
  const used = new Set();
  const take = (d) => { if (!d || used.has(d)) return null; used.add(d); return d; };
  const names = (d) => norm(d?.show);
  const mentions = (d, s, code) => { const t = `${d?.email_subject} ${d?.email_body} ${d?.host_read}`; return norm(t).includes(norm(s.name).slice(0, 12)) || t.includes(code); };
  return shows.map((s, i) => {
    const want = norm(s.name);
    const d = take(got.find((g) => !used.has(g) && names(g) === want))
      || take(got.find((g) => !used.has(g) && names(g) && (want.startsWith(names(g)) || names(g).startsWith(want))))
      || take(got.find((g) => !used.has(g) && mentions(g, s, codes[i])));
    if (!d) return null;
    return { show: s.name, code: codes[i], why_fit: clean(d.why_fit, 300), email_subject: clean(d.email_subject, 140),
      email_body: clean(d.email_body, 1200), host_read: clean(d.host_read, 900) };
  }).filter(Boolean);
}

export { lintDraft } from "../public/draft-checks.js";

/** Run it: llm is an adapter made with OUTREACH_SYSTEM and [OUTREACH_TOOL]. */
export async function draftOutreach({ llm, product, market, shows, codes, category, alsoLike = [], reference = "", timeoutMs = 60000 }) {
  if (!shows.length) return null;
  // its own deadline, so a slow draft never costs the run its brief (the worker passes the time left)
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("the drafts took too long this time")), Math.max(1000, timeoutMs)); });
  const turn = await Promise.race([llm([{ role: "user", content: outreachInput({ product, market, shows, codes, category, alsoLike, reference }) }]), late]).finally(() => clearTimeout(timer));
  const call = turn.calls.find((c) => c.name === "submit_outreach");
  if (!call) throw new Error("the model did not return outreach drafts");
  return { shows: checkOutreach(call.input, shows, codes) };
}

/** Synthetic stand-in, clearly labelled, for runs without keys. */
export function mockOutreachLLM() {
  return async (messages) => {
    const lines = String(messages[0].content).split("\n").filter((l) => /^\d+\. /.test(l));
    const shows = lines.map((l) => {
      const parts = l.replace(/^\d+\. /, "").split(" | ");
      const name = parts[0], fit = parts.find((x) => x.startsWith("taste fit")), c = parts.at(-1).replace("proposed code: ", "");
      return { show: name, why_fit: `[SYNTHETIC] ${fit}.`, email_subject: `[SYNTHETIC] Sponsorship rates for ${name}`,
        email_body: `[SYNTHETIC] Hi, could you share your rate per episode, average downloads, host-read slots, open dates and category exclusivity? Code ${c}. [YOUR NAME], [BRAND]`,
        host_read: `[SYNTHETIC] [Product line]. Use code ${c} at [LANDING PAGE].` };
    });
    const input = { shows };
    return { raw: [{ type: "tool_use", id: "out_0", name: "submit_outreach", input }], calls: [{ id: "out_0", name: "submit_outreach", input }] };
  };
}
