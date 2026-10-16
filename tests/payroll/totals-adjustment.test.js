import assert from "node:assert/strict";
import test from "node:test";

import {
  TOTAL_ADJUST_REASON, adjustInstructorTotal, instructorTotalId,
} from "../../src/data/repositories/instructor-total-repository.js";
import { AUDIT_ACTION, AUDIT_FIELDS, totalAdjustmentEntry } from "../../src/data/repositories/audit-repository.js";

/**
 * 누적 보정.
 *
 * 이 숫자 하나가 그 회원의 남은 수업 단가를 전부 정한다 -- 20 을 넘기면
 * 카테고리 단가, 아니면 신규 단가다. 경계가 한 칸 어긋나면 그 회원권의 모든
 * 회차가 틀린 금액으로 원장에 박히고, 원장은 append-only 라 되돌릴 수 없다.
 *
 * 그래서 이 파일이 지키는 것은 셋이다.
 *
 * 하나. **기록 없이는 고칠 수 없다.** 누적과 감사 항목이 한 배치다.
 * 둘. **전·후·사유가 전부 있어야 한다.** 하나라도 빠지면 반년 뒤 그 줄은
 *     "왜 이렇게 됐나" 에 답하지 못하고, 그 질문이 곧 급여 분쟁이다.
 * 셋. **본 숫자가 아직 참일 때만 쓴다.** 목록을 뽑고 누르기까지 사이에 수업이
 *     확정되면 그 회차가 조용히 사라진다.
 */

const ORG = "bonita";
const TOTAL_PATH = "organizations/bonita/instructorClientTotals/u-me_c1";

function fakeStore({ sessions = 25 } = {}) {
  const commits = [];
  return {
    commits,
    read: async () => (sessions === null ? null : { sessions }),
    commit: async (writes) => { commits.push(writes); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const adjust = (store, overrides = {}) => adjustInstructorTotal(ORG, {
  instructorId: "u-me",
  clientId: "c1",
  sessions: 22,
  reason: TOTAL_ADJUST_REASON.SERVICE_SESSIONS_REMOVED,
  actorId: "owner-a",
  actorRole: "owner",
  ...overrides,
}, { store });

/* ── 기록과 함께 간다 ────────────────────────────────────────────────────── */

test("the count and its record are written in one batch", async () => {
  /* 둘 중 하나만 쓰이면 숫자는 바뀌었는데 왜 바뀌었는지가 없거나, 그 반대가
     된다. 다음 달 정산에서 그 차이를 설명할 사람이 없다. */
  const store = fakeStore();
  const { logId } = await adjust(store);

  assert.equal(store.commits.length, 1, "한 배치다");
  const [totals, audit] = store.commits[0];
  assert.equal(totals.path, TOTAL_PATH);
  assert.deepEqual(totals.data, { sessions: 22 });
  assert.equal(totals.operation, "update", "만들지 않고 고친다");
  /* 감사 로그는 센터 밑이 아니라 최상위 컬렉션이다. 규칙이 문서 안의
     organizationId 로 센터를 가린다 (match /auditLogs/{logId}). */
  assert.equal(audit.path, `auditLogs/${logId}`);
  assert.equal(audit.data.organizationId, ORG);
});

test("the record says what it was, what it became and why", async () => {
  const store = fakeStore({ sessions: 25 });
  await adjust(store);
  const [, audit] = store.commits[0];

  assert.equal(audit.data.action, AUDIT_ACTION.INSTRUCTOR_TOTAL_ADJUSTED);
  assert.equal(audit.data.previousAmount, 25);
  assert.equal(audit.data.amount, 22);
  assert.equal(audit.data.reason, TOTAL_ADJUST_REASON.SERVICE_SESSIONS_REMOVED);
  /* 누적은 강사–회원 쌍의 값이다. 한쪽만으로는 어느 문서인지 가리키지 못한다. */
  assert.equal(audit.data.targetId, "u-me");
  assert.equal(audit.data.clientId, "c1");
  assert.equal(audit.data.actorId, "owner-a");
});

test("a reason outside the list is refused, and nothing is written", async () => {
  /* 자유 문장을 받지 않는다 -- 열어 두면 언젠가 거기에 회원 이름이 들어간다
     (AUDIT_FIELDS 머리말). */
  const store = fakeStore();
  await assert.rejects(() => adjust(store, { reason: "그냥요" }), /Invalid reason/);
  await assert.rejects(() => adjust(store, { reason: "" }), /Missing reason/);
  assert.equal(store.commits.length, 0);
});

test("the audit vocabulary has no free-text column, reason included", () => {
  /* reason 이 열거값이라는 것이 이 설계의 요점이다. 목록에 문장 칸이 생기면
     그때부터 이 테스트는 거짓말이 된다. */
  assert.ok(AUDIT_FIELDS.includes("reason"));
  for (const value of Object.values(TOTAL_ADJUST_REASON)) {
    assert.match(value, /^[a-z_]+$/, value);
  }
});

/* ── 쓰지 않는 자리 ──────────────────────────────────────────────────────── */

test("an adjustment that changes nothing is refused", async () => {
  // 같은 값을 적은 줄이 쌓이면 목록이 길어지고, 그 목록의 값어치는 변화 하나다.
  const store = fakeStore({ sessions: 22 });
  await assert.rejects(() => adjust(store, { sessions: 22 }), /Invalid sessions/);
  assert.equal(store.commits.length, 0);
});

test("a negative count never reaches the server", async () => {
  /* 음수가 들어가면 규칙이 그 문서의 **모든 쓰기를 거부**하고, 그때부터 그
     회원의 차감이 통째로 막힌다 -- 화면에는 permission-denied 한 줄뿐이다. */
  const store = fakeStore();
  for (const bad of [-1, 1.5, "20", null]) {
    await assert.rejects(() => adjust(store, { sessions: bad }), /Invalid sessions/, String(bad));
  }
  assert.equal(store.commits.length, 0);
});

test("a pair with no totals document is not created", async () => {
  /* 문서가 없다는 것은 그 강사가 그 회원을 앱으로 가르친 적이 없다는 뜻이다.
     숫자를 심으면 있지도 않던 기록이 생긴다. */
  const store = fakeStore({ sessions: null });
  await assert.rejects(() => adjust(store), /Missing total/);
  assert.equal(store.commits.length, 0);
});

test("a count that moved since the list was drawn stops the write", async () => {
  /* 목록을 뽑고 누르기까지 사이에 그 회원의 수업이 확정될 수 있다. 그대로
     쓰면 그 회차가 조용히 사라진다 -- 원장에는 있는데 누적에는 없다. */
  const store = fakeStore({ sessions: 26 });
  await assert.rejects(
    () => adjust(store, { expectedSessions: 25 }),
    (error) => error.code === "stale_total",
  );
  assert.equal(store.commits.length, 0);

  // 같으면 그대로 쓴다.
  const fresh = fakeStore({ sessions: 25 });
  await adjust(fresh, { expectedSessions: 25 });
  assert.equal(fresh.commits.length, 1);
});

test("the document id is the pair, in the order the rules expect", () => {
  /* 규칙이 totalId == instructorId + "_" + clientId 를 따진다. 뒤집으면
     create 가 통째로 거부된다. */
  assert.equal(instructorTotalId("u-me", "c1"), "u-me_c1");
  assert.throws(() => instructorTotalId("", "c1"), /Missing instructorId/);
});

/* ── 감사 항목만 따로 ────────────────────────────────────────────────────── */

test("the entry refuses to be built without the three required values", () => {
  const base = {
    actorId: "owner-a", actorRole: "owner", instructorId: "u-me", clientId: "c1",
    previousSessions: 25, sessions: 22, reason: TOTAL_ADJUST_REASON.MANUAL_CORRECTION,
    stampedAt: "SERVER_TIME",
  };
  assert.ok(totalAdjustmentEntry(ORG, base));
  for (const missing of ["previousSessions", "sessions", "reason", "instructorId", "clientId"]) {
    const broken = { ...base };
    delete broken[missing];
    assert.throws(() => totalAdjustmentEntry(ORG, broken), missing);
  }
});
