import records, { availability } from "./data/podcast-contacts.js";

const norm = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const https = (value) => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; } };

/** Exact titles only: a similarly named podcast must never inherit another show's sales route. */
export function contactFor(showName, sources = records) {
  const match = sources.find((r) => r.names.some((n) => norm(n) === norm(showName)));
  if (!match || !["advertising", "general"].includes(match.kind)
    || !/^\d{4}-\d{2}-\d{2}$/.test(match.checked_at)
    || ![match.official_show_url, match.contact_url, match.evidence_url].every(https)) return null;
  const { names, ...route } = match;
  return { ...route, verified_scope: "contact route only; rates, reach, dates and exclusivity remain unknown" };
}

export function availabilityFor(showName, sources = availability) {
  const match = sources.find((r) => r.names.some((n) => norm(n) === norm(showName)));
  if (!match || !["archive", "recent_episode"].includes(match.status) || !https(match.source_url)
    || !/^\d{4}-\d{2}-\d{2}$/.test(match.checked_at) || !/^\d{4}-\d{2}-\d{2}$/.test(match.latest_observed)) return null;
  const { names, ...record } = match;
  return record;
}

export const archivedShows = (shows) => (Array.isArray(shows) ? shows : []).filter((s) => availabilityFor(s?.name)?.status === "archive");
