const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Plain checks on one draft, used by the outreach evaluation (scripts/outreach-eval.mjs) and the tests: does the email
 *  ask for the five things a buyer needs, carry the code, and invent no numbers; how many brackets are left. */
export function lintDraft(d, { product = "", fit = null, rivals = [] } = {}) {
  // asked in the body itself: a subject line "Sponsorship rates" is not a question, and "availability" may mean slots
  // (AI review, 22 Oct)
  const email = String(d.email_body || "").toLowerCase();
  const asks = { rate: /\brates?\b/.test(email), downloads: /download/.test(email), host_read: /host[- ]read/.test(email),
    dates: /\bdates?\b/.test(email), exclusive: /exclusiv/.test(email) };
  // numbers the draft may use: the product line's, the taste fit, "30" (seconds), and any in the show's own name
  const allowed = new Set([...(`${product} ${d.show}`.match(/\d+(?:[.,]\d+)?/g) || []), ...(fit != null ? [Number(fit).toFixed(2), String(Number(fit).toFixed(2)).replace(/^0/, "")] : []), "30"]);
  const text = `${d.email_body} ${d.host_read} ${d.why_fit}`.replace(/(^|\s)\d{1,2}[.)](?=\s)/g, " "); // list numbering is not a claim
  // A disambiguated promo code such as SAMPLE2 is a supplied identifier, not an invented numeric claim.
  const claimText = d.code ? text.split(d.code).join(" ") : text;
  const numbers = (claimText.match(/\d+(?:[.,]\d+)?/g) || []).filter((n) => !allowed.has(n) && !allowed.has(n.replace(/^0/, "")));
  const brackets = new Set(String(d.host_read || "").match(/\[[^\]]+\]/g) || []).size; // distinct placeholders left for the buyer
  // a read a host can use as it is: no fact said twice to fill time, no remarks about the script itself
  const spoken = String(d.host_read || "").replace(/\[[^\]]*\]/g, " ");
  const said = spoken.match(/\$?\d+(?:[.,]\d+)?/g) || [];
  const repeats = [...new Set(said.filter((n, i) => said.indexOf(n) !== i))];
  const padding = /whole pitch|that'?s (?:it|all)|again,|this (?:script|read|ad)\b/i.test(spoken);
  const words = spoken.split(/\s+/).filter(Boolean).length + 8; // the host's own line counts for about 8 words
  // naming a brand of the product's own category that already reads on the show tips the buyer's hand (AI review, 22 Oct)
  const all = `${d.email_body} ${d.host_read}`.toLowerCase();
  const namesRival = (Array.isArray(rivals) ? rivals : []).filter((r) => r && all.includes(String(r).toLowerCase()));
  return { asks_all: Object.values(asks).every(Boolean), asks, code: text.includes(d.code), invented_numbers: numbers, host_read_brackets: brackets, names_rival: namesRival,
    host_read_repeats: repeats, host_read_padding: padding, host_read_words: words,
    opens_with_show: norm(String(d.email_body || "").split("\n")[0].slice(0, 60)).includes(norm(d.show).slice(0, 8)) };
}

/** The same finite draft checks feed model feedback, the visible warning and exported Markdown.
 * Passing is not full factual verification; the buyer still edits every draft. */
export function reviewDraft(d, facts = {}) {
  const l = lintDraft(d, facts);
  const issues = [];
  const missing = Object.keys(l.asks).filter((k) => !l.asks[k]);
  if (missing.length) issues.push(`Missing questions: ${missing.join(", ")}`);
  if (!d.code || !l.code) issues.push("Missing supplied promo code");
  if (l.invented_numbers.length) issues.push(`Unverified numbers: ${l.invented_numbers.join(", ")}`);
  if (l.host_read_repeats.length) issues.push(`Repeated spoken numbers: ${l.host_read_repeats.join(", ")}`);
  if (l.host_read_padding) issues.push("Script contains filler about the script itself");
  if (l.names_rival.length) issues.push(`Names a category rival: ${l.names_rival.join(", ")}`);
  if (!String(d.email_body || "").trim() || !String(d.host_read || "").trim()) issues.push("A draft is missing");
  return { passed: issues.length === 0, issues, ...l };
}
export function draftReviewText(review) {
  return review?.passed ? "Automated draft checks passed. Edit and confirm every claim before use."
    : `HELD for editing: ${review?.issues?.join("; ") || "checks unavailable"}. Copy buttons stay disabled.`;
}
