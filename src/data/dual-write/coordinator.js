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

/**
 * 다시 보내 볼 여지가 없는 실패.
 *
 * 연결이 끊겨 실패한 것과, 서버가 "이 쓰기는 안 된다" 고 답한 것은 다른
 * 일이다. 앞의 것은 나중에 같은 값으로 다시 보내면 들어가지만, 뒤의 것은 백 번
 * 보내도 같은 답이다 -- 기록에 쌓아 두면 **줄지 않는 숫자**가 되어 강사가
 * 그것을 보고도 아무것도 할 수 없다.
 *
 * 그래서 영구 오류는 기록하지 않고 **그 자리에서 말한다.** 규칙이 거부한
 * 쓰기는 사람이 고쳐야 하는 것이고, 사람에게 닿지 않으면 고쳐지지 않는다.
 */
const PERMANENT_ERROR_CODES = new Set([
  "permission-denied", "invalid-argument", "failed-precondition", "not-found",
  // 인증이 끊긴 것도 다시 보낸다고 풀리지 않는다. 다시 로그인해야 한다.
  "unauthenticated",
]);

/** @param {string} code */
export const isPermanentWriteError = (code) => PERMANENT_ERROR_CODES.has(String(code || ""));

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
        const errorCode = safeErrorCode(error);
        /* 영구 오류는 쌓지 않는다. 줄지 않는 숫자를 보여 주는 대신 그 자리에서
           말한다 -- 부르는 쪽이 secondary 로 갈래를 판다. */
        if (isPermanentWriteError(errorCode)) {
          this.retryStore?.remove(idempotencyKey);
          return { legacyResult, secondary: "refused", idempotencyKey, errorCode };
        }
        this.retryStore?.record({
          idempotencyKey,
          entityType,
          entityId,
          operation,
          lastErrorCode: errorCode,
          createdAt: now.toISOString(),
          nextRetryAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
        });
        return { legacyResult, secondary: "queued", idempotencyKey, errorCode };
      } finally {
        this.inFlight.delete(idempotencyKey);
      }
    })();
    this.inFlight.set(idempotencyKey, task);
    return task;
  }
}
