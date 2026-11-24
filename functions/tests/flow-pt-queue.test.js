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

test("가져오기: PT 완료만 만들고, 다시 돌아도 FC 처리를 되돌리지 않는다, 보드 하나 실패해도 계속", async () => {
  const firestore = fakeFirestore({
    "organizations/org": {}, "organizations/org/locations/l1": { name: "삼계점" },
  });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, key: init.headers["x-flow-api-key"] });
    if (url.includes("/projects/2955393?")) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { hasNext: false, lastCursor: -1, posts: [
        post(), post({ postId: "p2", content: "8:1 그룹" }), post({ postId: "p3", taskStatus: "REQUEST" }),
      ] } }) };
    }
    if (url.includes("/projects/2955389?")) {
      return { ok: false, status: 401, json: async () => ({ success: false, error: { code: "UNAUTHORIZED_ERROR", message: "API Key 정보가 올바르지 않습니다." } }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: { hasNext: false, lastCursor: -1, posts: [] } }) };
  };
  const logs = [];
  const service = createFlowPtQueueService({
    firestore, fetchImpl, apiKey: () => "key-test", userId: () => "owner@example.test",
    now: () => new Date("2026-11-24T03:00:00Z"), log: (level, event, fields) => logs.push({ level, event, fields }),
  });
  const counts = await service.sync();
  assert.equal(counts.created, 1);
  assert.equal(counts.failedProjects, 1);
  assert.equal(calls[0].key, "key-test");
  assert.match(calls[0].url, /^https:\/\/api\.flow\.team\/v1\/posts\/projects\/2955393\?userId=owner%40example\.test&cursor=0&pageSize=100$/);
  const saved = firestore.docs.get("organizations/org/flowPtQueue/p1");
  assert.equal(saved.state, "waiting");
  assert.equal(saved.locationId, "l1");
  assert.ok(!firestore.docs.has("organizations/org/flowPtQueue/p2"));
  assert.ok(!firestore.docs.has("organizations/org/flowPtQueue/p3"));
  const failure = logs.find((entry) => entry.event === "flow_pt_queue_fetch_failed");
  assert.equal(failure.fields.errorCode, "UNAUTHORIZED_ERROR", "플로우 원본 코드를 그대로");
  assert.equal(failure.fields.errorDomain, "flow_api");
  assert.ok(!JSON.stringify(logs).includes("key-test") && !JSON.stringify(logs).includes("owner@example.test"), "키 · 계정은 진단에 없다");

  firestore.docs.set("organizations/org/flowPtQueue/p1", { ...saved, state: "issued", handledBy: "fc" });
  await service.sync();
  assert.equal(firestore.docs.get("organizations/org/flowPtQueue/p1").state, "issued", "FC 가 누른 처리는 그대로");
});

test("앱 저장소와 서버가 같은 이름 · 상태를 쓴다", async () => {
  const { FLOW_PT_COLLECTION, FLOW_PT_STATE } = await shared();
  const fs = require("node:fs");
  const repo = fs.readFileSync(require.resolve("../../src/data/repositories/flow-pt-queue-repository.js"), "utf8");
  assert.ok(repo.includes(`FLOW_PT_COLLECTION = "${FLOW_PT_COLLECTION}"`));
  for (const value of Object.values(FLOW_PT_STATE)) assert.ok(repo.includes(`"${value}"`));
});

/* 2026-11-24 첫 실행: 9개 보드 모두 network · HTTP 0, 원문은 로거가 message 칸을 덮어 사라졌다. */
test("요청 전에 멈추면: 비밀값 모양은 코드로, 연결 실패는 원인 코드와 원문(detail)으로, 값은 남기지 않는다", async () => {
  const firestore = fakeFirestore({ "organizations/org": {}, "organizations/org/locations/l1": { name: "삼계점" } });
  const logs = [];
  const log = (level, event, fields) => logs.push({ level, event, fields });
  let calls = 0;
  const badKey = createFlowPtQueueService({
    firestore, fetchImpl: async () => { calls += 1; throw new Error("unreachable"); },
    apiKey: () => "키\n값", userId: () => "owner@example.test", log,
  });
  const counts = await badKey.sync();
  assert.equal(calls, 0, "헤더에 못 싣는 키면 부르지 않는다");
  assert.equal(counts.failedProjects, 1, "비밀값 문제는 첫 보드에서 멈춘다");
  assert.equal(logs[0].fields.errorCode, "api_key_invalid_chars");
  assert.ok(!JSON.stringify(logs).includes("키"), "키 값은 남기지 않는다");

  logs.length = 0;
  const padded = createFlowPtQueueService({
    firestore, apiKey: () => "  key-test \n", userId: () => " owner@example.test ", log,
    fetchImpl: async (url, init) => {
      assert.equal(init.headers["x-flow-api-key"], "key-test", "앞뒤 빈칸 · 줄바꿈은 지운다");
      assert.match(url, /userId=owner%40example\.test&/);
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.flow.team"), { code: "ENOTFOUND" }) });
    },
  });
  await padded.sync();
  const failure = logs.find((entry) => entry.event === "flow_pt_queue_fetch_failed");
  assert.equal(failure.fields.errorCode, "network");
  assert.equal(failure.fields.causeCode, "ENOTFOUND");
  assert.match(failure.fields.detail, /TypeError: fetch failed \/ getaddrinfo ENOTFOUND/);
  assert.ok(!("message" in failure.fields), "로거가 덮는 message 칸에 원문을 두지 않는다");
});
