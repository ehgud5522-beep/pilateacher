import { createHash } from "node:crypto";

const ID_PREFIXES = Object.freeze({
  organization: "org",
  location: "loc",
  client: "cli",
  lesson: "les",
  participant: "lpa",
  assessment: "asm",
  recommendation: "rec",
  outcome: "out",
  inbody: "inb",
  note: "lno",
  media: "med",
});

function normalizePart(value) {
  const part = String(value ?? "").trim();
  if (!part) throw new Error("ID parts must be non-empty");
  return part;
}

/**
 * Stable, non-reversible ID for idempotent legacy migration.
 * @param {keyof typeof ID_PREFIXES} entity
 * @param {Array<string|number>} parts
 */
export function deterministicId(entity, parts) {
  const prefix = ID_PREFIXES[entity];
  if (!prefix) throw new Error(`Unsupported entity type: ${entity}`);
  const material = ["pilateacher", "foundation-v1", entity, ...parts.map(normalizePart)].join("\u001f");
  const digest = createHash("sha256").update(material, "utf8").digest("base64url").slice(0, 24);
  return `${prefix}_${digest}`;
}

/**
 * @param {string} organizationId
 * @param {string} operationType
 * @param {string} sourceEntityId
 * @param {string|number} sourceVersion
 */
export function idempotencyKey(organizationId, operationType, sourceEntityId, sourceVersion) {
  return [organizationId, operationType, sourceEntityId, sourceVersion]
    .map(normalizePart)
    .join(":");
}
