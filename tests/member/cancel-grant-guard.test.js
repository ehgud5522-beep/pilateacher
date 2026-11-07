import assert from "node:assert/strict";
import test from "node:test";
import {
  GRANT_REASON, GRANT_REASON_LABEL, INSTRUCTOR_GRANT_CAP, grantsByGranter, instructorGrantRoom, validateGrant,
} from "../../functions/shared/member-cancel.mjs";
import { grantFailureMessage } from "../../src/data/repositories/member-cancel-repository.js";

/* 취소 횟수 추가 경고 · 재량 (2026-11-07 대표 시안). 서버 · 강사 앱이 같이 쓰는 판정. */

test("사유 셋: 대표 시안의 문구 그대로", () => {
  assert.deepEqual(Object.values(GRANT_REASON_LABEL), ["건강 및 부상 등 불가피한 사유", "센터 또는 강사 일정 변경", "기타 특별 사유"]);
});

test("사유 판정: 고른 사유는 내용 없이도 되고, 기타는 내용 필수, 예전 화면(문장만)은 기타", () => {
  assert.deepEqual(validateGrant({ amount: 1, reasonCode: GRANT_REASON.HEALTH }),
    { ok: true, amount: 1, reasonCode: "health", reason: "건강 및 부상 등 불가피한 사유" });
  assert.equal(validateGrant({ amount: 1, reasonCode: GRANT_REASON.OTHER, reason: "" }).reason, "grant_reason_required");
  assert.equal(validateGrant({ amount: 1, reasonCode: "vip", reason: "x" }).reason, "grant_reason_code_invalid");
  const legacy = validateGrant({ amount: 2, reason: " 병원 " });
  assert.equal(legacy.reasonCode, "other");
  assert.equal(legacy.reason, "병원");
});

test("강사 재량은 칸마다 1회 — 대표 · 총괄은 제한 없음", () => {
  assert.equal(INSTRUCTOR_GRANT_CAP, 1);
  assert.equal(instructorGrantRoom("instructor", 0), 1);
  assert.equal(instructorGrantRoom("instructor", 1), 0);
  assert.equal(instructorGrantRoom("manager", 3), 0);
  assert.equal(instructorGrantRoom("owner", 5), null);
  assert.equal(instructorGrantRoom("area_manager", 5), null);
});

test("대표 화면: 강사별 건수 · 횟수 · 반복", () => {
  const rows = grantsByGranter([
    { grantedBy: "u1", amount: 1, repeat: false },
    { grantedBy: "u1", amount: 1, repeat: true },
    { grantedBy: "owner", amount: 2 },
  ]);
  assert.deepEqual(rows, [
    { grantedBy: "u1", count: 2, amount: 2, repeat: 1 },
    { grantedBy: "owner", count: 1, amount: 2, repeat: 0 },
  ]);
});

test("거절 문구는 코드와 함께 — 재량 초과는 누구에게 요청할지 말한다", () => {
  const needsAdmin = grantFailureMessage({ code: "functions/permission-denied", details: { reason: "grant_needs_admin" } });
  assert.match(needsAdmin, /대표 · 총괄매니저에게 요청/);
  assert.match(needsAdmin, /코드 grant_needs_admin/);
  assert.match(grantFailureMessage({ details: { reason: "grant_reason_code_invalid" } }), /사유를 다시 골라 주세요 \(코드 grant_reason_code_invalid\)/);
});
