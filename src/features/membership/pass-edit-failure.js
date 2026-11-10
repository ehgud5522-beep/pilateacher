/**
 * 회원권 수정(잔여 조정 · 만료일 변경 · 홀딩)이 막혔을 때 뭐라고 말할 것인가.
 *
 * 잔여가 모자란 것 · 만료일이 없는 것 · 역할이 그 방향을 못 하는 것 · 권한이
 * 없는 것은 할 일이 서로 다르다. 한 문구로 뭉개면 자기가 못 하는 일인 줄 알고
 * 물러나거나, 할 수 없는 일을 계속 누른다. 코드는 언제나 함께 보여준다.
 *
 * App.jsx 밖에 둔 것은 코드 → 문구를 테스트로 고정하기 위해서다 (CLAUDE.md §8).
 */

import { isOwnerLevelRole } from "../../data/schema/constants.js";

/** FC매니저가 잔여를 늘리려 할 때 화면과 오류가 같이 쓰는 말. */
export const ADJUST_INCREASE_NOTICE = "증가는 대표·총괄매니저만 가능해요.";

/**
 * @param {any} error
 * @param {{ direction?: string, role?: string }} [context] 조정이면 방향과 역할
 */
export function passEditFailure(error, context = {}) {
  const code = String(error?.details?.code || error?.code || "unknown").replace(/^functions\//, "");
  const holdMessages = {
    hold_already_active: "이미 홀딩 중입니다. 중복 연장하지 않았어요.",
    hold_not_active: "이미 이용 가능한 회원권입니다. 새로고침해 주세요.",
    hold_pass_unusable: "잔여 회차가 있는 활성 회원권만 홀딩할 수 있어요.",
    hold_reason_required: "홀딩 또는 해제 사유를 입력해 주세요.",
    hold_days_invalid: "홀딩 기간은 1일부터 365일까지 입력해 주세요.",
    hold_permission_denied: "대표·총괄매니저·FC매니저만 홀딩을 변경할 수 있어요.",
    hold_pass_not_found: "회원권을 찾지 못했습니다. 새로고침해 주세요.",
  };
  if (holdMessages[code]) return `${holdMessages[code]} (코드 ${code})`;
  if (code === "below_zero") {
    return `잔여는 0회 미만이 될 수 없어요. 지금 ${Number(error?.remaining) || 0}회 남아 있습니다.`;
  }
  if (code === "increase_owner_only") {
    return `${ADJUST_INCREASE_NOTICE} FC매니저는 잔여를 줄이는 조정만 할 수 있어요. (코드 ${code})`;
  }
  if (code === "role_not_allowed") {
    return `잔여 조정은 대표·총괄매니저·FC매니저만 할 수 있어요. (코드 ${code})`;
  }
  if (code === "no_previous_expiry") {
    return "이 회원권에는 만료일이 없어 옮길 수 없어요. 회원권을 다시 발급해 주세요.";
  }
  if (code === "unchanged") return "지금과 같은 날짜예요.";
  if (code === "permission-denied") {
    /* 규칙이 막은 증가. 옛 화면이거나 역할을 못 실은 호출이다 -- 대표·총괄이
       막힌 것이면 방향 탓이 아니므로 일반 문구로 둔다. */
    if (context.direction === "increase" && !isOwnerLevelRole(context.role)) {
      return `${ADJUST_INCREASE_NOTICE} (코드 ${code})`;
    }
    return `이 회원권을 고칠 권한이 없어요. 센터에 문의해 주세요. (코드 ${code})`;
  }
  if (["unavailable", "deadline-exceeded", "aborted", "cancelled"].includes(code)) {
    return `연결이 불안정해 저장하지 못했어요. 다시 시도해 주세요. (코드 ${code})`;
  }
  return `저장하지 못했어요. (코드 ${code})`;
}
