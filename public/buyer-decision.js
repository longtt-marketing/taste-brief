import { contactFor, availabilityFor } from "./contacts.js";
import { sponsorEvidence, policyBlocks } from "./rank.js";

/** A next research action, not a booking or a claim that an ad will work.
 * Kept separate from ranking and the locked historical evaluation. */
export function buyerDecision(show, { market = "the target market", category = null, policy = "allow" } = {}) {
  const contact = contactFor(show?.name);
  const publishing = availabilityFor(show?.name);
  const evidence = sponsorEvidence(show);
  const questions = [
    "What does one placement cost, including production and reporting?",
    `What share of the audience is in ${String(market || "the target market")}, and how was it measured?`,
    "Which reporting window do the download figures cover, and how will ad delivery be measured?",
    "Which host-read formats, positions and dates can you offer?",
    `Are there any ${category ? `${category} category ` : "category "}exclusivity restrictions?`,
    "Can we review the read and confirm our code/link before it goes live?",
  ];
  if (policyBlocks([show], policy).length) return {
    status: "excluded", next: "Skip under your rival policy",
    basis: "A category brand was found in the checked notes. Your policy excludes this show.",
    questions: [], contact, readyToAsk: false,
  };
  if (publishing?.status === "archive") return {
    status: "archive", next: "Leave out of a new host-read shortlist", basis: publishing.note,
    questions: [], contact, publishing, readyToAsk: false,
  };
  if (!Number.isFinite(show?.affinity) || show.affinity < 0 || show.affinity > 1) return {
    status: "hold", next: "Verify the taste result first", basis: "This show has no valid Qloo taste score in the run.",
    questions: [], contact, readyToAsk: false,
  };
  let status, next, basis;
  if (contact?.kind === "advertising") {
    status = "request_rates";
    next = "Ask the official ad team for a quote";
    basis = `An advertising contact route was checked on ${contact.checked_at}.`;
  } else if (evidence.ads === "found") {
    status = "find_ad_team";
    next = contact ? "Ask for the ad-sales representative" : "Find the show's ad-sales contact";
    basis = "Sponsor mentions were found, but a dedicated ad-sales contact is not verified.";
  } else {
    status = "verify_ad_sales";
    next = "First confirm whether the show accepts sponsors";
    basis = evidence.ads === "unknown" ? "Sponsor-note coverage is unknown and no advertising route is verified."
      : "No sponsor mentions were detected in the checked notes; that does not establish an ad-free show.";
    questions.unshift("Does the show currently accept host-read sponsorships, and who handles them?");
  }
  if (evidence.category === "found") basis += " A category brand was detected; confirm exclusivity before discussing a booking.";
  else if (evidence.category === "unknown") basis += " Category competition is unknown.";
  if (!publishing) questions.unshift("Is the show currently releasing episodes and booking new host reads?");
  return { status, next, basis, questions, contact, publishing, readyToAsk: status === "request_rates" };
}

export function decisionMarkdown(show, context) {
  const d = buyerDecision(show, context);
  return [`Next decision: ${d.next}.`, `Basis: ${d.basis}`, "Rates, reach, availability and exclusivity are not verified.",
    ...(d.publishing ? [`Publishing source: ${d.publishing.source_url} (checked ${d.publishing.checked_at}; latest observed episode ${d.publishing.latest_observed}).`] : []),
    ...(d.questions.length ? ["Questions before booking:", ...d.questions.map((q) => `- ${q}`)] : [])].join("\n");
}
