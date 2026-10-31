import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIVATE_KIND, applyPrivateRevisions, mergePrivateItems, privateChanges, privateDocuments, privateWindow,
} from "../../src/features/schedule/private-items.js";
import { decidePrivateWrite } from "../../src/data/repositories/private-schedule-repository.js";
import { privateSyncAllowed } from "../../src/features/schedule/sync-gate.js";

/* 본인 전용 일정 · 메모 (2026-10-31, 동기화 3단계). */

const ROSTER = [
  { id: "m-1", name: "하나", orgClientId: "client-1", notes: [{ id: "n-1", type: "상담", date: "2026-11-01", body: "허리 통증", important: true }, { id: "n-ai", type: "개인레슨", body: "AI 기록" }], goal: "자세 교정", focus: ["허리"], goalWeight: 55, goalFat: 25 },
  { id: "client-2", name: "두리", orgClientId: "client-2", notes: [] },
  { id: "m-device", name: "기기", notes: [{ id: "n-dev", type: "상담", body: "센터에 없는 회원" }] },
];
const SCHEDULE = [
  { id: "p-1", personal: true, title: "상담", date: "2026-11-03", start: "10:00", end: "10:30", memo: "신규 상담" },
  { id: "g-1", type: "그룹", date: "2026-11-03", start: "11:00", end: "11:50", groupCount: 4, actualCount: 3, attendees: [], room: "1번룸" },
  { id: "L-1", type: "개인레슨", date: "2026-11-03", start: "19:00", end: "19:50", memo: "어깨 주의", attendees: [{ memberId: "m-1" }] },
  { id: "L-dev", type: "개인레슨", date: "2026-11-03", start: "20:00", memo: "기기 회원 수업", attendees: [{ memberId: "m-device" }] },
];

test("받는 기간은 30일 전 ~ 60일 뒤 (날짜가 있는 것)", () => {
  assert.deepEqual(privateWindow(new Date(2026, 10, 10, 9)), { from: "2026-10-11", to: "2027-01-09" });
});

test("서버에 둘 문서 — 개인 일정 · 그룹 수업 · 센터 수업 메모 · 상담 메모 · 목표만", () => {
  const docs = privateDocuments({ schedule: SCHEDULE, rosterMembers: ROSTER });
  assert.deepEqual([...docs.keys()].sort(), ["goal_client-1", "memo_L-1", "note_n-1", "sch_g-1", "sch_p-1"]);
  assert.equal(docs.get("sch_p-1").data.kind, PRIVATE_KIND.PERSONAL);
  assert.equal(docs.get("sch_g-1").data.groupCount, 4);
  assert.equal(docs.get("memo_L-1").data.memo, "어깨 주의");
  assert.equal(docs.get("note_n-1").data.clientId, "client-1", "회원은 센터 회원 id 로 잇는다");
  assert.deepEqual(docs.get("goal_client-1").data.focus, ["허리"]);
  const json = JSON.stringify([...docs.values()]);
  assert.doesNotMatch(json, /AI 기록/, "AI 수업기록은 싣지 않는다 (5단계)");
  assert.doesNotMatch(json, /센터에 없는 회원|기기 회원 수업/, "센터 명부에 없는 기기 회원의 것은 싣지 않는다");
  assert.doesNotMatch(json, /하나|두리/, "회원 이름은 싣지 않는다");
});

test("바뀐 것만 보내고, 지운 것은 지운 표시로 — 목표는 지우지 않는다", () => {
  const before = privateDocuments({ schedule: SCHEDULE, rosterMembers: ROSTER });
  const after = privateDocuments({
    schedule: [{ ...SCHEDULE[0], memo: "바뀐 메모" }, SCHEDULE[2]],
    rosterMembers: [{ ...ROSTER[0], notes: [], goal: "", focus: [], goalWeight: 0, goalFat: 0 }],
  });
  const changes = privateChanges({ before, after });
  const byId = Object.fromEntries(changes.map((change) => [change.itemId, change.deleted]));
  assert.deepEqual(byId, { "sch_p-1": false, "sch_g-1": true, "note_n-1": true });
  assert.equal("goal_client-1" in byId, false, "목표는 비워진 것도 지운 표시가 아니다 -- 바뀐 값이 있으면 그 값으로 간다");
});

test("받아서 합치기 — 일정은 더하고 · 고치고 · 지우고, 메모는 그 수업에, 상담 메모 · 목표는 회원에", () => {
  const docs = [
    { itemId: "sch_p-9", kind: "personal", title: "휴무", date: "2026-11-04", start: "09:00", end: "18:00", memo: "", revision: 1 },
    { itemId: "sch_g-1", kind: "group", date: "2026-11-03", start: "11:00", end: "11:50", groupCount: 6, actualCount: 0, noshowCount: 0, groupDone: false, groupCancelled: false, room: "2번룸", equipmentIds: [], memo: "", revision: 2 },
    { itemId: "sch_p-1", kind: "personal", title: "상담", date: "2026-11-03", start: "10:00", end: "10:30", memo: "", revision: 2, deletedAt: new Date() },
    { itemId: "memo_L-1", kind: "lessonMemo", lessonId: "L-1", date: "2026-11-03", memo: "다른 PC 메모", revision: 3 },
    { itemId: "note_n-2", kind: "consultNote", noteId: "n-2", clientId: "client-2", date: "2026-11-02", body: "첫 상담", important: false, revision: 1 },
    { itemId: "goal_client-1", kind: "memberGoal", clientId: "client-1", goal: "코어", focus: ["목"], goalWeight: 54, goalFat: 24, revision: 2 },
  ];
  const result = mergePrivateItems({
    schedule: SCHEDULE.map((entry) => (entry.id === "g-1" ? { ...entry, privateRevision: 1 } : entry.id === "p-1" ? { ...entry, privateRevision: 1 } : entry)),
    members: [{ id: "m-1", name: "하나", notes: [], goal: "자세 교정", goalRevision: 1 }],
    docs, rosterMembers: ROSTER,
  });
  assert.equal(result.schedule.find((entry) => entry.id === "p-9")?.title, "휴무", "다른 PC 의 휴무가 들어온다");
  assert.equal(result.schedule.find((entry) => entry.id === "g-1").groupCount, 6);
  assert.equal(result.schedule.some((entry) => entry.id === "p-1"), false, "다른 PC 가 지운 상담 일정");
  assert.equal(result.schedule.find((entry) => entry.id === "L-1").memo, "다른 PC 메모");
  const doori = result.members.find((member) => member.id === "client-2");
  assert.equal(doori?.notes[0].body, "첫 상담", "기기에 행이 없던 센터 회원에게도 붙는다");
  assert.equal(result.members.find((member) => member.id === "m-1").goal, "코어");
});

test("같은 번호 · 아직 못 보낸 것은 건드리지 않는다, 같은 날 · 시각의 개인 일정은 중복 의심", () => {
  const schedule = [{ id: "p-1", personal: true, title: "상담", date: "2026-11-03", start: "10:00", privateRevision: 2 }];
  const same = mergePrivateItems({ schedule, members: [], docs: [{ itemId: "sch_p-1", kind: "personal", title: "바뀜", revision: 2 }], rosterMembers: [] });
  assert.equal(same.changed, false);
  const pending = mergePrivateItems({ schedule, members: [], docs: [{ itemId: "sch_p-1", kind: "personal", title: "바뀜", revision: 5 }], rosterMembers: [], pendingIds: ["sch_p-1"] });
  assert.equal(pending.changed, false);
  const twin = mergePrivateItems({ schedule, members: [], docs: [{ itemId: "sch_p-2", kind: "personal", title: "상담", date: "2026-11-03", start: "10:00", revision: 1 }], rosterMembers: [] });
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

test("쓴 번호를 종류마다 제자리에 적는다", () => {
  const documents = [...privateDocuments({ schedule: SCHEDULE, rosterMembers: ROSTER }).values()];
  const results = documents.map((document) => ({ itemId: document.itemId, outcome: "written", revision: 7 }));
  const next = applyPrivateRevisions({ schedule: SCHEDULE, members: [{ id: "m-1", notes: ROSTER[0].notes }], results, documents, rosterMembers: ROSTER });
  assert.equal(next.schedule.find((entry) => entry.id === "p-1").privateRevision, 7);
  assert.equal(next.schedule.find((entry) => entry.id === "L-1").memoRevision, 7);
  assert.equal(next.members[0].notes[0].syncRevision, 7);
  assert.equal(next.members[0].goalRevision, 7);
});

test("스위치 — 웹 · 폰 모두 켜진 계정만", () => {
  assert.equal(privateSyncAllowed({ syncOn: false }), false);
  assert.equal(privateSyncAllowed({}), false, "못 읽었으면 꺼짐");
  assert.equal(privateSyncAllowed({ syncOn: true }), true);
});
