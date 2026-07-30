import { createHash } from "node:crypto";

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, normalized(child)]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalized(value));
}

export function checksum(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
