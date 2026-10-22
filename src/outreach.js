// The agent's outreach pack for the shows to ask first: a rate request email and a 30 second host-read script per show,
// written by Claude from the run's own Qloo results and the product facts the user typed. Nothing is sent: the page
// offers copy buttons. Anything the model was not given goes in [brackets], so a draft never invents rates, reach or
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
for the brand's audience (0 to 1), the advertisers found in its episode notes, the brands of the product's category found
there, and a proposed promo code. You also get the product as the user typed it and a few things the same audience likes,
from Qloo. Write, for each show:
- why_fit: one sentence under 20 words for the buyer, in the form "[brand] fans like this show (Qloo taste fit 0.95)", then the
  same audience also likes one or two of the things listed. Do not say the show's listeners like them, and do not repeat
  the advertiser list (the page shows it).
- email_subject and email_body: a short rate request to the show's ad sales contact, under 110 words. Ask for the rate per
  episode, average downloads per episode, host-read slots, the next open dates, and whether the category is exclusive.
  Say in one line why it fits, the right way round: people who like the brand also like this show (that is what the
  taste fit measures). Never claim the show's listeners like anything else. Mention the proposed promo code. Sign with
  [YOUR NAME] and [BRAND].
- host_read: a 30 second host-read script, about 70 words, that a host could read in their own voice, ending with the
  promo code and [LANDING PAGE].
Rules: use only product facts given in the input; for anything else (materials, benefits, offer, price changes) write a
[bracketed placeholder]. Never invent rates, downloads, listener numbers or names of people. Plain natural English, no
dashes as punctuation, no "X, not Y" contrasts, no lists of three adjectives. Call submit_outreach once.`;

const clean = (s, max) => String(s ?? "").replace(/\s+[—–]\s+/g, ", ").replace(/[—–]/g, ", ").trim().slice(0, max);

/** The model's message for the shows, with only what it needs. */
export function outreachInput({ product, market, shows, codes, category, alsoLike }) {
  return `Product: ${product}
Market: ${market}
Category: ${category || "unknown"}
The same audience also likes (Qloo): ${alsoLike.join(", ") || "none given"}
Shows:
${shows.map((s, i) => `${i + 1}. ${s.name} | taste fit ${Number(s.affinity).toFixed(2)} | advertisers in notes: ${Array.isArray(s.advertisers) ? (s.advertisers.join(", ") || "none found") : "not in our data"} | ${category || "category"} brands in notes: ${Array.isArray(s.advertisers) ? (Array.isArray(s.rivals) && s.rivals.length ? s.rivals.join(", ") : "none found") : "unknown"} | proposed code: ${codes[i]}`).join("\n")}`;
}

/** Keep only drafts for the shows asked about, in that order, trimmed; a missing one stays missing. */
export function checkOutreach(out, shows, codes) {
  const got = Array.isArray(out?.shows) ? out.shows : [];
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return shows.map((s, i) => {
    const d = got.find((g) => norm(g.show) === norm(s.name)) || got[i];
    if (!d) return null;
    return { show: s.name, code: codes[i], why_fit: clean(d.why_fit, 300), email_subject: clean(d.email_subject, 140),
      email_body: clean(d.email_body, 1200), host_read: clean(d.host_read, 900) };
  }).filter(Boolean);
}

/** Run it: llm is an adapter made with OUTREACH_SYSTEM and [OUTREACH_TOOL]. */
export async function draftOutreach({ llm, product, market, shows, codes, category, alsoLike = [] }) {
  if (!shows.length) return null;
  const turn = await llm([{ role: "user", content: outreachInput({ product, market, shows, codes, category, alsoLike }) }]);
  const call = turn.calls.find((c) => c.name === "submit_outreach");
  if (!call) throw new Error("the model did not return outreach drafts");
  return { shows: checkOutreach(call.input, shows, codes) };
}

/** Synthetic stand-in, clearly labelled, for runs without keys. */
export function mockOutreachLLM() {
  return async (messages) => {
    const lines = String(messages[0].content).split("\n").filter((l) => /^\d+\. /.test(l));
    const shows = lines.map((l) => {
      const [name, fit, , , code] = l.replace(/^\d+\. /, "").split(" | ");
      const c = code.replace("proposed code: ", "");
      return { show: name, why_fit: `[SYNTHETIC] ${fit}.`, email_subject: `[SYNTHETIC] Sponsorship rates for ${name}`,
        email_body: `[SYNTHETIC] Hi, could you share your rate per episode, average downloads, host-read slots, open dates and category exclusivity? Code ${c}. [YOUR NAME], [BRAND]`,
        host_read: `[SYNTHETIC] [Product line]. Use code ${c} at [LANDING PAGE].` };
    });
    const input = { shows };
    return { raw: [{ type: "tool_use", id: "out_0", name: "submit_outreach", input }], calls: [{ id: "out_0", name: "submit_outreach", input }] };
  };
}
