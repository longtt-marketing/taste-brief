// Two-market comparison: what the Qloo-grounded briefs say differently about the same product in two markets.
// Shared by the page (browser) and the tests (node).
const norm = (s) => String(s || "").toLowerCase().replace(/\(check in ads manager\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function compareBriefs(a, b) {
  const list = (x, key, field) => (x?.[key] || []).map((i) => ({ label: i[field], key: norm(i[field]), evidence: i.evidence || [] }));
  const diff = (key, field) => {
    const A = list(a, key, field), B = list(b, key, field);
    const inA = new Set(A.map((i) => i.key)), inB = new Set(B.map((i) => i.key));
    return {
      only_a: A.filter((i) => !inB.has(i.key)),
      only_b: B.filter((i) => !inA.has(i.key)),
      shared: A.filter((i) => inB.has(i.key)),
    };
  };
  return {
    interests: diff("meta_interests", "interest"),
    traits: diff("audience_traits", "trait"),
    demographics: { a: a?.demographics || null, b: b?.demographics || null },
  };
}
