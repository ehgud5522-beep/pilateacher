import assert from "node:assert/strict";
import test from "node:test";
import { PAY_CATEGORY } from "../../src/data/schema/constants.js";
import {
  PAY_RATES, defaultUnitPriceFor, requiresManualUnitPrice, resolveUnitPrice,
} from "../../src/data/schema/pay-rates.js";

test("every pay category has an entry, priced or deliberately not", () => {
  // 표에서 빠진 카테고리는 화면에서 조용히 0원이 되거나 발급이 막힌다.
  for (const category of Object.values(PAY_CATEGORY)) {
    assert.ok(category in PAY_RATES, `${category} 가 단가표에 없다`);
  }
  assert.equal(Object.keys(PAY_RATES).length, Object.values(PAY_CATEGORY).length);
});

test("the table prices what it can", () => {
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.PT_1_1_NEW), 25000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT), 30000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.PT_2_1_NEW), 30000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.PT_2_1_REPURCHASE), 35000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.SERVICE), 10000);
  assert.equal(defaultUnitPriceFor(PAY_CATEGORY.LETMEIN), 28000);
});

test("two categories are for a person to answer, not the table", () => {
  // 강사별 풀방금액은 아직 미확정이고, etc 는 정의상 표 밖이다.
  assert.equal(requiresManualUnitPrice(PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL), true);
  assert.equal(requiresManualUnitPrice(PAY_CATEGORY.ETC), true);
  for (const priced of [
    PAY_CATEGORY.PT_1_1_NEW, PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
    PAY_CATEGORY.PT_2_1_NEW, PAY_CATEGORY.PT_2_1_REPURCHASE,
    PAY_CATEGORY.SERVICE, PAY_CATEGORY.LETMEIN,
  ]) {
    assert.equal(requiresManualUnitPrice(priced), false, priced);
  }
});

test("an unknown category is not silently free", () => {
  // 0 을 돌려주면 "무료"와 "아직 모른다"가 같은 값이 되어 물어보지 않고 발급된다.
  assert.equal(defaultUnitPriceFor("made-up"), null);
  assert.equal(requiresManualUnitPrice("made-up"), true);
  assert.equal(defaultUnitPriceFor(undefined), null);
});

test("a priced category ignores whatever the screen sends", () => {
  // 표가 값을 정해 주는 카테고리에서는 사람이 고칠 자리를 주지 않는다.
  assert.equal(resolveUnitPrice(PAY_CATEGORY.PT_1_1_NEW, 999), 25000);
  assert.equal(resolveUnitPrice(PAY_CATEGORY.PT_1_1_NEW, ""), 25000);
});

test("an unpriced category takes the entered number", () => {
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, 31000), 31000);
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, "31000"), 31000);
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, " 31000 "), 31000);
  // 0원짜리 항목은 실제로 있을 수 있다. 다만 빈 칸과 구분되어야 한다.
  assert.equal(resolveUnitPrice(PAY_CATEGORY.ETC, 0), 0);
});

test("a blank unit price is refused, never read as zero", () => {
  /* Number("") 는 0 이다. 빈 칸이 그대로 통과하면 아무도 묻지 않은 0원 발급이
     되고, 그 달 급여가 조용히 빈다. */
  for (const blank of ["", "   ", null, undefined]) {
    assert.throws(() => resolveUnitPrice(PAY_CATEGORY.ETC, blank), /Missing unitPrice/, JSON.stringify(blank));
  }
});

test("a nonsense unit price is refused and says so differently", () => {
  // 비어 있는 것과 잘못 적은 것은 사용자가 할 일이 다르다.
  for (const bad of ["abc", "-1", -1, 1.5, "1.5"]) {
    assert.throws(() => resolveUnitPrice(PAY_CATEGORY.ETC, bad), /Invalid unitPrice/, JSON.stringify(bad));
  }
});
