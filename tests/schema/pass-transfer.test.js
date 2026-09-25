import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_TRANSFER_NUDGE, TRANSFER_BLOCK, checkTransfer, transferPricing, transferableSessions,
} from "../../src/data/schema/pass-transfer.js";
import { deputyDirectorUnitPrice, netContractPriceFor } from "../../src/data/schema/deduction-pricing.js";

/**
 * 회원권 양도.
 *
 * 이 파일이 지키는 것은 하나다: **같은 계약의 회차는 누구에게 가든 같은
 * 급여여야 한다.** 회차를 쪼개면 분자와 분모가 각각 반올림되면서 부원장 단가가
 * 1원씩 어긋나는데, 원장은 append-only 라 나중에 고칠 수 없다.
 */

const pass = (overrides = {}) => ({
  id: "pass-1", organizationId: "center-a", clientId: "client-a",
  status: "active", totalSessions: 20, serviceSessions: 2, serviceUsed: 0,
  remainingCount: 22, contractPrice: 1300000, paymentMethod: "card",
  netContractPrice: netContractPriceFor(1300000, "card"),
  ...overrides,
});

/* ── 넘길 수 있는 회차 ───────────────────────────────────────────────── */

test("서비스 회차는 넘기지 못한다", () => {
  /* 센터가 얹어 준 것이라 회원 사이에서 오갈 물건이 아니다. 급여도 다르다 --
     서비스 차감은 회원권당 한 번만 돈이 나가고, 그 판단은 원본에 붙어 있다. */
  assert.equal(transferableSessions(pass()), 20, "22 중 서비스 2 를 뺀 20");
});

test("서비스를 이미 썼으면 그만큼은 유료 잔여다", () => {
  // 서비스를 먼저 쓴다. 2 중 1 을 썼으면 잔여 21 중 서비스는 1 만 남아 있다.
  assert.equal(transferableSessions(pass({ remainingCount: 21, serviceUsed: 1 })), 20);
  assert.equal(transferableSessions(pass({ remainingCount: 20, serviceUsed: 2 })), 20);
});

test("이미 쓴 회차는 넘길 수 없다", () => {
  assert.equal(transferableSessions(pass({ remainingCount: 8 })), 6, "8 중 서비스 2 를 뺀 6");
});

test("서비스 회차뿐이면 넘길 것이 없다", () => {
  assert.equal(transferableSessions(pass({ remainingCount: 2 })), 0);
});

/* ── 막는 자리 ───────────────────────────────────────────────────────── */

test("듀엣은 넘기지 못한다", () => {
  /* 계약서 하나에 회원이 둘이고, 한쪽이 제 몫이라 여기는 회차가 따로 없다. */
  const duet = pass({ clientIds: ["client-a", "client-b"] });
  assert.deepEqual(
    checkTransfer({ pass: duet, toClientId: "client-c", sessions: 5 }),
    { ok: false, code: TRANSFER_BLOCK.DUET },
  );
});

test("끝난 회원권은 넘기지 못한다", () => {
  for (const status of ["expired", "cancelled", "ended", ""]) {
    assert.equal(
      checkTransfer({ pass: pass({ status }), toClientId: "client-b", sessions: 1 }).code,
      TRANSFER_BLOCK.NOT_ACTIVE, status,
    );
  }
});

test("남은 유료 회차보다 많이 넘기지 못한다", () => {
  const result = checkTransfer({ pass: pass(), toClientId: "client-b", sessions: 21 });
  assert.equal(result.ok, false);
  assert.equal(result.code, TRANSFER_BLOCK.TOO_MANY);
  // 몇 회까지 되는지 함께 돌려준다 -- 화면이 "최대 20회" 라고 말할 수 있어야 한다.
  assert.equal(result.limit, 20);
});

test("0 회나 음수는 양도가 아니다", () => {
  for (const sessions of [0, -1, 1.5, NaN, "three", null]) {
    assert.equal(
      checkTransfer({ pass: pass(), toClientId: "client-b", sessions }).code,
      TRANSFER_BLOCK.TOO_FEW, String(sessions),
    );
  }
  // 화면의 입력칸은 문자열을 준다. 숫자로 읽히면 그것은 그 숫자다.
  assert.equal(checkTransfer({ pass: pass(), toClientId: "client-b", sessions: "3" }).ok, true);
});

test("자기 자신에게는 넘기지 못한다", () => {
  assert.equal(
    checkTransfer({ pass: pass(), toClientId: "client-a", sessions: 5 }).code,
    TRANSFER_BLOCK.SAME_CLIENT,
  );
  assert.equal(
    checkTransfer({ pass: pass(), toClientId: "  ", sessions: 5 }).code,
    TRANSFER_BLOCK.SAME_CLIENT,
  );
});

test("금액을 읽을 수 없으면 넘기지 못한다", () => {
  /* 급여 근거를 만들 수 없다. 지어내면 받는 회원의 수업 전체가 틀린 금액으로
     굳고, 원장은 고칠 수 없다. */
  const priceless = pass({ netContractPrice: undefined, contractPrice: undefined });
  assert.equal(
    checkTransfer({ pass: priceless, toClientId: "client-b", sessions: 5 }).code,
    TRANSFER_BLOCK.NO_PRICE,
  );
});

test("맞으면 회차를 그대로 돌려준다", () => {
  assert.deepEqual(
    checkTransfer({ pass: pass(), toClientId: "client-b", sessions: 5 }),
    { ok: true, sessions: 5 },
  );
});

/* ── 금액 ────────────────────────────────────────────────────────────── */

test("회차 비례로 나누고, 어긋나는 1원을 깎는다", () => {
  /* 130만 카드 20회에서 5회. 비례식은 32.5만이지만 그대로 두면 부원장 단가가
     29,546원이 되어 원본의 29,545원과 1원 어긋난다 -- 회차마다 1원이고
     원장은 고칠 수 없다. 1원을 깎으면 정확히 같아진다. */
  const priced = transferPricing({ pass: pass(), sessions: 5 });
  assert.equal(priced.contractPrice, 324999);
  assert.equal(priced.nudge, -1);
  assert.equal(priced.sourceDeputyUnitPrice, 29545);
  assert.equal(priced.deputyUnitPrice, 29545);
  assert.equal(priced.paymentMethod, "card");
});

test("부가세를 새로 붙이지 않는다", () => {
  /* 원본이 카드였으면 받는 회원권도 카드다. 결제 수단을 바꾸면 공급가액이
     달라지고 부원장 단가가 통째로 움직인다. */
  const priced = transferPricing({ pass: pass(), sessions: 5 });
  assert.equal(priced.netContractPrice, netContractPriceFor(priced.contractPrice, "card"));
  assert.ok(priced.netContractPrice < priced.contractPrice, "카드는 부가세가 빠진다");

  const cash = transferPricing({ pass: pass({ paymentMethod: "cash", netContractPrice: 1300000 }), sessions: 5 });
  assert.equal(cash.netContractPrice, cash.contractPrice, "현금은 그대로다");
});

test("부원장 회당 단가가 원본과 같다", () => {
  /* 이 파일의 전부다. 같은 계약의 회차는 누구에게 가든 같은 급여여야 한다. */
  const source = pass();
  const priced = transferPricing({ pass: source, sessions: 7 });
  assert.equal(priced.deputyUnitPrice, priced.sourceDeputyUnitPrice);
  assert.equal(priced.exact, true);
  assert.equal(
    priced.sourceDeputyUnitPrice,
    deputyDirectorUnitPrice({ netContractPrice: source.netContractPrice, totalSessions: 20 }),
  );
});

test("맞으면 한 푼도 움직이지 않는다", () => {
  // 비례식이 이미 맞는 자리에서 굳이 보정하지 않는다.
  const priced = transferPricing({ pass: pass({ contractPrice: 2000000, netContractPrice: netContractPriceFor(2000000, "card") }), sessions: 10 });
  assert.equal(priced.nudge, 0);
  assert.equal(priced.contractPrice, 1000000);
});

test("어긋나면 2원 안에서 움직여 맞춘다", () => {
  /* 반올림이 만드는 오차만 움직인다. 더 열어 두면 계약 금액을 맞춰 쓰는
     자리가 되어 버린다. */
  assert.equal(MAX_TRANSFER_NUDGE, 2);

  let nudged = 0;
  for (let total = 1; total <= 40; total += 1) {
    for (let price = 100000; price <= 3000000; price += 37777) {
      for (const method of ["card", "cash"]) {
        const source = pass({
          totalSessions: total, serviceSessions: 0, serviceUsed: 0,
          remainingCount: total, contractPrice: price, paymentMethod: method,
          netContractPrice: netContractPriceFor(price, method),
        });
        for (const sessions of [1, 2, 3, Math.max(1, Math.floor(total / 2)), total]) {
          if (sessions > total) continue;
          const priced = transferPricing({ pass: source, sessions });
          assert.equal(
            priced.exact, true,
            `${method} ${price}원 ${total}회 중 ${sessions}회를 2원 안에서 못 맞췄다`,
          );
          assert.equal(priced.deputyUnitPrice, priced.sourceDeputyUnitPrice);
          assert.ok(Math.abs(priced.nudge) <= MAX_TRANSFER_NUDGE);
          if (priced.nudge !== 0) nudged += 1;
        }
      }
    }
  }
  // 대부분은 비례식만으로 맞는다. 보정이 늘 도는 것이라면 비례식이 틀린 것이다.
  assert.ok(nudged > 0, "보정이 한 번도 쓰이지 않았다 -- 표본이 이상하다");
});

test("1회만 넘겨도 단가가 같다", () => {
  /* 가장 쪼개지기 쉬운 자리다. 분모가 1 이라 반올림이 숨을 곳이 없다. */
  for (const price of [1000000, 1234567, 999999, 777777]) {
    for (const method of ["card", "cash"]) {
      const source = pass({
        totalSessions: 13, serviceSessions: 0, remainingCount: 13,
        contractPrice: price, paymentMethod: method,
        netContractPrice: netContractPriceFor(price, method),
      });
      const priced = transferPricing({ pass: source, sessions: 1 });
      assert.equal(priced.exact, true, `${method} ${price}`);
      assert.equal(priced.deputyUnitPrice, priced.sourceDeputyUnitPrice);
    }
  }
});

test("전부 넘기면 금액도 전부 간다", () => {
  const source = pass({ serviceSessions: 0, remainingCount: 20 });
  const priced = transferPricing({ pass: source, sessions: 20 });
  assert.equal(priced.contractPrice, source.contractPrice);
  assert.equal(priced.netContractPrice, source.netContractPrice);
});

test("읽을 수 없는 입력은 계산하지 않는다", () => {
  /* 지어낸 값으로 원장에 박는 것보다 멈추는 편이 낫다. */
  assert.throws(() => transferPricing({ pass: pass(), sessions: 0 }), /sessions/);
  assert.throws(() => transferPricing({ pass: pass({ totalSessions: 0 }), sessions: 1 }), /totalSessions/);
  assert.throws(
    () => transferPricing({ pass: pass({ netContractPrice: undefined, contractPrice: undefined }), sessions: 1 }),
    /netContractPrice/,
  );
});

/* ── 코드와 문구 ─────────────────────────────────────────────────────── */

test("막는 코드마다 사람 말이 있다", async () => {
  /* 코드가 하나 늘 때 문구가 빠지면 대표는 "처리하지 못했어요" 만 보게 된다.
     화면이 제 문구를 따로 만들지 않는 이유이기도 하다. */
  const { TRANSFER_BLOCK_LABEL } = await import("../../src/data/schema/pass-transfer.js");
  assert.deepEqual(
    Object.values(TRANSFER_BLOCK).sort(),
    Object.keys(TRANSFER_BLOCK_LABEL).sort(),
  );
});

test("모르는 코드도 숨기지 않는다", async () => {
  const { transferBlockLabel } = await import("../../src/data/schema/pass-transfer.js");
  // 코드 없는 "오류가 발생했습니다" 는 금지다.
  assert.match(transferBlockLabel({ code: "something_new" }), /코드 something_new/);
  assert.match(transferBlockLabel({}), /코드 unknown/);
});

test("회차가 모자랄 때는 몇 회까지인지 문구에 넣는다", async () => {
  const { transferBlockLabel } = await import("../../src/data/schema/pass-transfer.js");
  assert.equal(
    transferBlockLabel({ code: TRANSFER_BLOCK.TOO_MANY, limit: 6 }),
    "최대 6회까지 넘길 수 있습니다.",
  );
  // 숫자를 모르면 숫자 없는 문구로 내려간다 -- 지어내지 않는다.
  assert.match(transferBlockLabel({ code: TRANSFER_BLOCK.TOO_MANY }), /많이 넘길 수 없습니다/);
});
