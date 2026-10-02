import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  needsFix, planServiceSessionFix, serviceUsedFor, sessionsInName, unitPriceFor,
} = require("../../functions/src/service-session-fix.js");

/* ── 상품명에서 판 횟수를 읽는다 ──────────────────────────────────────── */

test("상품명의 마지막 숫자가 판 횟수다", () => {
  assert.equal(sessionsInName("깍두기 40회e"), 40);
  assert.equal(sessionsInName("30회 2차"), 30);
  assert.equal(sessionsInName("24회 렛미인e"), 24);
  // 세션업은 뒤쪽이 실제로 판 횟수다.
  assert.equal(sessionsInName("2:1 PT 33회 ->100회 세션업"), 100);
  assert.equal(sessionsInName("깍두기"), null, "숫자가 없으면 맞혀 보지 않는다");
  assert.equal(sessionsInName(""), null);
});

/* ── 대상 판정 ────────────────────────────────────────────────────────── */

test("상품명 숫자 + 서비스 = 총세션인 회원권만 고친다", () => {
  /* 그 조건이 곧 증상이다. 이름으로 목록을 박지 않는 이유이기도 하다 --
     박아 두면 열한 번째가 있어도 영영 모른다. */
  assert.equal(needsFix({ productId: "깍두기 40회e", totalSessions: 43, serviceSessions: 3 }), true);
  assert.equal(needsFix({ productId: "30회 2차", totalSessions: 34, serviceSessions: 4 }), true);
  assert.equal(needsFix({ productId: "50회", totalSessions: 51, serviceSessions: 1 }), true);

  assert.equal(needsFix({ productId: "깍두기 40회e", totalSessions: 40, serviceSessions: 3 }), false, "이미 맞다");
  assert.equal(needsFix({ productId: "50회", totalSessions: 51, serviceSessions: 0 }), false, "서비스가 없다");
  assert.equal(needsFix({ productId: "깍두기", totalSessions: 43, serviceSessions: 3 }), false, "숫자가 없다");
});

/* ── 쓴 서비스 ────────────────────────────────────────────────────────── */

test("쓴 횟수에서 serviceUsed 가 정해진다 -- 지점으로 가르지 않는다", () => {
  /* 서비스부터 쓰는 규칙이라 이렇게 정해진다. 이관 전에 다 쓰신 분은 자연히
     서비스 개수와 같아지고, 한 번도 안 쓰신 분은 0 이 된다. */
  // 반송 — 깍두기 40회 + 서비스 3, 잔여 10 → 33회 썼으니 서비스는 다 썼다
  assert.equal(serviceUsedFor({ totalSessions: 40, serviceSessions: 3, remainingCount: 10 }), 3);
  // 율하 — 50회 + 서비스 1, 잔여 51 → 한 번도 안 썼다
  assert.equal(serviceUsedFor({ totalSessions: 50, serviceSessions: 1, remainingCount: 51 }), 0);
  // 중간 — 30회 + 서비스 2, 잔여 31 → 한 회 썼고 그것이 서비스다
  assert.equal(serviceUsedFor({ totalSessions: 30, serviceSessions: 2, remainingCount: 31 }), 1);
  // 잔여가 총보다 크면 음수로 가지 않는다
  assert.equal(serviceUsedFor({ totalSessions: 30, serviceSessions: 2, remainingCount: 99 }), 0);
});

/* ── 회당 금액 ────────────────────────────────────────────────────────── */

test("총세션이 바뀌면 분모가 바뀐다 -- 계약 금액은 그대로다", () => {
  assert.equal(unitPriceFor(4000000, 40), 100000);
  assert.equal(unitPriceFor(4000000, 43), 93023, "고치기 전에는 낮게 박혀 있었다");
  assert.equal(unitPriceFor(0, 40), 0);
  assert.equal(unitPriceFor(4000000, 0), null, "0 으로 나누지 않는다");
  assert.equal(unitPriceFor(null, 40), null, "계약 금액을 못 읽으면 건드리지 않는다");
});

/* ── 계획 ─────────────────────────────────────────────────────────────── */

const fakeFirestore = (passes) => ({
  collection: () => ({
    doc: () => ({
      collection: () => ({
        get: async () => ({
          docs: passes.map((pass) => ({ id: pass.id, data: () => pass })),
        }),
      }),
    }),
  }),
});

const pass = (overrides = {}) => ({
  id: "csv_csv_01011112222_1", clientId: "csv_01011112222",
  productId: "깍두기 40회e", totalSessions: 43, serviceSessions: 3,
  serviceUsed: 0, remainingCount: 10, contractPrice: 4000000, baseUnitPrice: 93023,
  ...overrides,
});

test("계획은 바뀔 값을 전후로 보여주고 아무것도 쓰지 않는다", async () => {
  const plan = await planServiceSessionFix(fakeFirestore([pass()]), { organizationId: "center-a" });
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.rows[0].before, {
    totalSessions: 43, serviceSessions: 3, serviceUsed: 0, baseUnitPrice: 93023, remainingCount: 10,
  });
  assert.deepEqual(plan.rows[0].after, {
    totalSessions: 40, serviceSessions: 3, serviceUsed: 3, baseUnitPrice: 100000, remainingCount: 10,
  });
});

test("남은횟수는 바뀌지 않는다 -- 회원과 합의한 숫자다", async () => {
  const plan = await planServiceSessionFix(fakeFirestore([pass({ remainingCount: 7 })]), { organizationId: "a" });
  assert.equal(plan.rows[0].before.remainingCount, 7);
  assert.equal(plan.rows[0].after.remainingCount, 7);
});

test("이관분이 아니면 건드리지 않는다", async () => {
  const plan = await planServiceSessionFix(
    fakeFirestore([pass({ id: "app-issued-1" })]), { organizationId: "a" },
  );
  assert.deepEqual(plan.rows, []);
});

test("이미 고쳐진 것은 다시 올리지 않는다 -- 두 번 눌러도 같다", async () => {
  const fixed = pass({ totalSessions: 40, serviceUsed: 3, baseUnitPrice: 100000 });
  const plan = await planServiceSessionFix(fakeFirestore([fixed]), { organizationId: "a" });
  assert.deepEqual(plan.rows, []);
});

test("율하처럼 서비스를 안 쓴 회원권은 serviceUsed 가 0 으로 남는다", async () => {
  const unused = pass({
    productId: "50회", totalSessions: 51, serviceSessions: 1, remainingCount: 51,
    contractPrice: 5000000, baseUnitPrice: 98039,
  });
  const plan = await planServiceSessionFix(fakeFirestore([unused]), { organizationId: "a" });
  assert.deepEqual(plan.rows[0].after, {
    totalSessions: 50, serviceSessions: 1, serviceUsed: 0, baseUnitPrice: 100000, remainingCount: 51,
  });
});

test("증상이 없는 회원권은 목록에 없다", async () => {
  const clean = pass({ productId: "40회", totalSessions: 40, serviceSessions: 0, serviceUsed: 0 });
  const plan = await planServiceSessionFix(fakeFirestore([clean]), { organizationId: "a" });
  assert.deepEqual(plan.rows, []);
});
