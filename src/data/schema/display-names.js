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
import {
  NEW_TO_INSTRUCTOR_THRESHOLD, PAID_SERVICE_SESSIONS_PER_PASS, PRICING_RULE,
} from "./deduction-pricing.js";

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

/**
 * 왜 이 금액인가. 원장 항목의 rule 을 한 줄로 읽는다.
 *
 * 강사가 급여 화면에서 "이 수업은 왜 25,000 이지"를 묻지 않아도 되게 하는 것이
 * 이 표의 목적이다. 같은 회원권 안에서도 회차마다 답이 달라서, 금액만 보면
 * 계산이 틀린 것처럼 보인다.
 *
 * 숫자를 문구에 직접 적지 않는다. 기준이 바뀌면 화면만 옛말을 하게 된다.
 *
 * Keep in sync with PRICING_RULE in deduction-pricing.js.
 */
export const PRICING_RULE_LABELS = Object.freeze({
  [PRICING_RULE.SERVICE_ALREADY_USED]: `서비스 ${PAID_SERVICE_SESSIONS_PER_PASS + 1}회차 — 센터 지원 소진`,
  [PRICING_RULE.DEPUTY_DIRECTOR]: "부원장 5:5",
  [PRICING_RULE.HANDED_OVER]: "인수인계 — 신규 단가",
  [PRICING_RULE.NEW_TO_INSTRUCTOR]: `누적 ${NEW_TO_INSTRUCTOR_THRESHOLD}회 미만 — 신규 단가`,
  [PRICING_RULE.BASE_CATEGORY]: "기준 단가",
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

/* ── 표시 문구 → 저장값 ────────────────────────────────────────────────────
   이관 CSV 는 사람이 읽는 한글로 채워진다. 역방향 표를 따로 만들면 위의 표와
   어긋나는 날이 오므로, 같은 표를 뒤집어 쓴다.

   별칭은 여기에만 둔다. 실무에서 쓰는 축약형("계좌")이 표시 문구
   ("계좌이체")와 다를 수 있는데, 그 차이를 파서가 알 이유는 없다.
   ────────────────────────────────────────────────────────────────────────── */

const invert = (labels) => Object.fromEntries(
  Object.entries(labels).map(([value, label]) => [label, value]),
);

/** 공백과 괄호 앞뒤 차이를 지운다. 사람이 채운 칸은 반드시 흔들린다. */
const normalizeLabel = (value) => String(value ?? "").replace(/\s+/g, "");

const withAliases = (labels, aliases = {}) => {
  const table = {};
  for (const [label, value] of Object.entries(invert(labels))) table[normalizeLabel(label)] = value;
  for (const [label, value] of Object.entries(aliases)) table[normalizeLabel(label)] = value;
  return Object.freeze(table);
};

export const PAY_CATEGORY_BY_LABEL = withAliases(PAY_CATEGORY_LABELS, {
  // 확정본이 쓰는 긴 이름들. 상품 이름이 아니라 카테고리를 가리킨다.
  "1:1 재등록(고정페이 이벤트)": PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT,
  "1:1 재등록(정상단가)": PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL,
});

export const PAYMENT_METHOD_BY_LABEL = withAliases(PAYMENT_METHOD_LABELS, {
  계좌: PAYMENT_METHOD.TRANSFER,
  이체: PAYMENT_METHOD.TRANSFER,
});

/**
 * 한글 라벨을 저장값으로. 목록에 없으면 null 이다 -- 추측하지 않는다.
 * 잘못 추측한 카테고리는 그 회원권의 모든 차감 단가를 틀리게 만든다.
 *
 * @param {Record<string, string>} table
 * @param {unknown} label
 * @returns {string | null}
 */
export function valueOfLabel(table, label) {
  const key = normalizeLabel(label);
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}
