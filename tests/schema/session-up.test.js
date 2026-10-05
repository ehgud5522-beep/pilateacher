import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_UP_ERROR, SESSION_UP_ERROR_LABEL,
  planSessionUp, sessionUpError, sessionUpLabel, sessionUpUnitPrice,
} from "../../functions/shared/session-up.mjs";

/**
 * 세션업 — **같은 회원권을 늘린다. 새로 발급하지 않는다.**
 *
 * 이 파일이 지키는 것은 둘이다.
 *
 * 하나. **화면과 서버가 같은 숫자를 센다.** 둘이 갈라지면 대표가 본 숫자와
 * 박히는 숫자가 다르고, 그때는 원장이 이미 쌓인 뒤다. 그래서 전/후 표도 쓰기도
 * planSessionUp 하나를 부른다 -- 이 파일은 그 함수만 본다.
 *
 * 둘. **늘린 회차가 증발하지 않는다.** 총회차만 늘리고 잔여를 두면 회원이 산
 * 회차가 사라지고, 회원은 그 사실을 다음 수업에 가서야 안다.
 */

const pass = (overrides = {}) => ({
  id: "pass-1", organizationId: "center-a", clientId: "client-a",
  status: "active", totalSessions: 20, serviceSessions: 2, serviceUsed: 0,
  remainingCount: 8, contractPrice: 1300000, baseUnitPrice: 65000,
  paymentMethod: "card", expiresAt: new Date(2027, 1, 1),
  ...overrides,
});

/* ── 숫자 ───────────────────────────────────────────────────────────────── */

test("the added sessions land in both the total and the remaining count", () => {
  /* 추가한 회차는 아직 쓰지 않은 것이다. 총회차만 늘리면 회원이 산 회차가
     사라지고, 회원은 다음 수업에 가서야 그 사실을 안다. */
  const { before, after } = planSessionUp({ pass: pass(), addSessions: 50, addPrice: 2500000 });

  assert.equal(before.totalSessions, 20);
  assert.equal(before.remainingCount, 8);
  assert.equal(after.totalSessions, 70);
  assert.equal(after.remainingCount, 58);
});

test("the unit price is recounted over the combined sessions and price", () => {
  /* 계약 금액도 회차도 함께 늘어난다. 둘을 합쳐 나눈 값이 새 단가다 --
     추가분만 따로 나누면 같은 회원권 안에 단가가 둘이 된다. */
  const { after } = planSessionUp({ pass: pass(), addSessions: 50, addPrice: 2500000 });

  assert.equal(after.contractPrice, 3800000);
  // 3,800,000 ÷ 70 = 54,285.7 → 54,286
  assert.equal(after.baseUnitPrice, 54286);
});

test("service sessions stay out of the price divisor", () => {
  /* 서비스는 회원이 낸 돈이 아니다. 분모에 넣으면 단가가 낮게 잡히고, 그
     차이가 그대로 급여에서 빠진다. */
  const { after } = planSessionUp({
    pass: pass({ totalSessions: 10, serviceSessions: 5, contractPrice: 1000000 }),
    addSessions: 10, addPrice: 1000000,
  });

  assert.equal(after.serviceSessions, 5);
  // 2,000,000 ÷ 20 이지 ÷ 25 가 아니다.
  assert.equal(after.baseUnitPrice, 100000);
});

test("added service sessions raise the remaining count too", () => {
  /* 서비스도 아직 쓰지 않은 회차다. 잔여에 넣지 않으면 센터가 얹어 준 회차를
     아무도 쓸 수 없다. */
  const { after } = planSessionUp({
    pass: pass(), addSessions: 10, addPrice: 500000, addService: 2,
  });

  assert.equal(after.serviceSessions, 4);
  assert.equal(after.remainingCount, 8 + 10 + 2);
  // 서비스는 총회차에도 단가의 분모에도 들어가지 않는다.
  assert.equal(after.totalSessions, 30);
  assert.equal(after.baseUnitPrice, 60000);
});

test("a service-only session up moves no money", () => {
  /* 센터가 사과의 뜻으로 한 회를 얹는 일이 있다. 0원이어야 하고, 단가가
     그 때문에 움직이면 안 된다. */
  const { before, after } = planSessionUp({
    pass: pass(), addSessions: 0, addPrice: 0, addService: 1,
  });

  assert.equal(after.contractPrice, before.contractPrice);
  assert.equal(after.totalSessions, before.totalSessions);
  assert.equal(after.baseUnitPrice, 65000);
  assert.equal(after.remainingCount, 9);
});

test("the expiry stays unless a new one is given", () => {
  /* 늘린 회차를 쓸 기간이 없으면 늘린 뜻이 없다. 그래도 날짜를 멋대로
     밀지 않는다 -- 그 판단은 사람이 한다. */
  const kept = planSessionUp({ pass: pass(), addSessions: 10, addPrice: 500000 });
  assert.deepEqual(kept.after.expiresAt, new Date(2027, 1, 1));

  const moved = planSessionUp({
    pass: pass(), addSessions: 10, addPrice: 500000, expiresAt: new Date(2027, 7, 1),
  });
  assert.deepEqual(moved.after.expiresAt, new Date(2027, 7, 1));
});

test("serviceUsed is untouched so the first free session stays once per pass", () => {
  /* 서비스를 더해도 "회원권당 한 번" 은 그대로다. 세션업이 그 권리를 새로
     주면 서비스를 얹을 때마다 센터가 한 번씩 더 지불한다. */
  const { after } = planSessionUp({
    pass: pass({ serviceUsed: 1 }), addSessions: 10, addPrice: 500000, addService: 3,
  });

  assert.equal(Object.hasOwn(after, "serviceUsed"), false,
    "planSessionUp 은 serviceUsed 를 만들지 않는다 -- 서버도 그 칸을 쓰지 않는다");
});

/* ── 강다경 건 ──────────────────────────────────────────────────────────── */

test("the real case: 100 sessions at 5,489,000 grows by 50 at 2,500,000", () => {
  /* 대표가 실제로 올린 건이다. 이 숫자가 틀리면 그 회원권의 모든 수업이
     틀린 단가로 기록된다. */
  const existing = pass({
    totalSessions: 100, serviceSessions: 0, contractPrice: 5489000,
    remainingCount: 56, baseUnitPrice: 54890,
  });
  const { after } = planSessionUp({ pass: existing, addSessions: 50, addPrice: 2500000 });

  assert.equal(after.totalSessions, 150);
  assert.equal(after.remainingCount, 106);
  assert.equal(after.contractPrice, 7989000);
  // 7,989,000 ÷ 150 = 53,260
  assert.equal(after.baseUnitPrice, 53260);
});

/* ── 막는 것 ────────────────────────────────────────────────────────────── */

test("an ended pass cannot grow", () => {
  /* 끝난 계약을 되살리면 그 사이의 만료·소진이 없던 일이 된다. 늘리려면 새로
     발급하는 것이 맞다. */
  assert.equal(
    sessionUpError({ pass: pass({ status: "cancelled" }), addSessions: 10, addPrice: 100 }),
    SESSION_UP_ERROR.NOT_ACTIVE,
  );
  assert.equal(
    sessionUpError({ pass: pass({ status: "expired" }), addSessions: 10, addPrice: 100 }),
    SESSION_UP_ERROR.NOT_ACTIVE,
  );
});

test("zero or broken numbers are refused with their own code", () => {
  /* 서로 다른 원인이 같은 문구로 끝나면 안 된다. 무엇을 고쳐야 하는지
     화면이 말할 수 있어야 한다. */
  const active = pass();
  assert.equal(sessionUpError({ pass: active, addSessions: 0, addPrice: 100 }), SESSION_UP_ERROR.SESSIONS_REQUIRED);
  assert.equal(sessionUpError({ pass: active, addSessions: -3, addPrice: 100 }), SESSION_UP_ERROR.SESSIONS_REQUIRED);
  assert.equal(sessionUpError({ pass: active, addSessions: 1.5, addPrice: 100 }), SESSION_UP_ERROR.SESSIONS_REQUIRED);
  assert.equal(sessionUpError({ pass: active, addSessions: 10, addPrice: -1 }), SESSION_UP_ERROR.PRICE_INVALID);
  assert.equal(sessionUpError({ pass: active, addSessions: 10, addPrice: "삼십만" }), SESSION_UP_ERROR.PRICE_INVALID);
  assert.equal(
    sessionUpError({ pass: active, addSessions: 10, addPrice: 100, addService: -1 }),
    SESSION_UP_ERROR.SERVICE_INVALID,
  );
});

test("a free session up passes: 0 won is a price, not a missing one", () => {
  /* 0원 세션업은 서비스만 얹는 일이다. 금액이 비어 있는 것과 다르다. */
  assert.equal(sessionUpError({ pass: pass(), addSessions: 0, addPrice: 0, addService: 1 }),
    SESSION_UP_ERROR.SESSIONS_REQUIRED);
  assert.equal(sessionUpError({ pass: pass(), addSessions: 1, addPrice: 0 }), "");
});

test("every refusal code has a sentence that says what to fix", () => {
  /* 코드 없는 "할 수 없습니다" 를 남기지 않는다. 코드만 남겨도 대표는 아무것도
     할 수 없다 -- 고칠 방법까지 적혀야 한다. */
  for (const code of Object.values(SESSION_UP_ERROR)) {
    assert.equal(typeof SESSION_UP_ERROR_LABEL[code], "string", `${code} 의 문구가 없다`);
    assert.ok(SESSION_UP_ERROR_LABEL[code].length > 0, `${code} 의 문구가 비었다`);
  }
});

/* ── 단가와 이력 줄 ─────────────────────────────────────────────────────── */

test("an unreadable contract price gives null, never zero", () => {
  /* Number(null) 은 0 이다. 0 을 단가로 쓰면 그 회원권의 모든 수업이
     무보수로 기록되고, 원장은 append-only 라 고칠 수 없다. */
  assert.equal(sessionUpUnitPrice(null, 10), null);
  assert.equal(sessionUpUnitPrice(undefined, 10), null);
  assert.equal(sessionUpUnitPrice("", 10), null);
  assert.equal(sessionUpUnitPrice(1000000, 0), null);
  assert.equal(sessionUpUnitPrice(1000000, 10), 100000);
});

test("the history line says what grew from where", () => {
  /* "세션업" 만 적으면 반년 뒤 "왜 150회냐" 에 답할 것이 없다. */
  assert.equal(sessionUpLabel({ addedSessions: 50, fromTotalSessions: 20 }), "세션업 20→70회");
  // 옛 항목에는 fromTotalSessions 가 없다. 빈 줄을 내지 않는다.
  assert.equal(sessionUpLabel({ addedSessions: 50 }), "세션업 +50회");
  assert.equal(sessionUpLabel({}), "세션업");
});

/* ── 디오사 ─────────────────────────────────────────────────────────────── */

test("session up works on a diosa pass just like a PT one", () => {
  /* 세션업은 카테고리를 보지 않는다 -- 회차와 금액만 센다. 그래서 디오사에도
     그대로 돈다. 보지 않는다는 사실 자체를 고정해 둔다: 나중에 카테고리별
     분기가 생기면 디오사가 조용히 빠진다. */
  const diosaA = pass({
    category: "diosa_a", totalSessions: 20, serviceSessions: 0,
    contractPrice: 880000, baseUnitPrice: 44000, remainingCount: 12,
  });
  const { after } = planSessionUp({ pass: diosaA, addSessions: 10, addPrice: 440000 });

  assert.equal(after.totalSessions, 30);
  assert.equal(after.remainingCount, 22);
  assert.equal(after.contractPrice, 1320000);
  // 1,320,000 ÷ 30 = 44,000. 회당 결제 금액은 그대로다.
  assert.equal(after.baseUnitPrice, 44000);
  assert.equal(sessionUpError({ pass: diosaA, addSessions: 10, addPrice: 440000 }), "");
});
