/**
 * 잔여 조정 · 만료일 변경 · 홀딩.
 *
 * 셋 다 되돌릴 수 없는 쓰기다. 규칙이 마지막 문이지만, 규칙이 막으면 화면에는
 * "권한이 없습니다" 로 도착한다 -- 권한 문제가 아니라 숫자가 모자라거나 날짜가
 * 없는 것이고, 그 셋은 사용자가 할 일이 서로 다르다. 그래서 여기서 먼저 막고
 * 종류를 가른다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HOLD_MAX_DAYS,
  HOLD_REASON_PREFIX,
  PassAdjustError,
  PassExpiryError,
  adjustPass,
  changePassExpiry,
  heldExpiry,
  holdPass,
} from "../../src/data/repositories/pass-repository.js";
import { RECONCILE_STATE, reconcilePass } from "../../src/features/members/pass-reconcile.js";

const ORG = "center-a";
const AT = new Date(2026, 8, 28, 10, 0, 0);
const EXPIRES = new Date(2027, 2, 31);

const pass = (overrides = {}) => ({
  id: "pass-1", clientId: "client-a", locationId: "bansong",
  remainingCount: 10, expiresAt: EXPIRES, status: "active", ...overrides,
});

function memoryStore() {
  const writes = [];
  return {
    writes,
    commit: async (list) => { for (const write of list) writes.push(write); },
    serverTimestamp: async () => "SERVER_TIME",
  };
}

const run = (fn, input, passDoc = pass()) => fn(ORG, passDoc, input, {
  store: memoryStore(), newId: () => "n1", now: () => AT,
});

const withStore = async (fn, input, passDoc = pass()) => {
  const store = memoryStore();
  const result = await fn(ORG, passDoc, input, { store, newId: () => "n1", now: () => AT });
  return { result, writes: store.writes };
};

/* ── 잔여 조정 ───────────────────────────────────────────────────────── */

test("조정은 원장 항목과 잔여를 한 배치로 쓴다", async () => {
  const { result, writes } = await withStore(adjustPass, {
    delta: 3, reason: "실제 잔여와 맞춤", createdBy: "owner-1",
  });

  assert.equal(writes.length, 2, "둘이 갈라지면 잔여의 근거가 사라진다");
  const [entry, passWrite] = writes;
  assert.match(entry.path, /passes\/pass-1\/ledger\/pass-1_adjust_n1$/);
  assert.equal(entry.data.type, "adjust");
  assert.equal(entry.data.delta, 3);
  assert.equal(entry.data.reason, "실제 잔여와 맞춤");
  assert.equal(entry.data.createdBy, "owner-1");

  /* 읽어서 더하지 않는다 -- 차감과 겹쳐도 한쪽이 다른 쪽을 덮어쓰지 않게
     서버가 더한다. */
  assert.equal(passWrite.operation, "decrement");
  assert.deepEqual(passWrite.data, { remainingCount: 3 });
  assert.equal(result.remainingCount, 13);
});

test("조정에는 단가도 카테고리도 수업도 없다", async () => {
  /* 급여가 그 허구를 카테고리별로 묶어 센다. */
  const { writes } = await withStore(adjustPass, { delta: -2, reason: "중복 차감 정리", createdBy: "owner-1" });
  for (const field of ["category", "unitPrice", "lessonId", "instructorId"]) {
    assert.ok(!(field in writes[0].data), field);
  }
});

test("0 미만으로는 내려가지 않는다 — 권한 문제와 다른 오류다", async () => {
  await assert.rejects(
    run(adjustPass, { delta: -11, reason: "너무 많이", createdBy: "owner-1" }),
    (error) => {
      assert.ok(error instanceof PassAdjustError);
      assert.equal(error.code, "below_zero");
      assert.equal(error.remaining, 10);
      assert.equal(error.delta, -11);
      return true;
    },
  );
  // 딱 0 까지는 된다.
  const { result } = await withStore(adjustPass, { delta: -10, reason: "전부 소진 처리", createdBy: "owner-1" });
  assert.equal(result.remainingCount, 0);
});

test("0 은 조정이 아니고, 사유는 비울 수 없다", async () => {
  await assert.rejects(run(adjustPass, { delta: 0, reason: "왜", createdBy: "owner-1" }), /Invalid delta/);
  await assert.rejects(run(adjustPass, { delta: 1.5, reason: "왜", createdBy: "owner-1" }), /Invalid delta/);
  await assert.rejects(run(adjustPass, { delta: 1, reason: "", createdBy: "owner-1" }), /Missing reason/);
  await assert.rejects(run(adjustPass, { delta: 1, reason: " ", createdBy: "owner-1" }), /Missing reason/);
  await assert.rejects(run(adjustPass, { delta: 1, reason: "가".repeat(201), createdBy: "owner-1" }), /Invalid reason/);
});

test("조정한 뒤에도 원장과 잔여가 맞는다", async () => {
  /* 점검이 이 조정을 세지 못하면, 맞추려고 한 일이 도리어 불일치를 만든다. */
  const entries = [{ type: "issue", delta: 10 }, { type: "adjust", delta: 3 }];
  assert.equal(reconcilePass(pass({ remainingCount: 13 }), entries).state, RECONCILE_STATE.MATCHED);
});

/* ── 만료일 변경 ─────────────────────────────────────────────────────── */

test("만료일 변경은 어디서 어디로인지 남긴다", async () => {
  const next = new Date(2027, 5, 30);
  const { result, writes } = await withStore(changePassExpiry, {
    expiresAt: next, reason: "연장 합의", createdBy: "owner-1",
  });

  const [entry, passWrite] = writes;
  assert.equal(entry.data.type, "expiry");
  assert.equal(entry.data.delta, 0, "회차는 움직이지 않는다");
  assert.equal(entry.data.previousExpiresAt.getTime(), EXPIRES.getTime());
  assert.equal(entry.data.newExpiresAt.getTime(), next.getTime());
  assert.equal(entry.data.reason, "연장 합의");

  /* set 이면 계약 금액도 잔여도 통째로 날아간다. */
  assert.equal(passWrite.operation, "update");
  assert.deepEqual(Object.keys(passWrite.data), ["expiresAt"]);
  assert.equal(result.expiresAt.getTime(), next.getTime());
});

test("만료일이 없던 회원권은 이 통로로 손대지 않는다", async () => {
  /* 어디서 옮겼는지를 적을 수 없다. 규칙도 previousExpiresAt 을 요구한다. */
  await assert.rejects(
    run(changePassExpiry, { expiresAt: new Date(2027, 5, 30), reason: "연장", createdBy: "owner-1" },
      pass({ expiresAt: null })),
    (error) => {
      assert.ok(error instanceof PassExpiryError);
      assert.equal(error.code, "no_previous_expiry");
      return true;
    },
  );
});

test("같은 날짜로 바꾸는 것은 변경이 아니다", async () => {
  await assert.rejects(
    run(changePassExpiry, { expiresAt: new Date(EXPIRES.getTime()), reason: "그대로", createdBy: "owner-1" }),
    (error) => {
      assert.equal(error.code, "unchanged");
      return true;
    },
  );
});

test("만료일 변경도 사유가 필수다", async () => {
  await assert.rejects(
    run(changePassExpiry, { expiresAt: new Date(2027, 5, 30), reason: "", createdBy: "owner-1" }),
    /Missing reason/,
  );
});

/* ── 홀딩 ────────────────────────────────────────────────────────────── */

test("홀딩은 만료일을 그만큼 뒤로 민다", async () => {
  const { result, writes } = await withStore(holdPass, { days: 30, createdBy: "owner-1" });
  const expected = new Date(EXPIRES.getTime() + 30 * 86400000);
  assert.equal(result.expiresAt.getTime(), expected.getTime());
  assert.equal(writes[0].data.type, "expiry", "홀딩은 별도 종류가 아니다");
  assert.match(writes[0].data.reason, new RegExp(`^${HOLD_REASON_PREFIX} 30일`));
});

test("홀딩 사유에 설명을 덧붙일 수 있다", async () => {
  const { writes } = await withStore(holdPass, { days: 14, reason: "출산", createdBy: "owner-1" });
  assert.equal(writes[0].data.reason, "홀딩 14일 · 출산");
});

test("홀딩 기간은 하루 이상 1년 이하다", () => {
  /* 1년을 넘기면 회원권을 다시 발급하는 편이 맞다 -- 계약이 사실상 다른
     것이 된다. */
  assert.equal(heldExpiry(EXPIRES, 1).getTime(), EXPIRES.getTime() + 86400000);
  assert.equal(heldExpiry(EXPIRES, HOLD_MAX_DAYS).getTime(), EXPIRES.getTime() + HOLD_MAX_DAYS * 86400000);
  assert.throws(() => heldExpiry(EXPIRES, HOLD_MAX_DAYS + 1), /Invalid days/);
  assert.throws(() => heldExpiry(EXPIRES, 0), /Invalid days/);
  assert.throws(() => heldExpiry(EXPIRES, -5), /Invalid days/);
  assert.equal(heldExpiry(null, 30), null, "만료일이 없으면 밀 자리가 없다");
});

test("만료가 지난 회원권을 연장하면 다시 쓸 수 있다", async () => {
  /* status 를 expired 로 쓰는 코드는 어디에도 없다 -- 만료는 날짜로만
     판정한다. 그래서 날짜만 밀면 저절로 운영중으로 돌아온다. */
  const expired = pass({ expiresAt: new Date(2026, 0, 31) });
  const { result, writes } = await withStore(holdPass, { days: 90, createdBy: "owner-1" }, expired);
  assert.ok(result.expiresAt.getTime() > new Date(2026, 0, 31).getTime());
  assert.ok(!("status" in writes[1].data), "상태는 건드리지 않는다");
});
