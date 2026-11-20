/**
 * 회원 상세의 "급여 기준 누적" (2026-11-18 대표: "이미 20회 이상 수업함, 20회 미만 신규페이 안 되게").
 * **순수 함수만.**
 *
 * 급여 판정 3 은 강사–회원 쌍의 누적이 20 미만이면 신규 단가를 준다 (deduction-pricing.mjs).
 * 앱 이전 수업이 누적에 덜 들어간 회원은 이미 스무 번을 넘겼는데도 신규 단가로 차감된다.
 * 고치는 통로(adjustInstructorTotal)는 감사 기록과 한 배치로 이미 있었고, 화면이 없었다.
 *
 * 고친 값은 **앞으로의 차감부터** 적용된다. 이미 원장에 적힌 단가는 append-only 라 그대로다.
 * 듀엣 회원권은 두 회원의 누적 중 **적은 쪽**으로 판정한다 (pricingPriorSessions) -- 짝도 함께 봐야 한다.
 */

import { NEW_TO_INSTRUCTOR_THRESHOLD } from "../../../functions/shared/deduction-pricing.mjs";
import { passClientIds } from "../../../functions/shared/pass-clients.mjs";

export const TOTAL_ADJUST_REASON_LABEL = Object.freeze({
  manual_correction: "강사·회원에게 확인해 바로잡음",
  migration_overwrite: "이관 때 누적이 덜 들어감",
  service_sessions_removed: "서비스 회차가 섞여 있었음",
});

/** 이 회원을 가르친 강사들. 취소된 회원권은 빼고, 쓰는 중인 회원권의 강사가 먼저. */
export function totalAdjustInstructors(passes) {
  const list = (Array.isArray(passes) ? passes : []).filter((pass) => pass && pass.status !== "cancelled");
  const ordered = [...list.filter((pass) => pass.status === "active"), ...list.filter((pass) => pass.status !== "active")];
  return [...new Set(ordered.map((pass) => String(pass.instructorId || "")).filter(Boolean))];
}

/** 이 강사와 함께 쓰는 듀엣 짝 (판정이 둘 중 적은 누적을 본다). */
export function duetPartnersOf(passes, instructorId, clientId) {
  const out = new Set();
  for (const pass of Array.isArray(passes) ? passes : []) {
    if (!pass || pass.status === "cancelled" || String(pass.instructorId || "") !== String(instructorId || "")) continue;
    for (const id of passClientIds(pass)) if (id && id !== clientId) out.add(id);
  }
  return [...out];
}

/** 한 줄: "누적 12회 · 20회까지 신규 단가 (8회 남음)" / "누적 23회 · 기준 단가". */
export function totalTierLabel(sessions) {
  if (sessions === null || sessions === undefined) return "앱으로 진행한 수업 없음";
  const left = NEW_TO_INSTRUCTOR_THRESHOLD - sessions;
  return left > 0
    ? `누적 ${sessions}회 · ${NEW_TO_INSTRUCTOR_THRESHOLD}회까지 신규 단가 (${left}회 남음)`
    : `누적 ${sessions}회 · 기준 단가`;
}

/** 입력 검사. 정수 0 이상, 지금 값과 달라야 한다 (같은 값은 감사 항목이 거부한다). */
export function totalAdjustInputError(text, current) {
  const raw = String(text ?? "").trim();
  if (!/^\d{1,4}$/.test(raw)) return "0 이상의 숫자로 적어 주세요";
  if (Number(raw) === current) return "지금 값과 같아요";
  // 누적이 없는 칸에 0 을 넣는 것은 아무것도 바꾸지 않는다 (감사 규칙도 전 · 후가 같으면 거절).
  if (current === null && Number(raw) === 0) return "1 이상으로 적어 주세요";
  return "";
}

/** 실패 문구. 코드를 함께 보여 준다 (CLAUDE.md 4). */
export function totalAdjustFailure(error) {
  const code = String(error?.code || error?.message || "unknown");
  if (code === "stale_total") return `그 사이 수업이 확정돼 누적이 바뀌었어요. 닫았다가 다시 열어 확인해 주세요 (코드 ${code})`;
  if (code === "Missing total") return "이 강사와 앱으로 진행한 수업이 없어 누적 문서가 없어요 (코드 missing_total)";
  if (code === "permission-denied") return `누적은 대표·총괄매니저만 고칠 수 있어요 (코드 ${code})`;
  if (["unavailable", "deadline-exceeded", "aborted"].includes(code)) return `연결이 불안정해 저장하지 못했어요. 다시 시도해 주세요 (코드 ${code})`;
  return `처리하지 못했어요 (코드 ${code})`;
}
