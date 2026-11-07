import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMBER_CANCEL_ACK_KEY, ackKey, acksFromInbox, freesSlot, hasMemberCancel, isWholeMemberCancel, pendingMemberCancels,
  readMemberCancelAcks, revivesMemberCancel, writeMemberCancelAck,
} from "../../src/features/schedule/member-cancel-view.js";

/* 회원 앱에서 취소한 수업을 일정에서 어떻게 다루는가 (2026-11-07 대표 결정): 지우지 않고 남긴다,
   [확인] 하면 "회원 취소 N건" 에서 빠진다, 빈 시간은 막지 않는다, 강사가 다시 넣으면 되살린다. */

const memberCancelled = (memberId) => ({ memberId, status: "cancel", memberCancelledAt: "2026-11-07T01:00:00.000Z" });
const solo = (overrides = {}) => ({ id: "L1", date: "2026-11-09", start: "10:00", attendees: [memberCancelled("m1")], ...overrides });
const duet = (overrides = {}) => ({ id: "L2", date: "2026-11-08", start: "19:00", attendees: [{ memberId: "m2", status: "booked" }, memberCancelled("m3")], ...overrides });
const NOW = new Date(2026, 10, 7, 12, 0);

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)) };
}

test("회원 취소 판정: 개인은 수업 전체가 비고, 듀엣은 한 명만 빠진다", () => {
  assert.equal(hasMemberCancel(solo()), true);
  assert.equal(isWholeMemberCancel(solo()), true);
  assert.equal(hasMemberCancel(duet()), true);
  assert.equal(isWholeMemberCancel(duet()), false);
  assert.equal(hasMemberCancel({ attendees: [{ memberId: "m1", status: "cancel" }] }), false, "강사 취소는 회원 취소가 아니다");
});

test("빈 시간: 출석이 전부 취소면 그 시간을 막지 않는다 — 듀엣 · 상담(출석 없음)은 막는다", () => {
  assert.equal(freesSlot(solo()), true);
  assert.equal(freesSlot({ attendees: [{ memberId: "m1", status: "cancel" }] }), true, "강사 취소도 빈 시간");
  assert.equal(freesSlot(duet()), false);
  assert.equal(freesSlot({ attendees: [] }), false);
  assert.equal(freesSlot({ groupCancelled: true, attendees: [] }), true);
});

test("'회원 취소 N건': 오늘부터, 확인하지 않은 것만, 가까운 수업 먼저", () => {
  const schedule = [solo(), duet(), solo({ id: "old", date: "2026-11-01" })];
  const all = pendingMemberCancels(schedule, { now: NOW });
  assert.deepEqual(all.map((row) => row.entry.id), ["L2", "L1"], "지난 수업은 세지 않는다");
  const acked = pendingMemberCancels(schedule, { now: NOW, acks: new Set([ackKey("L2", "m3")]) });
  assert.deepEqual(acked.map((row) => row.entry.id), ["L1"]);
});

test("확인은 이 기기에 남는다 — 못 읽으면 빈 목록, 쌓여도 300개까지", () => {
  const storage = memoryStorage();
  assert.equal(readMemberCancelAcks(storage).size, 0);
  writeMemberCancelAck(storage, ackKey("L1", "m1"));
  assert.equal(readMemberCancelAcks(storage).has("L1|m1"), true);
  for (let index = 0; index < 320; index += 1) writeMemberCancelAck(storage, ackKey(`L${index}`, "m"));
  assert.equal(readMemberCancelAcks(storage).size, 300);
  storage.setItem(MEMBER_CANCEL_ACK_KEY, "{broken");
  assert.equal(readMemberCancelAcks(storage).size, 0, "깨진 값은 확인 안 한 것으로");
  assert.equal(readMemberCancelAcks(null).size, 0);
});

test("알림함에서 읽은 것도 확인 — 센터 회원 id(orgClientId)로 기기 회원과 잇는다", () => {
  const members = [{ id: "m1", orgClientId: "client-a" }, { id: "client-b", orgClientId: "client-b" }];
  const keys = acksFromInbox([
    { lessonId: "L1", clientId: "client-a", readAt: { seconds: 1 } },
    { lessonId: "L2", clientId: "client-b" },
    { lessonId: "L3", clientId: "client-x", readAt: { seconds: 1 } },
  ], members);
  assert.deepEqual([...keys], ["L1|m1"], "안 읽은 것 · 명단에 없는 회원은 빼고");
});

test("강사가 회원을 다시 넣으면 되살림 — 그 취소를 받은 기기에서 바꾼 것만", () => {
  const before = solo();
  const after = solo({ attendees: [{ ...memberCancelled("m1"), status: "booked" }] });
  assert.equal(revivesMemberCancel(before, after), true);
  assert.equal(revivesMemberCancel(before, before), false, "그대로면 아니다");
  assert.equal(revivesMemberCancel(solo({ attendees: [{ memberId: "m1", status: "booked" }] }), after), false,
    "취소를 받지 못한 기기(옛 탭)는 되살림이 아니다");
  assert.equal(revivesMemberCancel(null, after), false);
});
