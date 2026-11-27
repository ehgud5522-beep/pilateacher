/* 회원권 발급이 막혔을 때의 문구 (2026-11-28). 코드 → 종류 → 문구가 한 줄로 이어지는지 고정한다 (CLAUDE.md §8). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PASS_ISSUE_FAILURE_CODE, PASS_ISSUE_FAILURE_KIND, describePassIssueFailure, flowPostFailure, passIssueRef, passLocationFailure,
} from "../../src/features/membership/pass-issue-preflight.js";

test("참조 코드는 갈래만 -- 역할 · 게이트 · PT · 플로우 연결 방식 · 결제 · 듀엣", () => {
  assert.equal(passIssueRef({ role: "manager", gateOn: true, flowPt: true, flowPayload: { flowPostId: "88731469" }, paymentMethod: "mixed", duet: true }),
    "manager/gate-on/pt/linked/mixed/duet");
  assert.equal(passIssueRef({ role: "manager", gateOn: true, flowPt: true, flowPayload: { flowBypassReason: "이전 등록" }, paymentMethod: "card" }),
    "manager/gate-on/pt/bypass/card/single");
  assert.equal(passIssueRef({ role: "owner", gateOn: false, flowPt: false, flowPayload: {}, paymentMethod: "cash" }),
    "owner/gate-off/etc/-/cash/single");
  // 사유 글자 · 등록 번호는 참조 코드에 들어가지 않는다.
  const ref = passIssueRef({ role: "manager", gateOn: true, flowPt: true, flowPayload: { flowBypassReason: "회원 김OO 요청", flowPostId: "" }, paymentMethod: "card" });
  assert.ok(!ref.includes("김") && !ref.includes("88731469"));
});

test("고른 플로우 등록: 대기면 통과, 처리됐거나 없으면 데이터 충돌로 이유를 말한다", () => {
  assert.equal(flowPostFailure({ id: "1", state: "waiting" }), null);
  assert.equal(flowPostFailure({ id: "1" }), null, "state 없는 옛 문서는 대기로 본다 (앱 목록과 같은 읽기)");
  const issued = flowPostFailure({ id: "1", state: "issued" });
  assert.equal(issued?.kind, PASS_ISSUE_FAILURE_KIND.DATA_CONFLICT);
  assert.equal(issued?.code, PASS_ISSUE_FAILURE_CODE.FLOW_POST_NOT_WAITING);
  assert.match(issued?.message || "", /이미 처리됐어요 \(이미 발급 완료\)/);
  assert.match(issued?.message || "", /flow_post_not_waiting:issued/);
  assert.match(flowPostFailure({ id: "1", state: "not_applicable" })?.message || "", /해당 없음/);
  const missing = flowPostFailure(null);
  assert.equal(missing?.code, PASS_ISSUE_FAILURE_CODE.FLOW_POST_MISSING);
  assert.equal(missing?.kind, PASS_ISSUE_FAILURE_KIND.DATA_CONFLICT);
});

test("맡은 지점 밖의 회원은 저장 전에 권한 종류로 막는다 -- 규칙의 passInManagerScope 와 같은 선", () => {
  const yangsan = { role: "manager", locationId: "yangsan", locationIds: [] };
  assert.equal(passLocationFailure(yangsan, "yangsan"), null);
  assert.equal(passLocationFailure(yangsan, ""), null, "지점 없는 회원(옛 이관분)은 막지 않는다");
  assert.equal(passLocationFailure({ role: "owner", locationId: "bansong" }, "yangsan"), null, "대표는 묻지 않는다");
  assert.equal(passLocationFailure({ role: "manager", locationId: "" }, "yangsan"), null, "지점이 비어 있는 FC 는 막지 않는다");
  const outside = passLocationFailure(yangsan, "jwadong");
  assert.equal(outside?.kind, PASS_ISSUE_FAILURE_KIND.PERMISSION);
  assert.equal(outside?.code, PASS_ISSUE_FAILURE_CODE.LOCATION_OUT_OF_SCOPE);
  assert.match(outside?.message || "", /맡은 지점의 회원이 아니라/);
  assert.equal(passLocationFailure({ role: "manager", locationId: "yangsan", locationIds: ["yangsan", "jwadong"] }, "jwadong"), null);
});

test("저장 거절: 코드 → 종류 → 문구, 원본 코드와 참조 코드를 함께 단다", () => {
  const ref = "manager/gate-on/pt/linked/mixed/single";
  const rows = [
    // [원본 코드, 종류, 다시 시도 권하는가, 문구에 들어갈 말]
    ["permission-denied", PASS_ISSUE_FAILURE_KIND.PERMISSION, false, /발급 규칙이 이 발급을 받지 않았어요/],
    ["unauthenticated", PASS_ISSUE_FAILURE_KIND.AUTHENTICATION, false, /로그인이 풀렸어요/],
    ["unavailable", PASS_ISSUE_FAILURE_KIND.NETWORK, true, /연결이 불안정/],
    ["deadline-exceeded", PASS_ISSUE_FAILURE_KIND.NETWORK, true, /연결이 불안정/],
    ["resource-exhausted", PASS_ISSUE_FAILURE_KIND.SERVER_UNAVAILABLE, true, /서버가 잠시/],
    ["invalid-argument", PASS_ISSUE_FAILURE_KIND.INVALID_REQUEST, false, /입력한 값으로는/],
    ["flow_bypass_reason_short", PASS_ISSUE_FAILURE_KIND.INVALID_REQUEST, false, /입력한 값으로는/],
    ["something-new", PASS_ISSUE_FAILURE_KIND.UNKNOWN, false, /발급하지 못했어요/],
  ];
  for (const [code, kind, retry, words] of rows) {
    const failure = describePassIssueFailure({ code }, ref);
    assert.equal(failure.kind, kind, code);
    assert.equal(failure.retry, retry, code);
    assert.match(failure.message, words, code);
    assert.ok(failure.message.includes(`코드 ${code}`), `${code}: 원본 코드가 문구에 있다`);
  }
  // 권한 거절과 분류 실패는 어떤 발급이었는지를 붙인다 -- 캡처 한 장으로 갈래가 읽힌다.
  assert.ok(describePassIssueFailure({ code: "permission-denied" }, ref).message.includes(ref));
  assert.ok(describePassIssueFailure({ code: "something-new" }, ref).message.includes(ref));
  // 코드 없는 저장 경로 오류는 메시지가 코드가 된다 (Forbidden manualUnitPrice 등).
  const forbidden = describePassIssueFailure(new Error("Forbidden manualUnitPrice"), ref);
  assert.equal(forbidden.kind, PASS_ISSUE_FAILURE_KIND.INVALID_REQUEST);
  assert.ok(forbidden.message.includes("Forbidden manualUnitPrice"));
  // 아무것도 없으면 unknown 이라도 코드를 단다 (§4).
  assert.match(describePassIssueFailure(null, "").message, /코드 unknown/);
});
