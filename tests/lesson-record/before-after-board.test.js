/**
 * 비포애프터 공유 현황 (2026-11-21). 담당 회원 · 앱 연결 · 보낸 적 없음 · 판정 → 문구 → 코드.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { beforeAfterBoard, shareInstructorView, shareMemberLabel } from "../../src/features/records/before-after-board.js";

const NOW = new Date(2026, 10, 21, 12, 0);
const pass = (clientId, extra = {}) => ({ clientId, status: "active", remainingCount: 5, ...extra });
const sent = (teacherId, clientId, sharedAt, extra = {}) => ({ teacherId, clientId, status: "active", sharedAt, read: false, ...extra });

const clients = [
  { id: "c1", name: "김민정", userId: "u1", instructorIds: ["a"] },
  { id: "c2", name: "성승현", userId: "u2", instructorIds: ["a"] },
  { id: "c3", name: "앱없음", userId: "", instructorIds: ["a"] },
  { id: "c4", name: "끝난회원", userId: "u4", instructorIds: ["a"] },
  { id: "c5", name: "보관", userId: "u5", instructorIds: ["a"], archived: true },
  { id: "c6", name: "옛계정담당", userId: "u6", instructorIds: ["a-old"] },
  { id: "c7", name: "다른강사", userId: "u7", instructorIds: ["b"] },
  { id: "demo", name: "심사", userId: "u8", instructorIds: ["b"] },
];
const passes = [pass("c1"), pass("c2"), pass("c3"), pass("c4", { remainingCount: 0 }), pass("c5"), pass("x", { clientIds: ["c6"] }), pass("c7"), pass("demo")];
const rows = [
  sent("a", "c1", "2026-11-03T02:00:00.000Z", { read: true }),
  sent("a", "c1", "2026-08-01T02:00:00.000Z", { status: "revoked" }),
  { teacherId: "a", clientId: "c2", status: "draft", sharedAt: null },
  sent("b", "c7", "2026-10-02T02:00:00.000Z"),
  sent("b", "demo", "2026-11-02T02:00:00.000Z"),
];

test("강사별: 앱 연결된 담당 회원 중 받은 회원, 이 달 보낸 장수, 만들고 안 보낸 카드", () => {
  const board = beforeAfterBoard({
    rows, clients, passes, month: "2026-11", now: NOW,
    instructors: [{ userId: "a", displayName: "김보현", status: "active" }, { userId: "b", displayName: "안혜원", status: "active" }],
    canonicalInstructorId: (id) => (id === "a-old" ? "a" : String(id || "")),
    excludedClientIds: new Set(["demo"]),
  });
  const a = board.find((row) => row.instructorId === "a");
  const b = board.find((row) => row.instructorId === "b");
  assert.equal(a.assigned, 4, "c1 · c2 · c3 · c6 (끝난 회원권 · 보관 제외, 옛 계정 담당 합침)");
  assert.equal(a.linked, 3);
  assert.equal(a.notLinked, 1);
  assert.equal(a.everSent, 1);
  assert.equal(a.neverSent, 2);
  assert.equal(a.sentThisMonth, 1);
  assert.equal(a.readThisMonth, 1);
  assert.equal(a.unsent, 1);
  assert.equal(a.members.find((item) => item.clientId === "c1").sent, 2, "보낸 뒤 거둔 카드도 보낸 것");
  assert.deepEqual(a.members.map((item) => item.clientId).slice(0, 2).sort(), ["c2", "c6"], "보낸 적 없는 회원이 위");
  assert.equal(b.sentThisMonth, 0, "심사용 회원 제외");
  assert.equal(b.everSent, 1);
  assert.deepEqual(board.map((row) => row.instructorId), ["a", "b"], "받은 비율 낮은 강사가 위");
});

test("회원 · 강사 문구에 코드가 함께", () => {
  assert.equal(shareMemberLabel({ linked: false, sent: 0, unsent: 0 }, NOW).code, "member_not_linked");
  assert.equal(shareMemberLabel({ linked: true, sent: 0, unsent: 0 }, NOW).label, "보낸 적 없음");
  assert.equal(shareMemberLabel({ linked: true, sent: 0, unsent: 1 }, NOW).code, "card_not_sent");
  const recent = shareMemberLabel({ linked: true, sent: 2, read: 1, lastSentAt: "2026-11-03T02:00:00.000Z" }, NOW);
  assert.equal(recent.code, "sent_recently");
  assert.match(recent.label, /11\/3 보냄 \(18일 전\) · 총 2장 · 회원 열람 1\/2/);
  assert.equal(shareMemberLabel({ linked: true, sent: 1, read: 0, lastSentAt: "2026-08-01T02:00:00.000Z" }, NOW).code, "sent_long_ago");
  assert.equal(shareInstructorView({ linked: 0 }).code, "no_linked_members");
  assert.equal(shareInstructorView({ linked: 10, everSent: 8 }).code, "share_good");
  assert.equal(shareInstructorView({ linked: 10, everSent: 1 }).label, "10% 받음");
});

test("배선: 기록 현황 화면에 비포애프터 칸, 대표용 함수로만 읽는다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /<BeforeAfterShareBoard organization=\{organization\}/);
  assert.match(app, /onLoad = fbBeforeAfterShareStats/);
});
