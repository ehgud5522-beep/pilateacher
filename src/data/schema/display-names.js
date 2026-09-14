/**
 * 저장값 → 화면 표시 문구.
 *
 * constants.js 와 나눠 둔다. 저장값은 규칙·인덱스·이미 저장된 문서가 걸려 있어
 * 함부로 못 바꾸지만 표시 문구는 언제든 바뀐다. 한 파일에 두면 문구를 고치다
 * 저장값을 건드리기 쉽다.
 *
 * 표시명이 없는 값은 저장값을 그대로 보여준다. 목록에 없는 값이 화면에서 빈칸이
 * 되면 무엇이 잘못됐는지 알 수 없기 때문이다.
 */

import { CLIENT_STATUS, MEMBERSHIP_STATUS, PAY_CATEGORY, PAYMENT_METHOD, PRODUCT_STATUS, SESSION_TYPE } from "./constants.js";

export const SESSION_TYPE_LABELS = Object.freeze({
  [SESSION_TYPE.PT_1_1]: "1:1",
  [SESSION_TYPE.PT_2_1]: "2:1",
});

export const PAY_CATEGORY_LABELS = Object.freeze({
  [PAY_CATEGORY.PT_1_1_NEW]: "1:1 신규",
  [PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT]: "1:1 재등록(이벤트)",
  [PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL]: "1:1 재등록(정상)",
  [PAY_CATEGORY.PT_2_1_NEW]: "2:1 신규",
  [PAY_CATEGORY.PT_2_1_REPURCHASE]: "2:1 재등록",
  [PAY_CATEGORY.SERVICE]: "서비스",
  [PAY_CATEGORY.LETMEIN]: "렛미인",
  [PAY_CATEGORY.ETC]: "기타",
});

export const CLIENT_STATUS_LABELS = Object.freeze({
  [CLIENT_STATUS.ACTIVE]: "운영중",
  [CLIENT_STATUS.HOLD]: "일시중지",
  [CLIENT_STATUS.ENDED]: "종료",
  // 옮겨온 데이터만 갖는 값이다. 등록 화면은 만들지 않지만 목록에는 나타날 수
  // 있으므로 문구를 준다 -- 저장값이 그대로 보이면 회원 카드가 영어로 깨진다.
  [CLIENT_STATUS.DELETED]: "삭제됨",
  [CLIENT_STATUS.INACTIVE]: "비활성",
});

export const PRODUCT_STATUS_LABELS = Object.freeze({
  [PRODUCT_STATUS.ACTIVE]: "운영중",
  [PRODUCT_STATUS.ARCHIVED]: "종료",
});

export const PAYMENT_METHOD_LABELS = Object.freeze({
  [PAYMENT_METHOD.CARD]: "카드",
  [PAYMENT_METHOD.CASH]: "현금",
  [PAYMENT_METHOD.TRANSFER]: "계좌이체",
  [PAYMENT_METHOD.ZEROPAY]: "제로페이",
  [PAYMENT_METHOD.VOUCHER]: "바우처",
});

export const MEMBERSHIP_STATUS_LABELS = Object.freeze({
  [MEMBERSHIP_STATUS.ACTIVE]: "활성",
  [MEMBERSHIP_STATUS.INVITED]: "초대됨",
  [MEMBERSHIP_STATUS.SUSPENDED]: "정지",
  [MEMBERSHIP_STATUS.REVOKED]: "해지",
});

/**
 * 수업 형태별로 고를 수 있는 급여 카테고리. firestore.foundation.rules 의
 * products create 조건이 같은 조합을 강제한다 — 화면에서 못 고르게 막는 것과
 * 규칙이 거부하는 것이 어긋나면 안 된다.
 *
 * 서비스와 기타는 수업 형태와 무관하게 붙고, 렛미인은 1:1 전용이다.
 */
export const PAY_CATEGORIES_BY_SESSION_TYPE = Object.freeze({
  [SESSION_TYPE.PT_1_1]: Object.freeze([
    PAY_CATEGORY.PT_1_1_NEW,
    PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
    PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL,
    PAY_CATEGORY.SERVICE,
    PAY_CATEGORY.LETMEIN,
    PAY_CATEGORY.ETC,
  ]),
  [SESSION_TYPE.PT_2_1]: Object.freeze([
    PAY_CATEGORY.PT_2_1_NEW,
    PAY_CATEGORY.PT_2_1_REPURCHASE,
    PAY_CATEGORY.SERVICE,
    PAY_CATEGORY.ETC,
  ]),
});

/**
 * @param {Record<string, string>} labels
 * @param {unknown} value
 */
export function labelOf(labels, value) {
  const key = String(value ?? "");
  return labels[key] ?? key;
}

/** @param {string} sessionType */
export function payCategoriesFor(sessionType) {
  return PAY_CATEGORIES_BY_SESSION_TYPE[String(sessionType ?? "")] ?? [];
}
