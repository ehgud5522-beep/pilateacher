import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PASS_CLIENTS, isDuetPass, normalizePassClientIds, partnerClientId,
  passBelongsTo, passClientIds, pricingPriorSessions,
} from "../../src/data/schema/pass-clients.js";

/* ── 읽기는 관대하게 ──────────────────────────────────────────────────────
   이 함수들은 화면이 회원권을 그릴 때마다 불린다. 문서 하나가 이상하다고
   그 회원의 화면이 통째로 비면 안 된다. */

test("a pass without the new field is one member, not none", () => {
  // 이관된 회원권과 이 기능 전에 발급된 것이 전부 그렇다. 그 회원권들은 실제로 1:1 이다.
  assert.deepEqual(passClientIds({ clientId: "c-1" }), ["c-1"]);
  assert.deepEqual(passClientIds({ clientId: "c-1", clientIds: [] }), ["c-1"]);
  assert.equal(isDuetPass({ clientId: "c-1" }), false);
});

test("a duet pass names both, anchor first", () => {
  const pass = { clientId: "c-1", clientIds: ["c-1", "c-2"] };
  assert.deepEqual(passClientIds(pass), ["c-1", "c-2"]);
  assert.equal(isDuetPass(pass), true);
});

test("a broken document is read back into shape rather than thrown away", () => {
  /* 불변식이 깨진 문서를 만나도 대표를 앞으로 되돌려 읽는다. 쓰기 쪽은
     normalizePassClientIds 가 막으므로 여기까지 오는 일은 없어야 하지만,
     오면 화면이 서는 편이 낫다. */
  assert.deepEqual(passClientIds({ clientId: "c-1", clientIds: ["c-2", "c-1"] }), ["c-1", "c-2"]);
  assert.deepEqual(passClientIds({ clientId: "c-1", clientIds: ["c-2"] }), ["c-1", "c-2"]);
  assert.deepEqual(passClientIds({}), []);
});

test("the pass belongs to the partner exactly as much as to the anchor", () => {
  /* 이 한 줄이 이 기능의 전부다. 짝에게 false 를 주면 그 사람의 잔여도 여정도
     단가도 화면에서 사라진다. */
  const pass = { clientId: "c-1", clientIds: ["c-1", "c-2"] };
  assert.equal(passBelongsTo(pass, "c-1"), true);
  assert.equal(passBelongsTo(pass, "c-2"), true);
  assert.equal(passBelongsTo(pass, "c-3"), false);
  assert.equal(passBelongsTo(pass, ""), false);
});

test("the partner is whoever is not you", () => {
  const pass = { clientId: "c-1", clientIds: ["c-1", "c-2"] };
  assert.equal(partnerClientId(pass, "c-1"), "c-2");
  assert.equal(partnerClientId(pass, "c-2"), "c-1");
  // 남의 회원권에서는 짝을 알려주지 않는다 -- 물을 자격이 없는 질문이다.
  assert.equal(partnerClientId(pass, "c-3"), "");
  assert.equal(partnerClientId({ clientId: "c-1" }, "c-1"), "");
});

/* ── 쓰기는 엄격하게 ──────────────────────────────────────────────────── */

test("issuing accepts a lone member and a pair, and nothing else", () => {
  assert.deepEqual(normalizePassClientIds("c-1", undefined), ["c-1"]);
  assert.deepEqual(normalizePassClientIds("c-1", ["c-1", "c-2"]), ["c-1", "c-2"]);
  assert.equal(MAX_PASS_CLIENTS, 2);
  assert.throws(() => normalizePassClientIds("c-1", ["c-1", "c-2", "c-3"]), /Invalid clientIds/);
  assert.throws(() => normalizePassClientIds("c-1", []), /Invalid clientIds/);
  assert.throws(() => normalizePassClientIds("c-1", "c-2"), /Invalid clientIds/);
  assert.throws(() => normalizePassClientIds("", ["c-1"]), /Missing clientId/);
});

test("the same person twice is refused, because the count would run double", () => {
  /* 회차는 하나인데 누적이 둘 올라간다. 20회 판정이 실제의 두 배 속도로
     지나가고, 그 시점부터 단가가 조용히 틀린다. */
  assert.throws(() => normalizePassClientIds("c-1", ["c-1", "c-1"]), /Invalid clientIds/);
});

test("the anchor must come first, or the rules point at a different person", () => {
  // 규칙이 원장 항목을 pass.clientId 에 못 박고 있다. 대표가 바뀌면 그 결합이 깨진다.
  assert.throws(() => normalizePassClientIds("c-1", ["c-2", "c-1"]), /Invalid clientIds/);
  assert.throws(() => normalizePassClientIds("c-1", ["c-2"]), /Invalid clientIds/);
});

/* ── 단가를 정할 누적 ─────────────────────────────────────────────────── */

test("the pair is priced by whoever the instructor knows least", () => {
  /* 판정 3 은 "이 강사가 이 회원을 아직 모른다" 를 묻는다. 한 명이 새 사람이면
     그 수업은 강사에게 아직 새 수업이다. */
  assert.equal(pricingPriorSessions([40, 3]), 3);
  assert.equal(pricingPriorSessions([3, 40]), 3);
  // 늘 함께 다니면 값이 같고, 이 함수는 아무 일도 하지 않는다.
  assert.equal(pricingPriorSessions([12, 12]), 12);
  assert.equal(pricingPriorSessions([25]), 25);
  assert.equal(pricingPriorSessions([]), 0);
  assert.equal(pricingPriorSessions(null), 0);
  // 읽지 못한 값은 0 이다 -- 지어내서 20 을 넘기면 그 회차가 비싸게 굳는다.
  assert.equal(pricingPriorSessions([undefined, 40]), 0);
});
