"use strict";

/* 설계 문서 2단계 · AI 회원 요약. 검사 규칙(근거 · 금지 말 · 좌우 · 용어)과 저장 흐름(실패해도 앞 요약 유지). */
const assert = require("node:assert/strict");
const test = require("node:test");
const { createMemberSummaryService } = require("../src/member-summary");

const shared = () => import("../shared/member-summary.mjs");

const record = (id, date, body, fields = null, extra = {}) => ({
  id, clientId: "c1", lessonDate: date, body, createdBy: "t1", createdAt: { seconds: Date.parse(date) / 1000 },
  ...(fields ? { fields } : {}), ...extra,
});
const RECORDS = [
  record("r3", "2026-11-14", "리포머 풋워크, 왼쪽 무릎 불편 없음", { didToday: [{ text: "리포머 풋워크", origin: "ai" }], observations: [{ text: "왼쪽 무릎 불편 없음", origin: "ai" }] }),
  record("r2", "2026-11-10", "캐딜락 롤다운. 오른쪽 어깨 뻐근하다고 함"),
  record("r1", "2026-11-07", "매트 헌드레드. 호흡 연습 다음에도 확인"),
];
const item = (text, sources) => ({ text, sources });

test("근거가 맞는 문장만 남고, 버린 것은 이유 코드만 센다", async () => {
  const { checkSummary, DROP_REASON, droppedCounts } = await shared();
  const { summary, dropped } = checkSummary({
    mustRemember: [
      item("오른쪽 어깨 뻐근함을 말한 적 있음", [{ recordId: "r2", date: "2026-11-10" }]),
      item("근거 없는 문장", []),
      item("없는 기록", [{ recordId: "r9", date: "2026-11-10" }]),
      item("날짜가 다른 근거", [{ recordId: "r2", date: "2026-11-11" }]),
    ],
    recentTrend: [item("리포머 풋워크를 이어 감", [{ recordId: "r3", date: "2026-11-14" }])],
    openQuestions: [item("호흡 연습 확인", [{ recordId: "r1", date: "2026-11-07" }]), item("  ", [{ recordId: "r1", date: "2026-11-07" }])],
  }, RECORDS);
  assert.equal(summary.mustRemember.length, 1);
  assert.equal(summary.recentTrend.length, 1);
  assert.equal(summary.openQuestions.length, 1);
  assert.deepEqual(droppedCounts(dropped), {
    [DROP_REASON.NO_SOURCE]: 1, [DROP_REASON.UNKNOWN_SOURCE]: 1, [DROP_REASON.DATE_MISMATCH]: 1, [DROP_REASON.EMPTY]: 1,
  });
});

test("진단 · 원인 · 처방 말이 있으면 버린다", async () => {
  const { checkSummary, DROP_REASON } = await shared();
  const source = [{ recordId: "r2", date: "2026-11-10" }];
  for (const sentence of ["어깨 염증이 의심됨", "자세 때문에 어깨가 뻐근함", "어깨 스트레칭을 해야 한다", "디스크 가능성", "어깨 치료 필요"]) {
    const { summary, dropped } = checkSummary({ mustRemember: [item(sentence, source)], recentTrend: [], openQuestions: [] }, RECORDS);
    assert.equal(summary.mustRemember.length, 0, sentence);
    assert.equal(dropped[0].reason, DROP_REASON.FORBIDDEN_WORD, sentence);
  }
});

test("좌우가 근거와 다르면 버린다 -- 왼쪽을 오른쪽으로 바꾼 문장", async () => {
  const { checkSummary, DROP_REASON } = await shared();
  const { summary, dropped } = checkSummary({
    mustRemember: [
      item("왼쪽 어깨 뻐근함", [{ recordId: "r2", date: "2026-11-10" }]),
      item("오른쪽 무릎 불편 없음", [{ recordId: "r3", date: "2026-11-14" }]),
      item("왼쪽 무릎 불편 없음", [{ recordId: "r3", date: "2026-11-14" }]),
    ],
    recentTrend: [], openQuestions: [],
  }, RECORDS);
  assert.deepEqual(summary.mustRemember.map((entry) => entry.text), ["왼쪽 무릎 불편 없음"]);
  assert.deepEqual(dropped.map((entry) => entry.reason), [DROP_REASON.SIDE_MISMATCH, DROP_REASON.SIDE_MISMATCH]);
});

test("근거에 없는 기구 이름은 버린다 -- 캐딜락을 리포머로 바꾼 문장", async () => {
  const { checkSummary, DROP_REASON } = await shared();
  const { summary, dropped } = checkSummary({
    mustRemember: [],
    recentTrend: [item("리포머 롤다운", [{ recordId: "r2", date: "2026-11-10" }]), item("캐딜락 롤다운", [{ recordId: "r2", date: "2026-11-10" }])],
    openQuestions: [],
  }, RECORDS);
  assert.deepEqual(summary.recentTrend.map((entry) => entry.text), ["캐딜락 롤다운"]);
  assert.equal(dropped[0].reason, DROP_REASON.TERM_NOT_IN_SOURCE);
});

test("네 칸 기록은 칸의 글도 근거로 본다, 빈 덩어리는 빈 배열", async () => {
  const { checkSummary } = await shared();
  const { summary } = checkSummary({ mustRemember: [], recentTrend: [item("리포머 풋워크", [{ recordId: "r3", date: "2026-11-14" }])], openQuestions: [] }, [
    record("r3", "2026-11-14", "요약 본문", { didToday: [{ text: "리포머 풋워크", origin: "ai" }] }),
  ]);
  assert.equal(summary.recentTrend.length, 1);
  assert.deepEqual(summary.mustRemember, []);
});

test("보내는 입력에 이름 · 연락처 · 강사가 없다", async () => {
  const { buildSummaryInput, recentRecords } = await shared();
  const { redactText } = require("../src/privacy");
  const rows = recentRecords([
    record("a", "2026-11-01", "김하늘 회원 010-1234-5678 리포머"),
    record("b", "2026-11-02", "옛 본문"),
    record("c", "2026-11-03", "고친 본문", null, { supersedes: "b" }),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ["c", "a"], "고쳐서 밀려난 옛 줄은 빠진다");
  const input = buildSummaryInput({ records: rows, redact: (value) => redactText(value, "김하늘") });
  const json = JSON.stringify(input);
  assert.doesNotMatch(json, /김하늘|010-1234|t1|createdBy|clientId/);
  assert.equal(input.subject, "이 회원");
});

test("스위치 · 회원 동의", async () => {
  const { memberSummaryEnabledFor, memberAiConsentGranted, MEMBER_AI_CONSENT_VERSION } = await shared();
  assert.equal(memberSummaryEnabledFor({}, "t1"), false);
  assert.equal(memberSummaryEnabledFor({ memberSummary: { mode: "listed", userIds: ["t1"] } }, "t1"), true);
  assert.equal(memberSummaryEnabledFor({ memberSummary: { mode: "listed", userIds: ["t2"] } }, "t1"), false);
  assert.equal(memberSummaryEnabledFor({ memberSummary: { mode: "all" } }, ""), true);
  assert.equal(memberAiConsentGranted({}), false);
  assert.equal(memberAiConsentGranted({ aiConsent: { status: "granted", version: MEMBER_AI_CONSENT_VERSION } }), true);
  assert.equal(memberAiConsentGranted({ aiConsent: { status: "granted", version: "old" } }), false);
  assert.equal(memberAiConsentGranted({ aiConsent: { status: "granted", version: MEMBER_AI_CONSENT_VERSION, revokedAt: "x" } }), false);
});

/* ── 저장 흐름 ── */
function fakeStore(seed) {
  const docs = new Map(Object.entries(seed));
  const snap = (path) => ({ exists: docs.has(path), data: () => docs.get(path), id: path.split("/").pop() });
  const set = (path, value, options) => docs.set(path, options?.merge ? { ...(docs.get(path) || {}), ...value } : value);
  const ref = (path) => ({ path, get: async () => snap(path), set: async (value, options) => set(path, value, options) });
  const collection = (path) => {
    const build = (filters, max) => ({
      where: (field, _op, value) => build([...filters, [field, value]], max),
      limit: (count) => build(filters, count),
      get: async () => {
        const depth = path.split("/").length + 1;
        const rows = [...docs.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === depth)
          .map(snap).filter((row) => filters.every(([field, value]) => row.data()?.[field] === value));
        return { docs: rows.slice(0, max) };
      },
    });
    return build([], Infinity);
  };
  return {
    docs, doc: ref, collection,
    runTransaction: async (fn) => fn({ get: async (r) => snap(r.path), set: (r, value, options) => set(r.path, value, options) }),
  };
}

const ORG = "o1";
const consented = async () => {
  const { MEMBER_AI_CONSENT_VERSION } = await shared();
  return { name: "김하늘", aiConsent: { status: "granted", version: MEMBER_AI_CONSENT_VERSION } };
};
const seedWith = async (extra = {}) => ({
  "runtimeConfig/scheduleSync": { memberSummary: { mode: "listed", userIds: ["t1"] } },
  [`organizations/${ORG}`]: { name: "센터" },
  [`organizations/${ORG}/clients/c1`]: await consented(),
  ...Object.fromEntries(RECORDS.map((row) => [`organizations/${ORG}/lessonRecords/${row.id}`, row])),
  ...extra,
});
const okProvider = (calls = []) => ({
  executeInternal: async (request) => {
    calls.push(request);
    return { model: "gpt-5-mini", usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 3, output: {
      mustRemember: [item("오른쪽 어깨 뻐근함을 말한 적 있음", [{ recordId: "r2", date: "2026-11-10" }]), item("허리 디스크", [{ recordId: "r2", date: "2026-11-10" }])],
      recentTrend: [], openQuestions: [],
    } };
  },
});

test("새 기록 → 요약 저장, 이름은 지워서 보낸다, 버린 문장은 개수만", async () => {
  const store = fakeStore(await seedWith());
  const calls = [];
  const service = createMemberSummaryService({ firestore: store, getProvider: () => okProvider(calls), now: () => new Date("2026-11-16T00:00:00Z") });
  const result = await service.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" });
  assert.equal(result.outcome, "ready");
  const saved = store.docs.get(`organizations/${ORG}/memberSummaries/c1`);
  assert.equal(saved.status, "ready");
  assert.equal(saved.summary.mustRemember.length, 1);
  assert.deepEqual(saved.dropped, { forbidden_word: 1 });
  assert.equal(saved.lastRecordId, "r3");
  assert.doesNotMatch(JSON.stringify(calls[0].input), /김하늘/);
});

test("스위치 꺼짐 · 동의 없음이면 부르지 않는다", async () => {
  const calls = [];
  const off = fakeStore(await seedWith({ "runtimeConfig/scheduleSync": {} }));
  const service = createMemberSummaryService({ firestore: off, getProvider: () => okProvider(calls) });
  assert.equal((await service.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" })).code, "feature_off");
  const noConsent = fakeStore(await seedWith({ [`organizations/${ORG}/clients/c1`]: { name: "x" } }));
  const service2 = createMemberSummaryService({ firestore: noConsent, getProvider: () => okProvider(calls) });
  assert.equal((await service2.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" })).code, "consent_missing");
  assert.equal(calls.length, 0);
});

test("실패해도 앞 요약을 지우지 않는다. 일시 오류만 다시 시도 표시", async () => {
  const previous = { mustRemember: [item("앞 요약", [{ recordId: "r1", date: "2026-11-07" }])], recentTrend: [], openQuestions: [] };
  const store = fakeStore(await seedWith({ [`organizations/${ORG}/memberSummaries/c1`]: { status: "ready", summary: previous, lastRecordId: "r1" } }));
  const failing = (code) => ({ executeInternal: async () => { const error = new Error(code); error.code = code; throw error; } });
  const timeout = createMemberSummaryService({ firestore: store, getProvider: () => failing("timeout") });
  assert.equal((await timeout.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" })).code, "timeout");
  let saved = store.docs.get(`organizations/${ORG}/memberSummaries/c1`);
  assert.deepEqual(saved.summary, previous);
  assert.equal(saved.status, "failed");
  assert.equal(saved.retry, true);
  const invalid = createMemberSummaryService({ firestore: store, getProvider: () => failing("invalid_output") });
  await invalid.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" });
  saved = store.docs.get(`organizations/${ORG}/memberSummaries/c1`);
  assert.equal(saved.retry, false, "결정적 오류는 자동으로 다시 하지 않는다");
  assert.equal(saved.lastError.code, "invalid_output");
  assert.deepEqual(saved.summary, previous);
});

test("도는 중이면 dirty 만 세우고, 성공하면 앞 판을 versions 에 남긴다", async () => {
  const previous = { mustRemember: [], recentTrend: [], openQuestions: [] };
  const store = fakeStore(await seedWith({ [`organizations/${ORG}/memberSummaries/c1`]: { status: "ready", summary: previous, lastRecordId: "r1", lockUntil: Date.parse("2026-11-16T00:01:00Z") } }));
  const now = () => new Date("2026-11-16T00:00:00Z");
  const service = createMemberSummaryService({ firestore: store, getProvider: () => okProvider(), now });
  assert.equal((await service.refresh({ organizationId: ORG, clientId: "c1", triggerUid: "t1", reason: "record" })).code, "busy");
  assert.equal(store.docs.get(`organizations/${ORG}/memberSummaries/c1`).dirty, true);
  store.docs.set(`organizations/${ORG}/memberSummaries/c1`, { ...store.docs.get(`organizations/${ORG}/memberSummaries/c1`), lockUntil: 0 });
  await service.sweep();
  const versions = [...store.docs.keys()].filter((key) => key.includes("/versions/"));
  assert.equal(versions.length, 1);
  assert.equal(store.docs.get(`organizations/${ORG}/memberSummaries/c1`).status, "ready");
});

test("요약: AI 로 가는 기록 번호는 임시 번호, 모르는 번호는 없는 기록으로 빠진다", async () => {
  const { buildSummaryInput, restoreSourceIds, checkSummary, recentRecords } = await shared();
  const rows = recentRecords([record("uidA_n1_aaaa", "2026-11-01", "리포머"), record("uidA_n2_bbbb", "2026-11-03", "캐딜락")]);
  const input = buildSummaryInput({ records: rows });
  assert.doesNotMatch(JSON.stringify(input), /uidA/);
  assert.deepEqual(input.records.map((row) => row.recordId), ["r1", "r2"]);
  const restored = restoreSourceIds({ mustRemember: [item("캐딜락 사용", [{ recordId: "r1", date: "2026-11-03" }]), item("지어낸 근거", [{ recordId: "r9", date: "2026-11-03" }])], recentTrend: [], openQuestions: [] }, rows);
  const { summary, dropped } = checkSummary(restored, rows);
  assert.equal(summary.mustRemember[0].sources[0].recordId, "uidA_n2_bbbb");
  assert.equal(dropped[0].reason, "unknown_source");
});
