import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_KIND, applyPrivateRevisions, mergePrivateItems, privateChanges, privateDocuments, privateWindow,
} from "../../src/features/schedule/private-items.js";
import { decidePrivateWrite } from "../../src/data/repositories/private-schedule-repository.js";
import { privateSyncAllowed } from "../../src/features/schedule/sync-gate.js";

/* 본인 전용 일정 (2026-10-31, 동기화 3단계). 서버에는 개인 일정(이름 · 날짜 · 시각)과 그룹
   수업만 -- 메모 · 수업 메모 · 상담 메모 · 회원 목표는 기기에만. */

const SCHEDULE = [
  { id: "p-1", personal: true, title: "상담", date: "2026-11-03", start: "10:00", end: "10:30", memo: "신규 상담 -- 허리 통증" },
  { id: "g-1", type: "그룹", date: "2026-11-03", start: "11:00", end: "11:50", groupCount: 4, actualCount: 3, attendees: [], room: "1번룸", memo: "코어 집중" },
  { id: "L-1", type: "개인레슨", date: "2026-11-03", start: "19:00", end: "19:50", memo: "어깨 주의", attendees: [{ memberId: "m-1" }] },
];

test("받는 기간은 30일 전 ~ 60일 뒤", () => {
  assert.deepEqual(privateWindow(new Date(2026, 10, 10, 9)), { from: "2026-10-11", to: "2027-01-09" });
});

test("보내는 문서 — 개인 일정 · 그룹 수업 두 종류뿐, 메모 칸은 없다", () => {
  const docs = privateDocuments({ schedule: SCHEDULE });
  assert.deepEqual([...docs.keys()].sort(), ["sch_g-1", "sch_p-1"], "센터 수업의 수업 메모는 싣지 않는다");
  assert.deepEqual(Object.values(PRIVATE_KIND).sort(), ["group", "personal"]);
  assert.deepEqual(Object.keys(docs.get("sch_p-1").data).sort(), ["date", "end", "itemId", "kind", "start", "title"], "개인 일정은 이름 · 날짜 · 시각만");
  assert.equal(docs.get("sch_g-1").data.groupCount, 4);
  const json = JSON.stringify([...docs.values()]);
  for (const field of ["memo", "body", "goal", "focus", "goalWeight", "goalFat", "clientId", "noteId", "lessonId"]) {
    assert.doesNotMatch(json, new RegExp(`"${field}"`), `${field} 칸은 싣지 않는다`);
  }
  assert.doesNotMatch(json, /허리 통증|코어 집중|어깨 주의/, "메모 내용은 싣지 않는다");
});

test("바뀐 것만 보내고, 지운 것은 지운 표시로 — 메모만 바꾸면 보낼 것이 없다", () => {
  const before = privateDocuments({ schedule: SCHEDULE });
  const memoOnly = privateDocuments({ schedule: SCHEDULE.map((entry) => ({ ...entry, memo: "바뀐 메모" })) });
  assert.deepEqual(privateChanges({ before, after: memoOnly }), []);
  const after = privateDocuments({ schedule: [{ ...SCHEDULE[0], start: "10:30" }, SCHEDULE[2]] });
  const byId = Object.fromEntries(privateChanges({ before, after }).map((change) => [change.itemId, change.deleted]));
  assert.deepEqual(byId, { "sch_p-1": false, "sch_g-1": true });
});

test("받아서 합치기 — 일정은 더하고 · 고치고 · 지우고, 기기의 메모는 그대로", () => {
  const docs = [
    { itemId: "sch_p-9", kind: "personal", title: "휴무", date: "2026-11-04", start: "09:00", end: "18:00", revision: 1 },
    { itemId: "sch_g-1", kind: "group", date: "2026-11-03", start: "11:00", end: "11:50", groupCount: 6, actualCount: 0, noshowCount: 0, groupDone: false, groupCancelled: false, room: "2번룸", equipmentIds: [], revision: 2 },
    { itemId: "sch_p-1", kind: "personal", title: "상담", date: "2026-11-03", start: "10:00", end: "10:30", revision: 2, deletedAt: new Date() },
  ];
  const result = mergePrivateItems({
    schedule: SCHEDULE.map((entry) => (entry.id === "g-1" || entry.id === "p-1" ? { ...entry, privateRevision: 1 } : entry)),
    docs,
  });
  assert.equal(result.schedule.find((entry) => entry.id === "p-9")?.title, "휴무", "다른 PC 의 휴무가 들어온다");
  assert.equal(result.schedule.find((entry) => entry.id === "p-9")?.memo, "");
  const group = result.schedule.find((entry) => entry.id === "g-1");
  assert.equal(group.groupCount, 6);
  assert.equal(group.memo, "코어 집중", "기기의 그룹 수업 메모는 그대로");
  assert.equal(result.schedule.some((entry) => entry.id === "p-1"), false, "다른 PC 가 지운 상담 일정");
  assert.equal(result.schedule.find((entry) => entry.id === "L-1").memo, "어깨 주의");
});

test("제외한 종류가 서버에 있어도 받지 않는다 — 기기 값은 그대로", () => {
  const schedule = [{ ...SCHEDULE[2], memoRevision: 1 }];
  const docs = [
    { itemId: "memo_L-1", kind: "lessonMemo", lessonId: "L-1", date: "2026-11-03", memo: "덮을 메모", revision: 3 },
    { itemId: "note_n-1", kind: "consultNote", noteId: "n-1", clientId: "client-1", body: "덮을 상담", revision: 2 },
    { itemId: "goal_client-1", kind: "memberGoal", clientId: "client-1", goal: "덮을 목표", focus: ["목"], revision: 2 },
  ];
  const result = mergePrivateItems({ schedule, docs });
  assert.equal(result.changed, false);
  assert.equal(result.schedule, schedule);
  assert.equal(result.schedule[0].memo, "어깨 주의");
  assert.equal("members" in result, false, "회원(상담 메모 · 목표)은 손대지 않는다");
});

test("같은 번호 · 아직 못 보낸 것은 건드리지 않는다, 같은 날 · 시각의 개인 일정은 중복 의심", () => {
  const schedule = [{ id: "p-1", personal: true, title: "상담", date: "2026-11-03", start: "10:00", privateRevision: 2 }];
  const same = mergePrivateItems({ schedule, docs: [{ itemId: "sch_p-1", kind: "personal", title: "바뀜", revision: 2 }] });
  assert.equal(same.changed, false);
  const pending = mergePrivateItems({ schedule, docs: [{ itemId: "sch_p-1", kind: "personal", title: "바뀜", revision: 5 }], pendingIds: ["sch_p-1"] });
  assert.equal(pending.changed, false);
  const twin = mergePrivateItems({ schedule, docs: [{ itemId: "sch_p-2", kind: "personal", title: "상담", date: "2026-11-03", start: "10:00", revision: 1 }] });
  assert.deepEqual(twin.duplicates, [{ serverId: "p-2", localId: "p-1" }]);
  assert.equal(twin.schedule.length, 2, "지우지 않는다");
});

test("쓰기 판정 — 같은 판정을 1 · 2단계와 나눈다", () => {
  const document = { data: { itemId: "sch_p-1", kind: "personal", title: "상담" }, baseRevision: 1 };
  assert.equal(decidePrivateWrite(null, document).write.revision, 1);
  assert.equal(decidePrivateWrite({ ...document.data, revision: 1 }, document).outcome, "unchanged");
  assert.equal(decidePrivateWrite({ itemId: "sch_p-1", kind: "personal", title: "휴무", revision: 2, updatedDevice: "pc-a" }, document, { deviceId: "pc-b" }).outcome, "conflict");
  assert.equal(decidePrivateWrite({ itemId: "sch_p-1", kind: "personal", title: "휴무", revision: 2, deletedAt: new Date(), updatedDevice: "pc-a" }, { ...document, baseRevision: 2 }, { deviceId: "pc-b" }).outcome, "cancelled_elsewhere");
  assert.equal(decidePrivateWrite(null, { ...document, deleted: true }).outcome, "unchanged", "없는 것을 지울 것은 없다");
});

test("쓴 번호를 일정에 적는다", () => {
  const results = [...privateDocuments({ schedule: SCHEDULE }).keys()].map((itemId) => ({ itemId, outcome: "written", revision: 7 }));
  const next = applyPrivateRevisions({ schedule: SCHEDULE, results });
  assert.equal(next.schedule.find((entry) => entry.id === "p-1").privateRevision, 7);
  assert.equal(next.schedule.find((entry) => entry.id === "g-1").privateRevision, 7);
  assert.equal(next.schedule.find((entry) => entry.id === "L-1").privateRevision, undefined);
});

test("스위치 — 웹 · 폰 모두 켜진 계정만", () => {
  assert.equal(privateSyncAllowed({ syncOn: false }), false);
  assert.equal(privateSyncAllowed({}), false, "못 읽었으면 꺼짐");
  assert.equal(privateSyncAllowed({ syncOn: true }), true);
});
