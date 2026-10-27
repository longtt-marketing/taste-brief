// Reject unusable provider identities before a model can cite them. A successful HTTP status is not proof of usable data.
export const invalidEntityId = (id) => typeof id !== "string" || !id.trim() || /^0+(?:-0+)*$/.test(id.trim());
export const identityName = (name) => String(name || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
export function identityError() {
  return Object.assign(new Error("Qloo returned unusable entity identifiers. This run has stopped because its taste evidence cannot be verified. Try again later or inspect the dated recorded example."), { code: "QLOO_INVALID_IDENTITIES" });
}
export function assertIdentities(entities) {
  const names = new Map();
  for (const entity of entities) {
    const id = entity?.entity_id, name = identityName(entity?.name);
    if (invalidEntityId(id) || !name || (names.has(id) && names.get(id) !== name)) throw identityError();
    names.set(id, name);
  }
  return entities;
}
export function rethrowIdentityError(error) { if (error?.code === "QLOO_INVALID_IDENTITIES") throw error; }
