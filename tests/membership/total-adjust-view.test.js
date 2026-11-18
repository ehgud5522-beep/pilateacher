/**
 * 급여 기준 누적 고치기 (2026-11-18 대표: "이미 20회 이상 수업함, 20회 미만 신규페이 안 되게").
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adjustInstructorTotal, readInstructorTotal } from "../../src/data/repositories/instructor-total-repository.js";
import {
  duetPartnersOf, totalAdjustFailure, totalAdjustInputError, totalAdjustInstructors, totalTierLabel,
} from "../../src/features/membership/total-adjust-view.js";

const passes = [
  { id: "old", status: "expired", instructorId: "t2", clientId: "c1" },
  { id: "now", status: "active", instructorId: "t1", clientId: "c1", clientIds: ["c1", "c2"] },
  { id: "gone", status: "cancelled", instructorId: "t9", clientId: "c1" },
];

test("강사 목록: 쓰는 중인 회원권 강사가 먼저, 취소된 회원권은 뺀다 · 듀엣 짝", () => {
  assert.deepEqual(totalAdjustInstructors(passes), ["t1", "t2"]);
  assert.deepEqual(duetPartnersOf(passes, "t1", "c1"), ["c2"]);
  assert.deepEqual(duetPartnersOf(passes, "t2", "c1"), []);
});

test("한 줄: 20회 경계 · 문서 없음", () => {
  assert.equal(totalTierLabel(12), "누적 12회 · 20회까지 신규 단가 (8회 남음)");
  assert.equal(totalTierLabel(19), "누적 19회 · 20회까지 신규 단가 (1회 남음)");
  assert.equal(totalTierLabel(20), "누적 20회 · 기준 단가");
  assert.equal(totalTierLabel(null), "앱으로 진행한 수업 없음");
});

test("입력 검사와 실패 문구는 코드를 함께", () => {
  assert.equal(totalAdjustInputError("", 3), "0 이상의 숫자로 적어 주세요");
  assert.equal(totalAdjustInputError("3", 3), "지금 값과 같아요");
  assert.equal(totalAdjustInputError("25", 3), "");
  assert.match(totalAdjustFailure({ code: "stale_total" }), /코드 stale_total/);
  assert.match(totalAdjustFailure({ code: "permission-denied" }), /대표·총괄매니저/);
  assert.match(totalAdjustFailure({ message: "Missing total" }), /코드 missing_total/);
  assert.match(totalAdjustFailure({}), /코드 unknown/);
});

test("읽고 고치기: 누적 문서와 감사 항목을 한 번에, 화면의 값이 낡았으면 쓰지 않는다", async () => {
  const docs = new Map([["organizations/o1/instructorClientTotals/t1_c1", { sessions: 7 }]]);
  const commits = [];
  const store = {
    read: async (path) => docs.get(path) || null,
    commit: async (writes) => { commits.push(writes); },
    serverTimestamp: async () => "NOW",
  };
  const found = await readInstructorTotal("o1", "t1", "c1", { store });
  assert.deepEqual(found, { sessions: 7 });
  assert.equal(await readInstructorTotal("o1", "t1", "zz", { store }), null);
  await adjustInstructorTotal("o1", { instructorId: "t1", clientId: "c1", sessions: 24, expectedSessions: 7, reason: "manual_correction", actorId: "u1", actorRole: "owner" }, { store });
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0][0].data, { sessions: 24 });
  assert.equal(commits[0][1].data.amount, 24);
  assert.equal(commits[0][1].data.previousAmount, 7);
  await assert.rejects(
    adjustInstructorTotal("o1", { instructorId: "t1", clientId: "c1", sessions: 24, expectedSessions: 5, reason: "manual_correction", actorId: "u1", actorRole: "owner" }, { store }),
    (error) => error.code === "stale_total",
  );
});

test("배선: 회원 상세(대표·총괄)에 급여 기준 누적 칸, 낡은 값 확인과 사유를 넘긴다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /\{canUndo \? \(\s*<InstructorTotalSection organizationId=\{organizationId\}/);
  const body = app.slice(app.indexOf("function InstructorTotalSection("), app.indexOf("\nfunction ClientDetail({"));
  assert.match(body, /expectedSessions: edit\.current, reason: edit\.reason/);
  assert.match(body, /deviceLog\("instructor_total_adjust_failed"/);
  // 실제 화면은 passStore 를 넘기지 않는다 -- 넘겨받은 것만 쓰면 칸이 사라진다 (2026-11-18 1차 배포).
  assert.match(body, /givenStore \|\| createFirestorePassStore\(\)/);
});
