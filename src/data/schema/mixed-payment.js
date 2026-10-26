/**
 * 복합결제 — 비고에 적힌 글자를 수단별 금액으로.
 *
 * ── 왜 글자를 읽는가 ──
 * 이관 엑셀의 결제 내역은 칸이 아니라 문장이다. 대표가 몇 년에 걸쳐 적어 온
 * 것이고, 그 글자에만 "카드 50만 현금 30만" 이 남아 있다. 칸으로 다시 적게
 * 하면 수천 줄을 사람이 옮겨야 하고, 옮기는 동안 숫자가 틀린다.
 *
 * ── 못 읽어도 막지 않는다 (2026-10-27 대표 결정) ──
 * 읽지 못한 줄은 **원문을 그대로 들고 올라간다.** 거부하면 그 회원권이
 * 아예 없는 것이 되고, 회원은 다음 수업에서 "회원권이 없다" 를 만난다.
 * 대신 "복합결제 금액 확인 필요" 로 표시해 대표가 나중에 그 줄만 본다.
 *
 * ── 이름 판정의 순서가 중요하다 ──
 * 바우처·제로페이를 **먼저** 본다. "평생교육바우처" 는 바우처이고, 그 뒤에
 * 카드를 보면 "개인카드" 가 카드로 잡힌다. 순서를 바꾸면 "바우처카드" 같은
 * 글자가 엉뚱한 칸으로 간다.
 */

import { MIXED_PAYMENT_PARTS, PAYMENT_METHOD } from "./constants.js";

/** 만 = 10,000. 대표가 적는 단위다. */
export const WON_PER_MAN = 10000;

/**
 * 이름 → 결제 수단. 위에서부터 보고 **처음 걸리는 것**이 답이다.
 *
 * 제로페이와 바우처가 기타결제로 접힌 뒤에도 글자는 그대로 남아 있다
 * (2026-10-27). 원문은 paymentNote 로 따로 간다.
 */
/** @type {ReadonlyArray<[RegExp, string]>} */
const NAME_RULES = Object.freeze([
  [/바우처|제로페이/, PAYMENT_METHOD.OTHER],
  [/카드/, PAYMENT_METHOD.CARD],
  [/현금/, PAYMENT_METHOD.CASH],
  [/계좌|이체|무통장|입금/, PAYMENT_METHOD.TRANSFER],
]);

/** @param {string} name @returns {string} 못 읽으면 빈 문자열 */
export function methodOfPaymentName(name) {
  const text = String(name ?? "").trim();
  if (!text) return "";
  for (const [pattern, method] of NAME_RULES) {
    if (pattern.test(text)) return method;
  }
  return "";
}

/**
 * 이 글자가 **이름 대는 수단들**. 금액이 없어도 센다.
 *
 * 결제수단 칸에 "현금/카드" 라고만 적힌 행이 있다. 금액은 비고에 있고 칸에는
 * 이름만 있다 -- 금액을 요구하면 그 행이 "목록에 없는 값" 으로 거부되고,
 * 대표는 같은 글자를 옮겨 적어 다시 올려야 한다.
 *
 * @param {string} text @returns {Array<string>} 나온 순서대로, 중복 없이
 */
export function methodsNamedIn(text) {
  const found = [];
  for (const piece of String(text ?? "").split(/[\s/+,·|]+/)) {
    const method = methodOfPaymentName(piece.replace(/[\d,.]+(만원|만|원)?/g, ""));
    if (method && !found.includes(method)) found.push(method);
  }
  return found;
}

/* 이름 + 숫자 + (단위). 이름에서 구분자와 숫자를 뺀다 -- 빼지 않으면
   "현금500만/카드50만" 의 이름이 통째로 한 덩어리가 된다. */
const TOKEN = /([^\d\s/+,·|]+)?\s*(\d[\d,]*(?:\.\d+)?)\s*(만원|만|원)?/g;

/**
 * 비고 한 줄을 수단별 금액으로.
 *
 * 단위가 없으면 **원으로 읽는다.** 짐작해서 10,000 을 곱하면 5만 원짜리가
 * 5억이 되고, 그 숫자는 공급가액을 거쳐 부원장 급여에 박힌다 -- 틀릴 때
 * 작게 틀리는 쪽을 고른다. 합이 계약 금액과 어긋나면 어차피 확인 표시가
 * 붙으므로 대표가 그 줄을 본다.
 *
 * @param {string} text
 * @returns {{
 *   parts: Record<string, number>, total: number,
 *   methodCount: number, unknownNames: Array<string>, ok: boolean,
 * }}
 */
export function parseMixedPayment(text) {
  /** @type {Record<string, number>} */
  const parts = {};
  for (const part of MIXED_PAYMENT_PARTS) parts[part] = 0;
  const unknownNames = [];
  const seen = new Set();

  const source = String(text ?? "");
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    const [, rawName, rawAmount, unit] = match;
    const name = String(rawName ?? "").trim();
    /* 이름 없는 숫자는 버린다. 어느 칸으로 가야 하는지 모르는 돈이고,
       한 칸에 몰아넣으면 그 칸의 부가세 판정이 통째로 틀린다. */
    if (!name) continue;
    const amount = Number(String(rawAmount).replaceAll(",", ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const method = methodOfPaymentName(name);
    if (!method) { unknownNames.push(name); continue; }
    const won = unit === "만" || unit === "만원" ? Math.round(amount * WON_PER_MAN) : Math.round(amount);
    parts[method] += won;
    seen.add(method);
  }

  const total = MIXED_PAYMENT_PARTS.reduce((sum, part) => sum + parts[part], 0);
  return {
    parts,
    total,
    methodCount: seen.size,
    unknownNames,
    /* 읽었다고 말할 수 있는 조건: 금액이 하나라도 잡혔고, 못 읽은 이름이
       없다. 둘 중 하나라도 어긋나면 대표가 그 줄을 봐야 한다. */
    ok: total > 0 && unknownNames.length === 0,
  };
}
