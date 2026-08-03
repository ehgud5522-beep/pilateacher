export function idempotencyKeyOf({ organizationId, entityType, entityId, operation, version = 1 }) {
  return [organizationId, entityType, entityId, operation, version].map(encodeURIComponent).join(":");
}

export function mutationFingerprint(value) {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, normalize(item[key])]));
    }
    return item;
  };
  const input = JSON.stringify(normalize(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeErrorCode(error) {
  const code = String(error?.code || "");
  const allowed = new Set([
    "aborted", "already-exists", "cancelled", "data-loss", "deadline-exceeded",
    "failed-precondition", "internal", "invalid-argument", "not-found",
    "permission-denied", "resource-exhausted", "unauthenticated", "unavailable",
  ]);
  const normalized = code.replace(/^firestore\//, "");
  return allowed.has(normalized) ? normalized : "unknown";
}

export class DualWriteCoordinator {
  constructor({ enabled, retryStore = null, now = () => new Date(), retryDelayMs = 30_000 }) {
    this.enabled = enabled;
    this.retryStore = retryStore;
    this.now = now;
    this.retryDelayMs = retryDelayMs;
    this.inFlight = new Map();
  }

  async execute({ context, entityType, entityId, operation, legacyWrite, newWrite, version = 1 }) {
    const legacyResult = await legacyWrite();
    if (!this.enabled(context)) return { legacyResult, secondary: "disabled" };
    if (!String(context?.organizationId || "").trim()) {
      return { legacyResult, secondary: "invalid_context" };
    }
    const idempotencyKey = idempotencyKeyOf({ organizationId: context.organizationId, entityType, entityId, operation, version });
    if (this.inFlight.has(idempotencyKey)) return this.inFlight.get(idempotencyKey);
    const task = (async () => {
      try {
        await newWrite(idempotencyKey);
        this.retryStore?.remove(idempotencyKey);
        return { legacyResult, secondary: "written", idempotencyKey };
      } catch (error) {
        const now = this.now();
        this.retryStore?.record({
          idempotencyKey,
          entityType,
          entityId,
          operation,
          lastErrorCode: safeErrorCode(error),
          createdAt: now.toISOString(),
          nextRetryAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
        });
        return { legacyResult, secondary: "queued", idempotencyKey };
      } finally {
        this.inFlight.delete(idempotencyKey);
      }
    })();
    this.inFlight.set(idempotencyKey, task);
    return task;
  }
}
