/**
 * 회원권 상품 목록을 읽을 수 있게 묶는다.
 *
 * ── 왜 묶는가 ──
 * 지점이 아홉이 되면 상품이 수십 줄이 된다. 한 줄로 늘어놓으면 대표가 발급할
 * 때 "1:1 재등록 10회" 를 찾느라 스크롤을 훑게 되고, 그러다 비슷한 이름의
 * 다른 상품을 고른다. 고른 상품이 회원권의 단가와 급여 카테고리를 정하므로,
 * 잘못 고르면 원장이 틀린 채로 쌓인다 -- append-only 라 대표만 되돌린다.
 *
 * ── 상품은 조직 공용이다 ──
 * 지점 필드가 없다 (product-repository 의 문서 모양, 규칙의 products create 가
 * hasOnly 로 닫혀 있다). 지점마다 가격이 같다는 것이 대표의 결정이고, 그래서
 * 지점으로 묶지 않는다. 이름에 지점을 적는 운영도 하지 않기로 했다 -- 지점이
 * 바뀌면 이미 팔린 회원권의 이름까지 틀려진다.
 *
 * ── 세 단계로 묶는다 ──
 *   1. 종류    1:1 · 2:1 · 기타    (수업에서 갈리는 단위)
 *   2. 이름    "1차 정상가" 처럼   (같은 조건의 묶음)
 *   3. 횟수    defaultSessions 오름차순
 *
 * 횟수를 맨 안쪽에 두는 것은 고를 때 마지막으로 정하는 것이 횟수이기 때문이다.
 * 10회와 20회가 멀리 떨어져 있으면 둘을 견주지 못한다.
 */

import { PAY_CATEGORY, PRODUCT_STATUS, SESSION_TYPE } from "../../data/schema/constants.js";
import { PAY_CATEGORY_LABELS } from "../../data/schema/display-names.js";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** 묶음 셋. 수업에서 갈리는 단위다. */
export const PRODUCT_GROUP = Object.freeze({
  SOLO: "solo",
  DUET: "duet",
  OTHER: "other",
});

export const PRODUCT_GROUP_LABEL = Object.freeze({
  [PRODUCT_GROUP.SOLO]: "1:1",
  [PRODUCT_GROUP.DUET]: "2:1",
  [PRODUCT_GROUP.OTHER]: "기타",
});

/* 화면에 서는 차례. 1:1 이 대부분이라 먼저이고, 기타는 서비스·렛미인처럼
   수가 적은 것들이라 맨 뒤다. */
const GROUP_ORDER = [PRODUCT_GROUP.SOLO, PRODUCT_GROUP.DUET, PRODUCT_GROUP.OTHER];

/**
 * 이 상품은 어느 묶음인가.
 *
 * sessionType 을 먼저 본다 -- 상품이 스스로 "1:1 인가 2:1 인가" 를 말하는 칸이
 * 그것이다. 없는 옛 상품은 급여카테고리로 가른다.
 *
 * @param {any} product
 */
export function productGroupOf(product) {
  const sessionType = text(product?.sessionType);
  if (sessionType === SESSION_TYPE.PT_1_1) return PRODUCT_GROUP.SOLO;
  if (sessionType === SESSION_TYPE.PT_2_1) return PRODUCT_GROUP.DUET;

  const category = text(product?.payCategory);
  if (category.startsWith("pt_1_1")) return PRODUCT_GROUP.SOLO;
  if (category.startsWith("pt_2_1")) return PRODUCT_GROUP.DUET;
  return PRODUCT_GROUP.OTHER;
}

/** 만원 단위로. 백만 원을 "1000000원" 으로 적으면 자릿수를 세게 된다. */
export function priceLabel(won) {
  const value = count(won);
  if (value === 0) return "0원";
  if (value % 10000 === 0) return `${(value / 10000).toLocaleString("ko-KR")}만원`;
  return `${value.toLocaleString("ko-KR")}원`;
}

/**
 * 한 줄 표시. "10회 · 100만원 · 1:1 재등록(정상)"
 *
 * 이름은 묶음 제목이 이미 말하므로 줄에서 뺀다 -- 같은 이름이 줄마다 반복되면
 * 다른 것(횟수와 금액)이 묻힌다.
 *
 * @param {any} product
 */
export function productLine(product) {
  const sessions = count(product?.defaultSessions);
  const category = text(product?.payCategory);
  return [
    sessions > 0 ? `${sessions}회` : "",
    priceLabel(product?.defaultPrice),
    category ? PAY_CATEGORY_LABELS[category] || category : "",
  ].filter(Boolean).join(" · ");
}

/** 보관된 상품인가. 새 발급에 쓸 수 없다. */
export const isArchivedProduct = (product) => text(product?.status) === PRODUCT_STATUS.ARCHIVED;

/**
 * 발급에 쓸 수 있는 상품만. **숨긴 상품으로는 새로 발급하지 않는다.**
 *
 * 지우지 않고 숨기는 이유는 이미 발급된 회원권이 그 상품의 이름과 금액을
 * 계속 가리키기 때문이다. 지우면 그 회원권들이 무엇으로 팔렸는지 알 수 없다.
 *
 * @param {Array<any>} products
 */
export const issuableProducts = (products) => (Array.isArray(products) ? products : [])
  .filter((product) => product && !isArchivedProduct(product));

/**
 * 묶어서 줄 세운 상품 목록.
 *
 * @param {Array<any>} products
 * @param {{ includeArchived?: boolean }} [options]
 *   includeArchived 기본 false -- 숨긴 상품은 묶음에 섞이지 않는다. 섞으면
 *   대표가 "이 상품이 왜 발급 화면에 없지" 를 묻게 된다.
 * @returns {Array<{ key: string, label: string, names: Array<{ name: string, items: Array<any> }>, total: number }>}
 */
export function groupProducts(products, { includeArchived = false } = {}) {
  const list = (Array.isArray(products) ? products : [])
    .filter((product) => product && (includeArchived || !isArchivedProduct(product)));

  const groups = new Map(GROUP_ORDER.map((key) => [key, new Map()]));
  for (const product of list) {
    const byName = groups.get(productGroupOf(product));
    /* 이름이 비어 있어도 묶는다. 빈 이름끼리 한 묶음이 되고, 그래야 대표가
       "이름이 빠진 상품이 있다" 를 한눈에 본다 -- 흩어 두면 못 본다. */
    const name = text(product?.name) || "(이름 없음)";
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(product);
  }

  return GROUP_ORDER.map((key) => {
    const byName = groups.get(key);
    const names = [...byName.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "ko"))
      .map(([name, items]) => ({
        name,
        /* 회차는 defaultSessions 다. 10회와 20회가 나란히 서야 견줄 수 있고,
           같은 횟수가 둘이면 싼 것이 먼저다 -- 같은 조건이면 그쪽을 판다. */
        items: items.slice().sort((a, b) => (
          count(a?.defaultSessions) - count(b?.defaultSessions)
          || count(a?.defaultPrice) - count(b?.defaultPrice)
        )),
      }));
    return {
      key,
      label: PRODUCT_GROUP_LABEL[key],
      names,
      total: names.reduce((sum, entry) => sum + entry.items.length, 0),
    };
  }).filter((group) => group.total > 0);
}

/**
 * 발급 화면이 띄울 경고. **총 횟수에 남은 횟수를 넣는 실수를 막는다.**
 *
 * 율하 김진희 건이 그랬다. 20회 상품을 11회로 적어 회원권이 11회짜리가 됐고,
 * 회당 금액이 계약 금액 ÷ 11 로 계산돼 136,364원이 됐다. 발급은 되돌릴 수
 * 없으므로 누르기 전에 말해야 한다.
 *
 * 다르다고 막지는 않는다 -- 상품과 다른 조건으로 파는 일이 실제로 있고
 * (issuePass 가 그것을 허용한다), 막으면 그 거래를 못 넣는다.
 *
 * @param {{ product?: any, totalSessions?: unknown }} input
 * @returns {string} 빈 문자열이면 경고 없음
 */
export function sessionsWarning({ product, totalSessions } = {}) {
  const expected = count(product?.defaultSessions);
  const typed = count(totalSessions);
  if (!expected || !typed || expected === typed) return "";
  if (typed > expected) {
    return `상품은 ${expected}회인데 ${typed}회로 입력했어요. 맞는지 확인해 주세요.`;
  }
  return `상품은 ${expected}회인데 ${typed}회로 입력했어요. 남은 횟수가 아니라 총 횟수를 넣어 주세요.`;
}

/**
 * 발급 전에 보여줄 회당 금액. **계약 금액 ÷ 정규 유료 횟수.**
 *
 * 숫자가 눈에 보이면 총 횟수를 잘못 넣은 것이 드러난다 -- 300,000원은 아무도
 * 그냥 지나치지 않는다. 서비스 회차는 분모에서 뺀다 (회원이 낸 돈이 아니다).
 *
 * @param {{ contractPrice?: unknown, totalSessions?: unknown }} input
 */
export function issueUnitPrice({ contractPrice, totalSessions } = {}) {
  const paid = count(totalSessions);
  const price = count(contractPrice);
  return paid > 0 && price > 0 ? Math.round(price / paid) : 0;
}

export { PAY_CATEGORY };
