import assert from "node:assert/strict";
import test from "node:test";
import {
  methodOfPaymentName, parseMixedPayment,
} from "../../src/data/schema/mixed-payment.js";

/* ── 대표가 실제로 적은 다섯 줄 ──────────────────────────────────────────
   2026-10-27 에 받은 예시 그대로다. 손으로 다듬지 않는다 -- 다듬으면 이
   테스트는 통과하는데 진짜 엑셀에서는 안 되는 상태가 된다. */
const EXAMPLES = [
  ["현금500만/카드50만", { cash: 5000000, card: 500000 }],
  ["카드 5.5만 현금 135만", { card: 55000, cash: 1350000 }],
  ["바우처 70만 + 카드 20만", { other: 700000, card: 200000 }],
  ["계좌이체10만,카드187만", { transfer: 100000, card: 1870000 }],
  ["평생교육바우처35만/개인카드20만", { other: 350000, card: 200000 }],
];

test("the five examples the owner gave all read, and read into the right columns", () => {
  for (const [text, expected] of EXAMPLES) {
    const parsed = parseMixedPayment(text);
    assert.ok(parsed.ok, text);
    for (const [part, amount] of Object.entries(expected)) {
      assert.equal(parsed.parts[part], amount, `${text} → ${part}`);
    }
    /* 적지 않은 칸은 0 이다. 지어내면 그 수단의 매출이 있지도 않은 만큼
       올라가고, 카드 칸이면 공급가액까지 틀린다. */
    for (const part of ["card", "transfer", "other", "cash"]) {
      if (part in expected) continue;
      assert.equal(parsed.parts[part], 0, `${text} → ${part} 는 비어 있어야 한다`);
    }
    const total = Object.values(expected).reduce((sum, amount) => sum + amount, 0);
    assert.equal(parsed.total, total, `${text} 합계`);
  }
});

test("voucher and zeropay land in 기타결제, not in a column of their own", () => {
  /* 2026-10-27 에 셋을 하나로 접었다. 이름은 여러 가지인데 가는 칸은 하나다. */
  for (const name of ["바우처", "평생교육바우처", "제로페이", "제로페이결제"]) {
    assert.equal(methodOfPaymentName(name), "other", name);
  }
});

test("a name is read by what it contains, so 개인카드 is still a card", () => {
  assert.equal(methodOfPaymentName("개인카드"), "card");
  assert.equal(methodOfPaymentName("법인카드"), "card");
  assert.equal(methodOfPaymentName("계좌"), "transfer");
  assert.equal(methodOfPaymentName("계좌이체"), "transfer");
  assert.equal(methodOfPaymentName("무통장입금"), "transfer");
  assert.equal(methodOfPaymentName("현금"), "cash");
  /* 바우처를 **먼저** 본다. 순서를 뒤집으면 "바우처카드" 가 카드로 잡힌다. */
  assert.equal(methodOfPaymentName("바우처카드"), "other");
  assert.equal(methodOfPaymentName("기프티콘"), "");
});

test("만 means ten thousand and nothing else is multiplied", () => {
  assert.equal(parseMixedPayment("카드 50만").parts.card, 500000);
  assert.equal(parseMixedPayment("카드 50만원").parts.card, 500000);
  /* 단위가 없으면 원으로 읽는다. 짐작해서 10,000 을 곱하면 5만 원짜리가
     5억이 되고, 그 숫자는 공급가액을 거쳐 급여에 박힌다. */
  assert.equal(parseMixedPayment("카드 500000").parts.card, 500000);
  assert.equal(parseMixedPayment("카드 500,000원").parts.card, 500000);
});

test("what cannot be read is reported, never guessed into a column", () => {
  const unknown = parseMixedPayment("기프티콘 30만 + 카드 20만");
  assert.deepEqual(unknown.unknownNames, ["기프티콘"]);
  assert.equal(unknown.parts.card, 200000, "읽은 것은 읽은 대로 담는다");
  assert.equal(unknown.ok, false, "대표가 이 줄을 봐야 한다");

  const empty = parseMixedPayment("");
  assert.equal(empty.ok, false);
  assert.equal(empty.total, 0);
  /* 이름 없는 숫자는 버린다. 어느 칸으로 가야 하는지 모르는 돈이다. */
  assert.equal(parseMixedPayment("300000").total, 0);
});

test("how many distinct methods a line names decides whether it is a mixed payment", () => {
  assert.equal(parseMixedPayment("카드 50만 현금 30만").methodCount, 2);
  // 같은 수단을 두 번 적으면 더해지고, 수단은 여전히 하나다.
  const twice = parseMixedPayment("카드 50만 + 카드 20만");
  assert.equal(twice.methodCount, 1);
  assert.equal(twice.parts.card, 700000);
});
