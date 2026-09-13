/**
 * 콘솔 전용 진단 로그.
 *
 * App.jsx 의 deviceLog 는 그 파일 안의 const 라 내보내지 않는다. 가져오려면
 * App.jsx 전체를 콘솔 번들에 끌어와야 하므로 같은 원칙만 따르는 작은 사본을
 * 둔다 — 허용 목록에 있는 필드만 남기고 나머지는 버린다.
 *
 * 이메일·비밀번호·토큰은 이 목록에 없다. 존재 여부(hasPassword)는 남겨도
 * 값은 남기지 않는다.
 */

const CONSOLE_LOG_FIELDS = new Set([
  "feature", "stage", "errorDomain", "errorCode", "message", "correlationId",
  "outcome", "role", "status", "isLegacy", "organizationId",
  "membershipCount", "selectedOrganizationId", "productId", "sessionType",
  "payCategory", "platform", "elapsedMs", "hasEmail", "hasPassword",
]);

/**
 * @param {string} event
 * @param {Record<string, unknown>} details
 */
export function consoleLog(event, details = {}) {
  try {
    const safe = {};
    Object.entries(details || {}).forEach(([key, value]) => {
      if (!CONSOLE_LOG_FIELDS.has(key) || value === undefined || value === null) return;
      safe[key] = key === "message" ? String(value).slice(0, 180) : value;
    });
    console.info(`[PilaTeacher/console] ${event}`, safe);
  } catch (_error) { /* 진단이 화면을 막지 않는다. */ }
}

/**
 * Firebase 오류를 사용자 문구 종류로 나눈다. 종류마다 문구가 다르고, 자동
 * 재시도는 일시적 오류에만 붙는다.
 * @param {any} error
 */
export function classifySignInError(error) {
  const code = String(error?.code || "");
  if (code === "auth/invalid-email" || code === "auth/missing-password") {
    return { kind: "invalid_request", retryable: false, message: "이메일과 비밀번호를 확인해 주세요." };
  }
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return { kind: "authentication", retryable: false, message: "이메일 또는 비밀번호가 맞지 않습니다." };
  }
  if (code === "auth/user-disabled") {
    return { kind: "permission", retryable: false, message: "사용이 중지된 계정입니다. 대표에게 문의해 주세요." };
  }
  if (code === "auth/too-many-requests") {
    return { kind: "server_unavailable", retryable: true, message: "시도가 많아 잠시 막혔습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (code === "auth/network-request-failed") {
    return { kind: "network", retryable: true, message: "네트워크가 불안정합니다. 연결을 확인하고 다시 시도해 주세요." };
  }
  return { kind: "unknown", retryable: false, message: `로그인하지 못했어요 (코드 ${code || "unknown"})` };
}
