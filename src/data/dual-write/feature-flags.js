const split = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);

export function dualWriteEnabled(env, context) {
  if (env?.MODE === "production" || env?.PROD === true) return false;
  if (String(env?.VITE_FIREBASE_DUAL_WRITE_ENABLED).toLowerCase() !== "true") return false;
  const users = split(env?.VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST);
  const organizations = split(env?.VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST);
  return users.includes(context.userId) && organizations.includes(context.organizationId);
}

export function legacyOrganizationId(userId) {
  const safe = String(userId || "").trim().replaceAll("/", "_");
  if (!safe) throw new Error("Missing userId");
  return `legacy_${safe}`;
}
