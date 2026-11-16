"use strict";

/* 설계 문서 5단계 · 상담 소재 초안. 효과 보장 · 돈 이야기 · 근거 없는 줄은 버리고, 최대 3줄. 누를 때만, 담당 · 동의 · 스위치. */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createConsultPointsService } = require("../src/consult-points");

const load = () => import("../shared/consult-points.mjs");
const record = (id, date, fields) => ({ id, clientId: "c1", lessonDate: date, body: "본문", createdBy: "t1", createdAt: { seconds: Date.parse(date) / 1000 }, fields });
const RECORDS = [
  record("r2", "2026-11-10", { observations: [{ text: "왼쪽 골반 높이 차이가 줄어 보임", origin: "ai" }], responses: [{ text: "계단 오를 때 무릎이 편하다고 함", origin: "ai" }] }),
  record("r1", "2026-11-03", { observations: [{ text: "리포머 풋워크 자세 안정", origin: "ai" }], responses: [] }),
];
const src = (id, date) => [{ recordId: id, date }];

test("효과 보장 · 돈 이야기 · 진단 · 근거 없는 줄은 버리고 최대 3줄", async () => {
  const { checkConsultPoints } = await load();
  const { talkingPoints, dropped } = checkConsultPoints({ talkingPoints: [
    { text: "계단 오를 때 무릎이 편하다고 하심", sources: src("r2", "2026-11-10") },
    { text: "10회면 골반이 확실히 좋아집니다", sources: src("r2", "2026-11-10") },
    { text: "재등록하면 할인이 됩니다", sources: src("r2", "2026-11-10") },
    { text: "골반 틀어짐 때문에 무릎이 아팠음", sources: src("r2", "2026-11-10") },
    { text: "근거 없는 이야기", sources: [] },
    { text: "리포머 풋워크 자세가 안정됨", sources: src("r1", "2026-11-03") },
    { text: "왼쪽 골반 높이 차이가 줄어 보임", sources: src("r2", "2026-11-10") },
    { text: "네 번째 줄", sources: src("r1", "2026-11-03") },
  ] }, RECORDS);
  assert.equal(talkingPoints.length, 3);
  assert.deepEqual(dropped, { forbidden_word: 3, no_source: 1 });
});

test("보내는 입력: 변화 칸 · 목표 · 비포애프터 여부만, 이름 · 연락처 없음", async () => {
  const { buildConsultInput } = await load();
  const { redactText } = require("../src/privacy");
  const { input } = buildConsultInput({ goal: "김하늘 회원 010-1234-5678 허리 편하게", records: RECORDS, hasBeforeAfter: true, redact: (value) => redactText(value, "김하늘") });
  const json = JSON.stringify(input);
  assert.doesNotMatch(json, /김하늘|010-1234|t1|clientId|createdBy/);
  assert.equal(input.hasBeforeAfter, true);
  assert.deepEqual(input.records[0].changes, ["왼쪽 골반 높이 차이가 줄어 보임", "계단 오를 때 무릎이 편하다고 함"]);
});

function fake(seed) {
  const docs = new Map(Object.entries(seed));
  const snap = (path) => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path) });
  return {
    doc: (path) => ({ get: async () => snap(path) }),
    collection: (path) => ({
      doc: (id) => ({ get: async () => snap(`${path}/${id}`) }),
      where: (field, _op, value) => ({ get: async () => ({ docs: [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1).map(snap).filter((row) => row.data()[field] === value) }) }),
    }),
  };
}
const consent = async () => ({ status: "granted", version: (await import("../shared/member-summary.mjs")).MEMBER_AI_CONSENT_VERSION });
const seed = async (extra = {}) => ({
  "memberships/o1_t1": { role: "instructor", status: "active" },
  "memberships/o1_t2": { role: "instructor", status: "active" },
  "runtimeConfig/scheduleSync": { consultPoints: { mode: "all" } },
  "organizations/o1/clients/c1": { name: "김하늘", instructorIds: ["t1"], aiConsent: await consent() },
  ...Object.fromEntries(RECORDS.map((row) => [`organizations/o1/lessonRecords/${row.id}`, row])),
  ...extra,
});
const deps = (store, calls = []) => ({
  firestore: store,
  membershipId: (org, uid) => `${org}_${uid}`,
  isOwnerLevel: (membership) => membership?.role === "owner",
  getProvider: () => ({ executeInternal: async (request) => { calls.push(request); return { output: { talkingPoints: [{ text: "계단 오를 때 무릎이 편하다고 하심", sources: src("r2", "2026-11-10") }] }, usage: {} }; } }),
});

test("담당 강사 · 동의 · 스위치가 맞으면 만든다, 이름은 지워서 보낸다", async () => {
  const calls = [];
  const service = createConsultPointsService(deps(fake(await seed()), calls));
  const result = await service.generate({ callerUid: "t1", organizationId: "o1", clientId: "c1", goal: "김하늘 회원 허리" });
  assert.equal(result.talkingPoints.length, 1);
  assert.doesNotMatch(JSON.stringify(calls[0].input), /김하늘/);
});

test("담당 아님 · 동의 없음 · 스위치 꺼짐은 부르지 않고 이유를 돌려준다", async () => {
  const calls = [];
  const reasonOf = async (store, uid = "t1") => {
    try { await createConsultPointsService(deps(store, calls)).generate({ callerUid: uid, organizationId: "o1", clientId: "c1" }); return "ok"; }
    catch (error) { return error.reason; }
  };
  assert.equal(await reasonOf(fake(await seed()), "t2"), "not_assigned");
  assert.equal(await reasonOf(fake(await seed({ "organizations/o1/clients/c1": { instructorIds: ["t1"] } }))), "consent_missing");
  assert.equal(await reasonOf(fake(await seed({ "runtimeConfig/scheduleSync": {} }))), "feature_off");
  assert.equal(calls.length, 0);
});
