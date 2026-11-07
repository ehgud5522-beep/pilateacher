import assert from "node:assert/strict";
import test from "node:test";
import {
  INBOX_COPY, inboxFailure, inboxRow, inboxStripLabel, lessonForInboxItem, receivedLabel, unreadCount,
} from "../../src/features/notifications/teacher-inbox.js";

/* 강사 알림함 (2026-11-07) — 화면 판정. 회원 이름은 알림 문서에 없고 강사 명단에서 찾는다. */

const NOW = new Date("2026-11-07T12:00:00+09:00").getTime();
const item = (overrides = {}) => ({
  id: "rec-1", kind: "member_cancel", lessonId: "L1", clientId: "client-a",
  title: "[회원 수업 취소]", body: "11/8(일) 10:00 수업이 회원 요청으로 취소되었어요",
  createdAt: { toMillis: () => NOW - 5 * 60000 }, ...overrides,
});

test("읽지 않은 것만 띠에 센다 — 다 읽었으면 띠가 없다", () => {
  const items = [item(), item({ id: "rec-2", readAt: { toMillis: () => NOW } }), item({ id: "rec-3" })];
  assert.equal(unreadCount(items), 2);
  assert.equal(inboxStripLabel(items), "새 알림 2건");
  assert.equal(inboxStripLabel([item({ readAt: { toMillis: () => NOW } })]), "");
  assert.equal(inboxStripLabel(null), "");
});

test("한 줄: 이름은 강사 명단에서, 없으면 이름 없이", () => {
  const row = inboxRow(item(), [{ id: "client-a", name: "김하나" }], NOW);
  assert.equal(row.who, "김하나 회원");
  assert.equal(row.unread, true);
  assert.equal(row.received, "5분 전");
  assert.equal(row.body, "11/8(일) 10:00 수업이 회원 요청으로 취소되었어요");
  assert.equal(inboxRow(item(), [], NOW).who, "", "명단에 없으면 이름 없음");
  /* 옛 기기 회원과 이어진 사람은 기기 id 가 다르다 -- 센터 회원 id(orgClientId)로 찾는다. */
  assert.equal(inboxRow(item(), [{ id: "m-local-7", orgClientId: "client-a", name: "박둘" }], NOW).who, "박둘 회원");
});

test("받은 시각 표시", () => {
  assert.equal(receivedLabel({ toMillis: () => NOW - 20000 }, NOW), "방금");
  assert.equal(receivedLabel({ seconds: (NOW - 3 * 3600000) / 1000 }, NOW), "3시간 전");
  assert.equal(receivedLabel(null, NOW), "");
});

test("누르면 열 수업: 기기 일정의 같은 id, 없으면 null (화면이 '아직 일정에 없어요')", () => {
  const schedule = [{ id: "L0" }, { id: "L1", date: "2026-11-08" }];
  assert.equal(lessonForInboxItem(item(), schedule)?.date, "2026-11-08");
  assert.equal(lessonForInboxItem(item({ lessonId: "L9" }), schedule), null);
  assert.match(INBOX_COPY.NOT_SYNCED, /일정/);
});

test("못 열면 종류별 문구 + 코드 — 규칙 미배포(permission-denied)도 코드와 함께", () => {
  const rows = [
    [{ code: "permission-denied" }, "permission", /아직 열 수 없어요 \(코드 permission-denied\)/],
    [{ code: "unavailable" }, "network", /연결.*코드 unavailable/],
    [{ code: "failed-precondition" }, "unknown", /코드 failed-precondition/],
    [new Error("x"), "unknown", /코드 unknown/],
  ];
  for (const [error, kind, pattern] of rows) {
    const view = inboxFailure(error);
    assert.equal(view.kind, kind);
    assert.match(view.message, pattern);
  }
});
