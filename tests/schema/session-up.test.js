import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_UP_ERROR, SESSION_UP_ERROR_LABEL, SESSION_UP_REASON_MAX,
  canOverrideSessionUpWindow, paidUsedOf, planSessionUp, sessionUpError, sessionUpLabel,
  sessionUpLimitOf, sessionUpUnitPrice, sessionUpWindowLabel, sessionUpWindowOf,
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
  /* 기본 fixture 는 20회권을 유료 14회 쓴 것이라 **이미 기간 밖**이다
     (6회차까지). 여기서 보는 것은 0원이 금액인가이므로, 기간 안의 회원권으로
     묻는다 -- 기간은 아래 "세션업 기간" 절에서 따로 본다. */
  assert.equal(sessionUpError({ pass: pass({ remainingCount: 18 }), addSessions: 1, addPrice: 0 }), "");
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
  // 기간 안의 디오사 회원권으로 묻는다 (유료 4회 사용 · 6회차까지).
  assert.equal(
    sessionUpError({ pass: { ...diosaA, remainingCount: 16 }, addSessions: 10, addPrice: 440000 }),
    "",
  );
});

/* ── 세션업 기간 (2026-10-27 대표 결정) ──────────────────────────────────

   거의 다 쓰고 나서 늘리는 것은 사실상 재등록이다. 그런데 세션업으로 하면
   회당 금액이 **옛 회차까지 합쳐** 다시 나뉘고(sessionUpUnitPrice), 이미
   확정된 차감은 그때 단가 그대로라 늘린 뒤의 단가만 낮아진 채 남는다 --
   강사의 남은 회차가 전부 그 단가다.

     총회차(서비스 제외) 10회 미만 → 3회차까지
     총회차(서비스 제외) 10회 이상 → 6회차까지

   사용은 **결제 회차 중 차감된 수**다. 서비스는 세지 않는다. */

/** 총 t회(서비스 s회) 중 잔여 r회. serviceUsed 를 주면 그것이 참이다. */
const used = (t, s, r, serviceUsed) => paidUsedOf({
  totalSessions: t, serviceSessions: s, remainingCount: r, serviceUsed,
});
const window = (t, s, r, serviceUsed) => sessionUpWindowOf({
  status: "active", totalSessions: t, serviceSessions: s, remainingCount: r, serviceUsed,
});

test("작은 회원권은 3회차까지, 10회 이상은 6회차까지", () => {
  assert.equal(sessionUpLimitOf({ totalSessions: 5 }), 3);
  assert.equal(sessionUpLimitOf({ totalSessions: 9 }), 3);
  // 10 은 "10회 이상" 쪽이다. 경계가 뒤집히면 10회권이 3회차에서 닫힌다.
  assert.equal(sessionUpLimitOf({ totalSessions: 10 }), 6);
  assert.equal(sessionUpLimitOf({ totalSessions: 100 }), 6);
  // 서비스는 크기를 정하지 않는다 -- 회원이 낸 돈이 아니다.
  assert.equal(sessionUpLimitOf({ totalSessions: 9, serviceSessions: 5 }), 3);
});

test("5회권: 3회 사용은 되고 4회 사용은 안 된다", () => {
  /* 대표가 적어 준 확인 목록 그대로다. 손으로 다듬지 않는다. */
  assert.equal(used(5, 0, 2), 3);
  assert.equal(window(5, 0, 2).open, true, "3회 사용 — 가능");

  assert.equal(used(5, 0, 1), 4);
  assert.equal(window(5, 0, 1).open, false, "4회 사용 — 불가");
});

test("10회권: 6회 사용은 되고 7회 사용은 안 된다", () => {
  assert.equal(used(10, 0, 4), 6);
  assert.equal(window(10, 0, 4).open, true, "6회 사용 — 가능");

  assert.equal(used(10, 0, 3), 7);
  assert.equal(window(10, 0, 3).open, false, "7회 사용 — 불가");
});

test("서비스 회차는 사용에 들어가지 않는다", () => {
  /* 서비스는 센터가 얹어 준 것이라 기간을 당길 이유가 없다. 섞어 세면
     서비스 2회를 먼저 쓴 10회권이 4회차에서 막힌다 -- 회원이 돈 주고 산
     회차는 아직 2회밖에 안 썼는데. */
  // 10회 + 서비스 2회, 서비스 2 + 유료 3 을 썼다 → 잔여 7.
  assert.equal(used(10, 2, 7, 2), 3);
  assert.equal(window(10, 2, 7, 2).open, true);

  /* serviceUsed 가 없는 옛 회원권은 역산한다 -- 서비스를 먼저 쓰므로
     (deduction-pricing) 같은 값이 나온다. pass-cards.js 의 remainingSplit 과
     같은 식이고, 갈라지면 카드의 "정규 잔여" 와 여기의 "사용" 이 더해서
     총회차가 안 된다. */
  assert.equal(used(10, 2, 7, undefined), 3);

  // 서비스만 쓴 상태. 유료는 한 회도 안 썼다.
  assert.equal(used(10, 2, 10, 2), 0);
  assert.equal(window(10, 2, 10, 2).left, 7, "지금 포함 7번의 수업 시점");
});

test("남은 회수는 지금을 포함해 센다 -- 1이면 지금이 마지막이다", () => {
  /* 화면이 1 일 때 강조한다. 0 을 "마지막" 으로 쓰면 "끝났다" 와 한 숫자로
     겹쳐서, 화면이 조건을 다시 쓰게 된다. */
  assert.equal(window(10, 0, 5).left, 2, "5회 사용 — 한 번 더 들어도 열려 있다");
  assert.equal(window(10, 0, 4).left, 1, "6회 사용 — 지금이 마지막");
  assert.equal(window(10, 0, 3).left, 0, "7회 사용 — 끝났다");

  assert.equal(sessionUpWindowLabel(window(10, 0, 4)), "세션업 가능 1회 남음");
  assert.equal(sessionUpWindowLabel(window(10, 0, 3)), "세션업 기간 종료");
});

test("이관분의 어긋난 숫자가 음수 사용으로 새지 않는다", () => {
  /* 총회차와 잔여가 따로 적혀 오는 행이 있다. 잔여가 총회차보다 크면 사용이
     음수가 되고, 화면에 "-3회 사용" 이 뜬다. */
  assert.equal(used(10, 0, 30), 0);
  assert.equal(used(10, 0, 0), 10);
  assert.equal(paidUsedOf(null), 0);
  assert.equal(paidUsedOf({}), 0);
});

test("기간이 지나면 FC매니저는 막히고 대표는 사유를 적는다", () => {
  const spent = pass({ totalSessions: 10, serviceSessions: 0, remainingCount: 3 });
  const ask = (extra) => sessionUpError({ pass: spent, addSessions: 10, addPrice: 500000, ...extra });

  // 역할이 없으면 못 넘는다. 모르는 사람에게 예외를 열어 주는 기본값은 없다.
  assert.equal(ask({}), SESSION_UP_ERROR.WINDOW_CLOSED);
  assert.equal(ask({ actorRole: "instructor" }), SESSION_UP_ERROR.WINDOW_CLOSED);
  // FC매니저는 사유를 적어 보내도 못 넘는다 -- 역할이 먼저다.
  assert.equal(ask({ actorRole: "manager", overrideReason: "회원 요청" }), SESSION_UP_ERROR.WINDOW_CLOSED);

  // 대표·총괄매니저는 사유가 있어야 넘는다.
  assert.equal(ask({ actorRole: "owner" }), SESSION_UP_ERROR.OVERRIDE_REASON_REQUIRED);
  assert.equal(ask({ actorRole: "owner", overrideReason: "   " }), SESSION_UP_ERROR.OVERRIDE_REASON_REQUIRED);
  assert.equal(ask({ actorRole: "owner", overrideReason: "회원 요청으로 추가 결제" }), "");
  assert.equal(ask({ actorRole: "area_manager", overrideReason: "대표 승인" }), "");

  assert.equal(
    ask({ actorRole: "owner", overrideReason: "가".repeat(SESSION_UP_REASON_MAX + 1) }),
    SESSION_UP_ERROR.OVERRIDE_REASON_TOO_LONG,
  );

  assert.equal(canOverrideSessionUpWindow("owner"), true);
  assert.equal(canOverrideSessionUpWindow("area_manager"), true);
  assert.equal(canOverrideSessionUpWindow("manager"), false);
  assert.equal(canOverrideSessionUpWindow(""), false);
});

test("숫자가 틀린 입력에는 숫자 이야기를 먼저 한다", () => {
  /* 기간부터 말하면 대표는 횟수를 0 으로 둔 채 사유만 적고 또 막힌다. */
  const spent = pass({ totalSessions: 10, serviceSessions: 0, remainingCount: 3 });
  assert.equal(
    sessionUpError({ pass: spent, addSessions: 0, addPrice: 100, actorRole: "owner" }),
    SESSION_UP_ERROR.SESSIONS_REQUIRED,
  );
  // 끝난 회원권은 기간을 따지기 전에 끝난 회원권이다.
  assert.equal(
    sessionUpError({ pass: { ...spent, status: "cancelled" }, addSessions: 10, addPrice: 100 }),
    SESSION_UP_ERROR.NOT_ACTIVE,
  );
});
