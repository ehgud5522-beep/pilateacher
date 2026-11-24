"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFlowPtQueueService } = require("../src/flow-pt-queue");

const shared = () => import("../shared/flow-pt-queue.mjs");

/* 2026-11-24 대표: "플로우에 등록상품이 PT 라고 적힌 것만 발급 대기로 -- FC 가 플로우 내용을 확인한 후 발급". */
test("PT 판정: 낱말 PT · 1:1pt · 피티는 예, opt · 그룹은 아니오, 완료만", async () => {
  const { mentionsPt, isPtQueuePost } = await shared();
  assert.equal(mentionsPt("[신규 잔금] 1:1pt 10%서비스 10s"), true);
  assert.equal(mentionsPt("PT 20회 재등록"), true);
  assert.equal(mentionsPt("피티 상담"), true);
  assert.equal(mentionsPt("8:1 그룹 50s"), false);
  assert.equal(mentionsPt("adopt option"), false);
  const post = { postId: "1", title: "회원 잔금", content: "1:1pt 10s", taskStatus: "COMPLETE" };
  assert.equal(isPtQueuePost(post), true);
  assert.equal(isPtQueuePost({ ...post, taskStatus: "REQUEST" }), false, "상담예정 · 재컨택은 아직");
  assert.equal(isPtQueuePost({ ...post, taskStatus: "HOLD" }), false, "실패 · 노쇼");
  assert.equal(isPtQueuePost({ ...post, content: "8:1 그룹" }), false);
  assert.equal(isPtQueuePost({ ...post, taskStatus: "" }), false, "업무가 아닌 글");
});

test("지점 맞추기 · 시각 · 본문(전화 가림)", async () => {
  const { branchNameOfProject, matchLocationId, flowDateTime, flowExcerpt, flowQueueFields } = await shared();
  assert.equal(branchNameOfProject("삼계점 업무보드"), "삼계점");
  const locations = [{ id: "l1", name: "삼계점" }, { id: "l2", name: "율하 점" }];
  assert.equal(matchLocationId("삼계점", locations), "l1");
  assert.equal(matchLocationId("율하점", locations), "l2");
  assert.equal(matchLocationId("없는점", locations), "");
  assert.equal(matchLocationId("삼계점", [...locations, { id: "l3", name: "삼계" }]), "", "둘 이상 맞으면 고르지 않는다");
  assert.equal(flowDateTime("20261124111420").toISOString(), "2026-11-24T02:14:20.000Z");
  assert.equal(flowDateTime("2026"), null);
  assert.equal(flowExcerpt("연락처 010-1234-5678 / 01098765432"), "연락처 010-****-**** / 010-****-****");
  const fields = flowQueueFields({ postId: "9", projectId: "2955393", projectTitle: "삼계점 업무보드", title: "환불 건", content: "pt", taskStatus: "complete", registeredDateTime: "20261124111420" }, { organizationId: "org", locationId: "l1" });
  assert.equal(fields.mentionsRefund, true);
  assert.equal(fields.taskStatus, "COMPLETE");
  assert.equal(fields.branchName, "삼계점");
  assert.ok(!("state" in fields), "처리 칸은 동기화가 만들지 않는다");
});

function fakeFirestore(seed) {
  const docs = new Map(Object.entries(seed));
  const ref = (path) => ({
    get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
    set: async (value) => { docs.set(path, value); },
    update: async (value) => { docs.set(path, { ...docs.get(path), ...value }); },
  });
  const collection = (path) => ({
    get: async () => ({
      docs: [...docs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
        .map(([key, value]) => ({ id: key.slice(path.length + 1), data: () => value })),
    }),
  });
  return { doc: ref, collection, docs };
}

const post = (extra) => ({
  projectId: "2955393", projectTitle: "삼계점 업무보드", postId: "p1", title: "회원 잔금", content: "1:1pt 10s 카드완납",
  taskStatus: "COMPLETE", registerName: "삼계점", registeredDateTime: "20261124111420", ...extra,
});

test("앱 저장소와 서버가 같은 이름 · 상태를 쓴다", async () => {
  const { FLOW_PT_COLLECTION, FLOW_PT_STATE } = await shared();
  const fs = require("node:fs");
  const repo = fs.readFileSync(require.resolve("../../src/data/repositories/flow-pt-queue-repository.js"), "utf8");
  assert.ok(repo.includes(`FLOW_PT_COLLECTION = "${FLOW_PT_COLLECTION}"`));
  for (const value of Object.values(FLOW_PT_STATE)) assert.ok(repo.includes(`"${value}"`));
});

/* 2026-11-24 첫 실행: 9개 보드 모두 network · HTTP 0, 원문은 로거가 message 칸을 덮어 사라졌다. */
test("PT 줄 판정: 실제 업무 모양 (양산점 · 장유점)", async () => {
  const { ptLines } = await shared();
  const pt = [
    "[재등록] 회원님 1:1PT 깍두기EV 10s 55만 카드완납(신규페이)",
    "[신규] 회원님 1:1 pt 50s 330만원 카드완납(신규페이)",
    "[결제] 회원님 1:1 40s 공동구매e 잔금 209만원",
    "[신규] 회원/회원님 2:1 듀엣 30s 수능e 240만원 카드완납",
    "[신규] 회원님 디오사A 10s 44만 카드완납(2만페이)",
    "[신규] 회원님 1:1pt 1s+디오사A 1s 11만 카드완납",
    "[신규] 회원님 1:1 pt 24s 패키지e 145.68만원 카드완납",
    "[신규] 회원님 1:1 pt 일일체험비 5.5만원 카드완납(신규페이)",
  ];
  const notPt = [
    "[신규] 회원님 8:1 그룹 200s 140만원 카드완납",
    "[재등록] 회원님 8:1 50+50 79만 카드완납",
    "[신규] 회원님 8:1 그룹 일일체험비 1만원 계좌완납",
    "[세션업] 회원님 1:1pt 2차 20s->100s 세션업 미사용건 환불",
    "[결제변경건] 회원님 1:1 40s 공동구매e 잔금 국민카드 취소 후",
    "매출취소 양산중부",
    "매출 양산중부 강사이름",
    "잔금 11/13 결제예정 12:30",
  ];
  for (const line of pt) assert.equal(ptLines(line).length, 1, line);
  for (const line of notPt) assert.equal(ptLines(line).length, 0, line);
  assert.deepEqual(ptLines("매출 장유\n \n[신규] 회원님 1:1 pt 24s 패키지e\n \n[신규] 회원님 8:1 그룹 24s 패키지"), ["[신규] 회원님 1:1 pt 24s 패키지e"], "PT 줄 · 그룹 줄이 한 글에");
});

test("성공은 보드의 단계 번호로 -- 환불 · 상담예정은 빠진다, 잔금 · 체험 표시", async () => {
  const { isPtQueuePost, flowQueueFields, flowPtBoard } = await shared();
  const yangsan = flowPtBoard("2955433");
  const base = { postId: "9", projectId: "2955433", projectTitle: "", title: "회원 잔금", content: "매출 양산중부\n[신규잔금] 회원님 1:1pt 10s 잔금11만", registeredDateTime: "20261120140531" };
  assert.equal(isPtQueuePost({ ...base, taskStatus: "1035146" }, yangsan), true, "성공");
  assert.equal(isPtQueuePost({ ...base, taskStatus: "1035149" }, yangsan), false, "환불");
  assert.equal(isPtQueuePost({ ...base, taskStatus: "1035144" }, yangsan), false, "상담예정");
  const fields = flowQueueFields({ ...base, taskStatus: "1035146" }, { organizationId: "org", locationId: "l1", board: yangsan });
  assert.equal(fields.branchName, "양산점", "보드 이름이 비어도 지점은 보드 표에서");
  assert.equal(fields.isBalance, true);
  assert.equal(fields.isTrial, false);
  assert.equal(fields.excerpt, "[신규잔금] 회원님 1:1pt 10s 잔금11만", "FC 가 볼 것은 PT 줄");
  const trial = flowQueueFields({ ...base, title: "회원", content: "[신규] 회원님 1:1 pt 일일체험비 5.5만", taskStatus: "1035146" }, { organizationId: "org", board: yangsan });
  assert.equal(trial.isTrial, true);
});

/* 2026-11-24: 9개 보드가 200 인데 글 0건 -- 조회 방식을 바꿔 보는 시험. 건수 · 칸 이름 · 종류 · 상태 모양만, 제목 · 본문은 없다. */

/* ── 개인용 업무 필터 조회 (2026-11-24): GET /user/posts/projects/{id}/tasks/filter ── */
const column = (columnId, value, columnType = "TEXT") => ({ columnId, columnType, columnData: [{ customColumnData: value, optionName: value }] });
const task = (postId, product, extra = {}) => ({
  taskId: `t${postId}`, postId, projectId: "2955393", content: "회원 이름", columns: [
    { columnId: "12", columnType: "STATUS", columnData: [{ optionName: "성공", customColumnData: "1035123" }] },
    column("117553", "재등록", "OPTION"), column("117554", product), column("117555", "55", "NUMBER"), column("117556", "카드완납", "OPTION"),
    column("117557", "010-1234-5678"),
  ], ...extra,
});
const ok = (tasks, extra = {}) => ({ ok: true, status: 200, json: async () => ({ success: true, code: 200, data: { hasNext: false, lastCursor: -1, mode: "TREE", tasks, ...extra } }) });

test("가져오기: 개인용 업무 필터 -- 성공만 걸러 받고, 등록상품 칸으로 PT 를 고르고, FC 처리는 되돌리지 않는다", async () => {
  const firestore = fakeFirestore({ "organizations/org": {}, "organizations/org/locations/l1": { name: "삼계점" } });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, key: init.headers["x-flow-api-key"] });
    if (url.includes("/2955393/")) return ok([task("p1", "1:1PT 깍두기EV 10s"), task("p2", "8:1 50+50"), task("p3", "디오사A 10s")]);
    if (url.includes("/2955389/")) return { ok: false, status: 412, json: async () => ({ success: false, error: { code: "PRECONDITION_FAILED_ERROR", message: "참여자가 아님" } }) };
    return ok([]);
  };
  const logs = [];
  const service = createFlowPtQueueService({ firestore, fetchImpl, apiKey: () => " key-test \n", now: () => new Date("2026-11-25T03:00:00Z"), log: (level, event, fields) => logs.push({ event, fields }) });
  const counts = await service.sync();
  assert.equal(calls[0].key, "key-test");
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/user/posts/projects/2955393/tasks/filter");
  assert.equal(url.searchParams.get("userId"), null, "개인용은 userId 가 없다");
  assert.deepEqual(JSON.parse(url.searchParams.get("filterRecords")), [{ COLUMN_SRNO: "12", OPERATOR_TYPE: "EQUAL", FILTER_DATA: "1035123" }], "성공만");
  assert.equal(counts.created, 2, "1:1PT · 디오사 (그룹은 뺀다)");
  assert.deepEqual(counts.failures, [{ flowProjectId: "2955389", errorCode: "PRECONDITION_FAILED_ERROR", causeCode: "", httpStatus: 412 }]);
  const saved = firestore.docs.get("organizations/org/flowPtQueue/p1");
  assert.equal(saved.state, "waiting");
  assert.equal(saved.branchName, "삼계점");
  assert.equal(saved.excerpt, "재등록 · 1:1PT 깍두기EV 10s · 55 · 카드완납 · 010-****-****", "칸 값 전부, 전화는 가림");
  assert.ok(saved.registeredAt instanceof Date, "업무 응답에 등록 시각이 없어 처음 본 때");
  assert.ok(!firestore.docs.has("organizations/org/flowPtQueue/p2"));
  assert.ok(!JSON.stringify(logs).includes("key-test") && !JSON.stringify(logs).includes("깍두기"), "키 · 칸 값은 진단에 없다");

  firestore.docs.set("organizations/org/flowPtQueue/p1", { ...saved, state: "not_applicable", handledBy: "fc" });
  await service.sync();
  assert.equal(firestore.docs.get("organizations/org/flowPtQueue/p1").state, "not_applicable", "FC 가 누른 처리는 그대로");
});

test("상태 거르기를 플로우가 거절하면 거르지 않고 받아 칸 값의 상태로 고른다", async () => {
  const firestore = fakeFirestore({ "organizations/org": {}, "organizations/org/locations/l1": { name: "삼계점" } });
  const urls = [];
  const refund = task("p9", "1:1pt 10s", { columns: [{ columnId: "12", columnType: "STATUS", columnData: [{ optionName: "환불", customColumnData: "1035126" }] }, column("117554", "1:1pt 10s")] });
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("filterRecords")) return { ok: false, status: 400, json: async () => ({ success: false, error: { code: "VALIDATION_ERROR" } }) };
    return url.includes("/2955393/") ? ok([task("p1", "1:1pt 10s"), refund]) : ok([]);
  };
  const counts = await createFlowPtQueueService({ firestore, fetchImpl, apiKey: () => "key", now: () => new Date("2026-11-25T03:00:00Z") }).sync();
  assert.equal(counts.failedProjects, 0);
  assert.equal(counts.unfiltered, 9);
  assert.equal(counts.created, 1, "환불은 칸 값으로 빠진다");
  assert.ok(firestore.docs.has("organizations/org/flowPtQueue/p1") && !firestore.docs.has("organizations/org/flowPtQueue/p9"));
});

test("키 모양이 틀리거나 플로우가 키를 거절하면 첫 보드에서 멈춘다 (값은 남기지 않는다)", async () => {
  const firestore = fakeFirestore({ "organizations/org": {} });
  let calls = 0;
  const logs = [];
  const bad = await createFlowPtQueueService({ firestore, fetchImpl: async () => { calls += 1; return ok([]); }, apiKey: () => "키\n값", log: (level, event, fields) => logs.push(fields) }).sync();
  assert.equal(calls, 0);
  assert.equal(bad.failures[0].errorCode, "api_key_invalid_chars");
  assert.ok(!JSON.stringify(logs).includes("키\n값"));
  const denied = await createFlowPtQueueService({ firestore, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ success: false, error: { code: "UNAUTHORIZED_ERROR" } }) }), apiKey: () => "key" }).sync();
  assert.equal(denied.failedProjects, 1, "키 거절은 아홉 번 부르지 않는다");
});

test("업무 칸 읽기: 다른 이름의 칸 모양도 받는다", async () => {
  const { taskColumnValues, taskStatusOf, taskAsPost, isPtQueuePost, flowPtBoard } = await shared();
  const other = { postId: "x", content: "회원", columns: [{ COLUMN_SRNO: "12", value: "1035146" }, { COLUMN_SRNO: "200", value: "2:1 듀엣 30s" }, { COLUMN_SRNO: "201", value: "잔금" }] };
  assert.deepEqual(taskColumnValues(other), ["2:1 듀엣 30s", "잔금"]);
  assert.equal(taskStatusOf(other), "1035146");
  const board = flowPtBoard("2955433");
  assert.equal(isPtQueuePost(taskAsPost(other, board, { filtered: false }), board), true);
});

/* 2026-11-24 대표: "오늘부터". 처음 읽었을 때 8월부터의 성공 업무가 전부 떴다 -- 기준선 전 업무는 숨기고, 오늘 글은 남긴다. */
test("기준선: 오늘 전 성공 업무는 숨기고(손대지 않은 대기도 돌린다), 오늘 글 · 이후 새로 성공한 업무만 뜬다", async () => {
  const { isBaselineTask, FLOW_PT_TODAY_POST_ID } = await shared();
  const before = new Date("2026-11-24T10:00:00Z");
  assert.equal(isBaselineTask("87588191", before), true, "10월 글");
  assert.equal(isBaselineTask(String(FLOW_PT_TODAY_POST_ID + 5), before), false, "오늘 글");
  assert.equal(isBaselineTask("87588191", new Date("2026-11-25T00:00:00Z")), false, "기준선 뒤에 처음 본 업무(오늘 새로 성공)는 뜬다");

  const firestore = fakeFirestore({
    "organizations/org": {}, "organizations/org/locations/l1": { name: "삼계점" },
    "organizations/org/flowPtQueue/87000001": { postId: "87000001", state: "waiting", handledBy: "", registeredAt: before },
    "organizations/org/flowPtQueue/87000002": { postId: "87000002", state: "not_applicable", handledBy: "fc", registeredAt: before },
  });
  const fetchImpl = async (url) => (url.includes("/2955393/") ? ok([task("87000001", "1:1pt 10s"), task("87000002", "1:1pt 10s"), task("87000003", "1:1pt 10s"), task(String(FLOW_PT_TODAY_POST_ID + 1), "1:1pt 10s")]) : ok([]));
  const counts = await createFlowPtQueueService({ firestore, fetchImpl, apiKey: () => "key", now: () => before }).sync();
  assert.equal(firestore.docs.get("organizations/org/flowPtQueue/87000001").state, "baseline", "손대지 않은 옛 대기는 숨긴다");
  assert.equal(firestore.docs.get("organizations/org/flowPtQueue/87000002").state, "not_applicable", "FC 가 누른 것은 그대로");
  assert.equal(firestore.docs.get("organizations/org/flowPtQueue/87000003").state, "baseline");
  assert.equal(firestore.docs.get(`organizations/org/flowPtQueue/${FLOW_PT_TODAY_POST_ID + 1}`).state, "waiting", "오늘 글");
  assert.equal(counts.baseline, 2);
  assert.equal(counts.created, 1);
});

test("칸 값에서 기본 칸 · 이메일은 뺀다", async () => {
  const { taskColumnValues } = await shared();
  const values = taskColumnValues({ columns: [
    { columnId: "2", columnType: "USER", columnData: [{ optionName: "staff@example.test" }] },
    { columnId: "3", columnType: "DATE", columnData: [{ customColumnData: "PAST" }] },
    { columnId: "5", columnType: "NUMBER", columnData: [{ customColumnData: "1157" }] },
    { columnId: "117554", columnType: "TEXT", columnData: [{ customColumnData: "1:1pt 24s" }] },
    { columnId: "118906", columnType: "CHECKBOX", columnData: [{ customColumnData: "1" }] },
    { columnId: "119000", columnType: "TEXT", columnData: [{ customColumnData: "someone@example.test" }] },
  ] });
  assert.deepEqual(values, ["1:1pt 24s"]);
});
