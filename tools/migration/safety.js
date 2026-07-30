const BLOCKED_PROJECT_PATTERNS = [
  /^pilateacher-prod$/i,
  /(^|[-_])prod(uction)?($|[-_])/i,
];

export function assertSafeProject(projectId) {
  const value = String(projectId ?? "").trim();
  if (!value) return;
  if (BLOCKED_PROJECT_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new Error(`Blocked Firebase project: ${value}`);
  }
}

export function assertDryRun(options) {
  if (options.write === true) {
    throw new Error("Write mode is intentionally unavailable in firebase-foundation-v1");
  }
}
