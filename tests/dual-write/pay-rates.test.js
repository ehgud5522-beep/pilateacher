import assert from "node:assert/strict";
import test from "node:test";
import { PAY_CATEGORY } from "../../src/data/schema/constants.js";
import {
  PAY_RATES, UNIT_PRICE_SOURCE, defaultUnitPriceFor, requiresFullRoomRate,
  requiresManualUnitPrice, resolveUnitPrice, unitPriceSourceFor,
} from "../../src/data/schema/pay-rates.js";

/** 강사와 무관하게 고정된 일곱. 확정된 표 그대로다. */
const FIXED = Object.freeze({
  [PAY_CATEGORY.PT_1_1_NEW]: 25000,
  [PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT]: 30000,
  [PAY_CATEGORY.PT_2_1_NEW]: 30000,
  [PAY_CATEGORY.PT_2_1_REPURCHASE]: 35000,
  [PAY_CATEGORY.SERVICE]: 10000,
  [PAY_CATEGORY.LETMEIN]: 28000,
});

test("every pay category has a decided source", () => {
  // 어느 쪽에도 속하지 않는 카테고리는 화면에서 조용히 0원이 되거나 발급이 막힌다.
  for (const category of Object.values(PAY_CATEGORY)) {
    const sources = Object.values(UNIT_PRICE_SOURCE).map(String);
    assert.ok(sources.includes(unitPriceSourceFor(category)), `${category} 의 단가 출처가 없다`);
  }
});

test("the table holds exactly the fixed categories", () => {
  assert.deepEqual(Object.keys(PAY_RATES).sort(), Object.keys(FIXED).sort());
  for (const [category, rate] of Object.entries(FIXED)) {
    assert.equal(defaultUnitPriceFor(category), rate, category);
    assert.equal(unitPriceSourceFor(category), UNIT_PRICE_SOURCE.TABLE, category);
  }
});

test("only the repurchase-normal line comes from the instructor", () => {
  assert.equal(unitPriceSourceFor(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL), UNIT_PRICE_SOURCE.FULL_ROOM_RATE);
  assert.equal(requiresFullRoomRate(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL), true);
  for (const category of Object.keys(FIXED)) {
    assert.equal(requiresFullRoomRate(category), false, `${category} 가 강사별로 갈리면 안 된다`);
  }
  assert.equal(requiresFullRoomRate(PAY_CATEGORY.ETC), false);
});

test("etc is the only line a person types", () => {
  assert.equal(requiresManualUnitPrice(PAY_CATEGORY.ETC), true);
  for (const category of [...Object.keys(FIXED), PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL]) {
    assert.equal(requiresManualUnitPrice(category), false, category);
  }
});

/* 여기가 이 파일의 핵심이다. 풀방금액이 있다고 다른 카테고리 단가가 따라
   움직이면, 이벤트페이를 받아야 할 수업이 강사마다 다른 금액으로 기록된다. */
test("a full-room rate never moves a fixed category", () => {
  for (const [category, rate] of Object.entries(FIXED)) {
    for (const fullRoomRate of [undefined, null, 0, 1, 45000, 999999, "45000"]) {
      assert.equal(
        resolveUnitPrice(category, { fullRoomRate }),
        rate,
        `${category} 가 풀방금액 ${fullRoomRate} 에 흔들렸다`,
      );
    }
  }
});

test("an event repurchase pays the set amount even to a full-room instructor", () => {
  // 확정된 규칙 중 가장 틀리기 쉬운 줄이라 따로 못을 박는다.
  assert.equal(resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT, { fullRoomRate: 45000 }), 30000);
});

test("a fixed category ignores a typed unit price too", () => {
  for (const [category, rate] of Object.entries(FIXED)) {
    assert.equal(resolveUnitPrice(category, { unitPrice: 999 }), rate, category);
  }
});

test("repurchase-normal takes the instructor's own rate", () => {
  assert.equal(resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: 45000 }), 45000);
  assert.equal(resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: "45000" }), 45000);
  // 같은 카테고리라도 강사가 다르면 값이 다르다. 그것이 이 줄의 전부다.
  assert.notEqual(
    resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: 45000 }),
    resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: 50000 }),
  );
});

test("repurchase-normal refuses a missing or zero rate", () => {
  /* 0 을 받아들이면 그 강사의 재등록 수업이 통째로 무보수로 기록되고, 원장은
     append-only 라 고칠 수 없다. */
  for (const blank of [undefined, null, "", "   "]) {
    assert.throws(
      () => resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: blank }),
      /Missing fullRoomRate/,
      JSON.stringify(blank),
    );
  }
  for (const zero of [0, "0"]) {
    assert.throws(
      () => resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: zero }),
      /Missing fullRoomRate/,
      JSON.stringify(zero),
    );
  }
});

test("repurchase-normal refuses a nonsense rate differently", () => {
  // 비어 있는 것과 잘못 적은 것은 사용자가 할 일이 다르다.
  for (const bad of [-1, 1.5, "abc", "-1"]) {
    assert.throws(
      () => resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { fullRoomRate: bad }),
      /Invalid fullRoomRate/,
      JSON.stringify(bad),
    );
  }
});

test("repurchase-normal does not fall back to a typed unit price", () => {
  // 풀방금액이 없을 때 조용히 다른 값을 쓰면 잘못된 금액이 원장에 박힌다.
  assert.throws(
    () => resolveUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL, { unitPrice: 31000 }),
    /Missing fullRoomRate/,
  );
});

test("etc takes the entered number, blank refused, zero allowed", () => {
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, { unitPrice: 31000 }), 31000);
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, { unitPrice: " 31000 " }), 31000);
  // 0원짜리 기타 항목은 실제로 있을 수 있다. 다만 빈 칸과 구분되어야 한다.
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, { unitPrice: 0 }), 0);
  for (const blank of ["", "   ", null, undefined]) {
    assert.throws(() => resolveUnitPrice(PAY_CATEGORY.ETC, { unitPrice: blank }), /Missing unitPrice/, JSON.stringify(blank));
  }
  for (const bad of ["abc", -1, 1.5]) {
    assert.throws(() => resolveUnitPrice(PAY_CATEGORY.ETC, { unitPrice: bad }), /Invalid unitPrice/, JSON.stringify(bad));
  }
});

test("etc ignores a full-room rate", () => {
  assert.throws(
    () => resolveUnitPrice(PAY_CATEGORY.ETC, { fullRoomRate: 45000 }),
    /Missing unitPrice/,
    "기타는 강사 단가를 쓰지 않는다",
  );
});

test("an unknown category is not silently free", () => {
  assert.equal(defaultUnitPriceFor("made-up"), null);
  assert.equal(unitPriceSourceFor("made-up"), UNIT_PRICE_SOURCE.MANUAL);
  assert.throws(() => resolveUnitPrice("made-up", {}), /Missing unitPrice/);
});
