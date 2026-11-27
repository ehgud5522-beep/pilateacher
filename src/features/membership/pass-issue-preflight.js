/**
 * 회원권 발급이 막혔을 때 무엇 때문인지 말한다 (2026-11-28).
 *
 * 2026-11-24 ~ 11-28 FC 들의 PT 발급이 나흘 동안 `permission-denied` 한 줄로만 막혔다. 원인은
 * 규칙의 식 1000개 한도였는데(#292), 화면도 진단도 같은 한 줄이라 FC 계정 · 회원 지점 · 플로우
 * 등록 상태를 하나씩 운영 데이터에서 지워 나가야 했다. 그래서 둘을 한다:
 *
 *   1. 저장 전에 앱이 알 수 있는 거절은 앱이 먼저 따진다 -- 고른 플로우 등록이 아직 대기인지,
 *      FC 가 맡은 지점의 회원인지. 이것들은 규칙이 이유 없이 거절하기 전에 이유를 말할 수 있다.
 *   2. 그래도 거절되면 종류별로 다른 문구를 쓰고, 어떤 발급이었는지(역할 · 게이트 · PT · 플로우
 *      연결 방식 · 결제 수단 · 듀엣)를 짧은 참조 코드로 붙인다 -- FC 가 보내는 화면 캡처 한 장으로
 *      어느 조합이 막혔는지 바로 읽힌다. 이름 · 전화 · 금액은 넣지 않는다 (CLAUDE.md §7).
 *
 * 종류는 CLAUDE.md "사용자 문구는 종류별로" 표를 따른다.
 */
import { managerCanTouchPass } from "../../data/repositories/location-repository.js";

export const PASS_ISSUE_FAILURE_KIND = Object.freeze({
  NETWORK: "network",
  AUTHENTICATION: "authentication",
  PERMISSION: "permission",
  INVALID_REQUEST: "invalid_request",
  SERVER_UNAVAILABLE: "server_unavailable",
  DATA_CONFLICT: "data_conflict",
  UNKNOWN: "unknown",
});

export const PASS_ISSUE_FAILURE_CODE = Object.freeze({
  FLOW_POST_NOT_WAITING: "flow_post_not_waiting",
  FLOW_POST_MISSING: "flow_post_missing",
  LOCATION_OUT_OF_SCOPE: "pass_location_out_of_scope",
});

const FLOW_STATE_LABEL = Object.freeze({
  issued: "이미 발급 완료",
  not_applicable: "해당 없음",
  baseline: "기준선(11-24 전 등록)",
});

const text = (value) => String(value ?? "").trim();

/**
 * 어떤 발급이었는지 -- 값이 아니라 갈래만. 예: "manager/gate-on/pt/linked/mixed/duet".
 *
 * @param {{ role?: string, gateOn?: boolean, flowPt?: boolean, flowPayload?: { flowPostId?: string, flowBypassReason?: string },
 *   paymentMethod?: string, duet?: boolean }} context
 */
export function passIssueRef(context = {}) {
  const payload = context.flowPayload || {};
  const flow = !context.flowPt ? "-"
    : payload.flowPostId ? "linked"
      : payload.flowBypassReason ? "bypass"
        : "none";
  return [
    text(context.role) || "unknown-role",
    context.gateOn ? "gate-on" : "gate-off",
    context.flowPt ? "pt" : "etc",
    flow,
    text(context.paymentMethod) || "no-payment",
    context.duet ? "duet" : "single",
  ].join("/");
}

/**
 * 고른 플로우 등록이 아직 발급할 수 있는가. 저장 직전에 문서를 다시 읽은 값으로 본다 -- 발급 화면을
 * 연 뒤 누가 [이미 발급 완료] 를 눌렀으면 목록은 그대로인데 규칙은 거절한다 (2026-11-27 장유).
 *
 * @param {null | { id?: string, state?: string }} item 다시 읽은 발급 대기 문서 (없으면 null)
 * @returns {null | { kind: string, code: string, message: string }}
 */
export function flowPostFailure(item) {
  if (!item) {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.DATA_CONFLICT,
      code: PASS_ISSUE_FAILURE_CODE.FLOW_POST_MISSING,
      message: `고른 플로우 등록을 찾지 못했어요. 목록에서 다시 골라 주세요 (코드 ${PASS_ISSUE_FAILURE_CODE.FLOW_POST_MISSING}).`,
    };
  }
  const state = text(item.state) || "waiting";
  if (state === "waiting") return null;
  const label = FLOW_STATE_LABEL[state] || state;
  return {
    kind: PASS_ISSUE_FAILURE_KIND.DATA_CONFLICT,
    code: PASS_ISSUE_FAILURE_CODE.FLOW_POST_NOT_WAITING,
    message: `고른 플로우 등록은 이미 처리됐어요 (${label}). 목록에서 뺐어요 -- 다른 등록을 고르거나, `
      + `이 회원권이 아직 안 나갔다면 '플로우 없이 발급' 에 사유를 적어 주세요 (코드 ${PASS_ISSUE_FAILURE_CODE.FLOW_POST_NOT_WAITING}:${state}).`,
  };
}

/**
 * FC 가 맡은 지점의 회원인가. 규칙의 passInManagerScope 와 같은 선 (managerCanTouchPass).
 *
 * @param {{ role?: string, locationId?: string, locationIds?: string[] }} scope
 * @param {string} locationId 회원의 지점 (발급할 회원권의 지점이 된다)
 * @returns {null | { kind: string, code: string, message: string }}
 */
export function passLocationFailure(scope, locationId) {
  if (managerCanTouchPass(scope, { locationId })) return null;
  return {
    kind: PASS_ISSUE_FAILURE_KIND.PERMISSION,
    code: PASS_ISSUE_FAILURE_CODE.LOCATION_OUT_OF_SCOPE,
    message: `맡은 지점의 회원이 아니라 발급할 수 없어요. 대표에게 맡은 지점을 확인해 달라고 해 주세요 (코드 ${PASS_ISSUE_FAILURE_CODE.LOCATION_OUT_OF_SCOPE}).`,
  };
}

/** 저장 경로(issuePass)가 직접 던지는 코드 -- 입력이 결정적으로 잘못된 것. */
const APP_INVALID_CODES = new Set(["flow_post_invalid", "flow_bypass_reason_short", "flow_pt_both"]);

/**
 * 저장이 거절된 뒤의 문구. 원본 코드를 그대로 붙이고, 참조 코드(passIssueRef)를 함께 단다.
 *
 * @param {any} error
 * @param {string} ref passIssueRef 의 값
 * @returns {{ kind: string, code: string, retry: boolean, message: string }}
 */
export function describePassIssueFailure(error, ref = "") {
  const code = text(error?.code) || text(error?.message) || "unknown";
  const tail = ref ? ` · ${ref}` : "";
  if (code === "permission-denied") {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.PERMISSION, code, retry: false,
      message: `발급 규칙이 이 발급을 받지 않았어요. 이 화면을 대표에게 보내 주세요 (코드 ${code}${tail}).`,
    };
  }
  if (code === "unauthenticated") {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.AUTHENTICATION, code, retry: false,
      message: `로그인이 풀렸어요. 다시 로그인한 뒤 발급해 주세요 (코드 ${code}).`,
    };
  }
  if (code === "unavailable" || code === "deadline-exceeded" || code === "network-request-failed") {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.NETWORK, code, retry: true,
      message: `연결이 불안정해 저장하지 못했어요. 입력한 내용은 그대로 있어요 -- [확인] 을 다시 눌러 주세요 (코드 ${code}).`,
    };
  }
  if (code === "resource-exhausted" || code === "internal" || code === "aborted") {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.SERVER_UNAVAILABLE, code, retry: true,
      message: `서버가 잠시 받지 못했어요. 입력한 내용은 그대로 있어요 -- 잠시 뒤 [확인] 을 다시 눌러 주세요 (코드 ${code}).`,
    };
  }
  if (code === "invalid-argument" || APP_INVALID_CODES.has(code) || /^(Invalid|Missing|Forbidden) /.test(code)) {
    return {
      kind: PASS_ISSUE_FAILURE_KIND.INVALID_REQUEST, code, retry: false,
      message: `입력한 값으로는 발급할 수 없어요. 칸을 확인해 주세요 (코드 ${code}${tail}).`,
    };
  }
  return {
    kind: PASS_ISSUE_FAILURE_KIND.UNKNOWN, code, retry: false,
    message: `발급하지 못했어요 (코드 ${code}${tail}).`,
  };
}
