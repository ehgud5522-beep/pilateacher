/**
 * 급여 단가표.
 *
 * ── 표는 기준값일 뿐, 기록된 값이 진실이다 ──
 * 여기서 정해지는 숫자는 발급하는 그 순간에만 쓰인다. 급여를 계산하는 값은
 * 언제나 passes/{passId}/ledger 항목에 저장된 unitPrice 다.
 *
 * 단가는 바뀐다. 강사가 등급 시험에 합격하면 풀방금액이 오른다. 표나 강사의
 * 풀방금액을 고쳤을 때 지난달 급여가 함께 흔들리면 이미 정산이 끝난 달의 근거가
 * 사라지고, 원장은 append-only 라 사후 보정도 불가능하다. 그래서 발급·차감
 * 시점의 단가를 항목에 박아 두고, 이 파일은 그 시점에 한 번만 읽는다.
 *
 * 급여를 합산하는 코드가 이 파일이나 memberships.fullRoomRate 를 참조하면 그
 * 원칙이 깨진다. 계산은 원장을 읽어야 한다.
 *
 * ── 강사별로 갈리는 것은 한 줄뿐이다 ──
 * pt_1_1_repurchase_normal 만 강사 본인의 풀방금액을 쓴다. 나머지 일곱은 강사가
 * 누구든 같은 금액이다 -- 특히 이벤트페이(pt_1_1_repurchase_event)는 풀방금액이
 * 있는 강사에게도 정해진 금액으로 나간다. 풀방금액이 다른 카테고리 단가를 끌고
 * 움직이면 안 된다.
 */

import { PAY_CATEGORY } from "./constants.mjs";

/**
 * 강사와 무관하게 고정된 단가(원).
 *
 * 여기 없는 카테고리는 표가 정해 줄 수 없다는 뜻이고, 어디서 값이 오는지는
 * UNIT_PRICE_SOURCE 가 말한다.
 */
export const PAY_RATES = Object.freeze({
  [PAY_CATEGORY.PT_1_1_NEW]: 25000,
  [PAY_CATEGORY.PT_1_1_REPURCHASE_EVENT]: 30000,
  [PAY_CATEGORY.PT_2_1_NEW]: 30000,
  [PAY_CATEGORY.PT_2_1_REPURCHASE]: 35000,
  /* 2:1 재등록(이벤트). 1:1 이벤트(30,000)와 같은 성격이고 둘이라 금액만
     다르다 -- 강사가 누구든 같고, 풀방금액을 끌고 움직이지 않는다. */
  [PAY_CATEGORY.PT_2_1_REPURCHASE_EVENT]: 32000,
  [PAY_CATEGORY.SERVICE]: 10000,
  [PAY_CATEGORY.LETMEIN]: 28000,
  /* 디오사. 30분과 50분의 차이가 그대로 단가의 차이다. 강사가 누구든 같고,
     인수인계·누적 20회·직급 어느 것에도 걸리지 않는다 -- 부원장 5:5 만
     예외이고 그것은 판정 1 이 먼저 잡는다 (deduction-pricing.mjs). */
  [PAY_CATEGORY.DIOSA_A]: 20000,
  [PAY_CATEGORY.DIOSA_B]: 35000,
});

/** 단가가 어디서 오는가. 화면은 이 값으로 무엇을 물어볼지 정한다. */
export const UNIT_PRICE_SOURCE = Object.freeze({
  /** 표에 적힌 고정 금액. 물어볼 것이 없다. */
  TABLE: "table",
  /** 담당 강사의 풀방금액. 강사가 정해지면 따라온다. */
  FULL_ROOM_RATE: "full_room_rate",
  /** 사람이 직접 넣는다. */
  MANUAL: "manual",
});

/**
 * @param {string} payCategory
 * @returns {string} UNIT_PRICE_SOURCE 중 하나
 */
export function unitPriceSourceFor(payCategory) {
  const category = String(payCategory ?? "");
  if (category in PAY_RATES) return UNIT_PRICE_SOURCE.TABLE;
  if (category === PAY_CATEGORY.PT_1_1_REPURCHASE_NORMAL) return UNIT_PRICE_SOURCE.FULL_ROOM_RATE;
  return UNIT_PRICE_SOURCE.MANUAL;
}

/**
 * 표의 고정 단가. 표 밖의 카테고리는 null 이다 -- 0 을 돌려주면 "무료"와 "표가
 * 정해 주지 않는다"가 같은 값이 되어, 묻지 않고 0원으로 발급된다.
 *
 * @param {string} payCategory
 * @returns {number | null}
 */
export function defaultUnitPriceFor(payCategory) {
  const rate = PAY_RATES[String(payCategory ?? "")];
  return typeof rate === "number" ? rate : null;
}

/** 화면이 단가 칸을 보여줘야 하는가. @param {string} payCategory */
export function requiresManualUnitPrice(payCategory) {
  return unitPriceSourceFor(payCategory) === UNIT_PRICE_SOURCE.MANUAL;
}

/** 담당 강사의 풀방금액이 있어야 발급되는가. @param {string} payCategory */
export function requiresFullRoomRate(payCategory) {
  return unitPriceSourceFor(payCategory) === UNIT_PRICE_SOURCE.FULL_ROOM_RATE;
}

/** 빈 칸과 0 을 가른다. Number("") 는 0 이라, 거르지 않으면 빈 칸이 무료가 된다. */
const parsePositiveInt = (value, label) => {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
    return value;
  }
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing ${label}`);
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
};

/**
 * 원장에 적을 단가를 정한다. 표에서 오든, 강사의 풀방금액에서 오든, 사람이
 * 넣든, 최종적으로 항목에 박히는 그 값이다.
 *
 * 풀방금액이 0 이거나 비어 있으면 발급을 막는다. 0 을 그대로 받아들이면 그
 * 강사의 재등록 수업이 통째로 무보수로 기록되고, 원장은 고칠 수 없다.
 *
 * @param {string} payCategory
 * @param {{ unitPrice?: number | string | null, fullRoomRate?: number | string | null }} [options]
 * @returns {number}
 */
export function resolveUnitPrice(payCategory, options = {}) {
  const source = unitPriceSourceFor(payCategory);
  if (source === UNIT_PRICE_SOURCE.TABLE) {
    // 표가 값을 정해 주는 카테고리에서는 화면이 보낸 값도 풀방금액도 보지 않는다.
    return /** @type {number} */ (defaultUnitPriceFor(payCategory));
  }
  if (source === UNIT_PRICE_SOURCE.FULL_ROOM_RATE) {
    const rate = parsePositiveInt(options?.fullRoomRate, "fullRoomRate");
    if (rate === 0) throw new Error("Missing fullRoomRate");
    return rate;
  }
  return parsePositiveInt(options?.unitPrice, "unitPrice");
}

/* ── 발급 화면에서 기준 단가를 직접 정한다 (2026-11-07 대표 결정) ─────────────
 * 지점마다 단가와 수강권 형태가 조금씩 다르다. 표·풀방금액·상품 단가는 이제
 * **제안값**이고, 대표 · 총괄매니저 · FC매니저가 발급할 때 바꿀 수 있다.
 *
 * 바꾸는 것은 회원권의 기준값(baseUnitPrice) 하나다. 차감할 때의 판정 --
 * 부원장 5:5 · 인수인계 25,000 · 이 강사에게 20회 미만 신규 단가 · 직급 이벤트
 * -- 은 그대로 그 위에 선다 (deduction-pricing.mjs). 부원장은 판정 1 이라
 * 20회 미만 판정보다 먼저 끝난다.
 *
 * 누가 · 무엇을 · 왜 바꿨는지 회원권 문서에 남는다: createdBy(누가),
 * standardUnitPrice(원래 값) · baseUnitPrice(정한 값), unitPriceReason(왜).
 * 원장은 append-only 라, 이 셋이 없으면 월말에 "왜 이 회원권만 단가가 다른가"
 * 에 답할 것이 없다.
 */

/** 기준 단가가 어디서 왔는가. 회원권 문서의 unitPriceSource 에 그대로 남는다. */
export const ISSUE_UNIT_PRICE_SOURCE = Object.freeze({
  TABLE: "table",
  FULL_ROOM_RATE: "full_room_rate",
  /** 기타 상품이 들고 있는 회당 단가. */
  PRODUCT: "product",
  /** 발급하는 사람이 직접 정했다. */
  MANUAL: "manual",
});

/** 기준 단가를 직접 정할 수 있는 역할. 규칙의 canIssuePass 와 같은 목록이다. */
export const UNIT_PRICE_EDITOR_ROLES = Object.freeze(
  /** @type {ReadonlyArray<string>} */ (["owner", "area_manager", "manager"]),
);

/** @param {string} role */
export function canSetUnitPrice(role) {
  return UNIT_PRICE_EDITOR_ROLES.includes(String(role ?? ""));
}

/** 사유 글자 수 상한. 회원권 문서에 남는다. */
export const UNIT_PRICE_REASON_MAX = 100;

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

/**
 * 직접 정하지 않았을 때 쓰일 값. 없으면 null -- 0 이 아니다.
 *
 * @param {string} payCategory
 * @param {{ productUnitPrice?: number | null, fullRoomRate?: number | string | null }} [options]
 * @returns {{ value: number | null, source: string }}
 */
export function standardIssueUnitPrice(payCategory, options = {}) {
  const source = unitPriceSourceFor(payCategory);
  if (source === UNIT_PRICE_SOURCE.TABLE) {
    return { value: defaultUnitPriceFor(payCategory), source: ISSUE_UNIT_PRICE_SOURCE.TABLE };
  }
  if (source === UNIT_PRICE_SOURCE.FULL_ROOM_RATE) {
    const rate = Number(options?.fullRoomRate);
    return {
      value: !isBlank(options?.fullRoomRate) && Number.isInteger(rate) && rate > 0 ? rate : null,
      source: ISSUE_UNIT_PRICE_SOURCE.FULL_ROOM_RATE,
    };
  }
  const productPrice = options?.productUnitPrice;
  return {
    value: Number.isInteger(productPrice) && productPrice >= 0 ? productPrice : null,
    source: ISSUE_UNIT_PRICE_SOURCE.PRODUCT,
  };
}

/**
 * 발급 시 박을 기준 단가와 그 출처.
 *
 * manualUnitPrice 가 비어 있으면 예전 길(resolveUnitPrice)과 같다. 값이 있으면
 *   - 정할 수 있는 역할이 아니면 거부 (Forbidden manualUnitPrice)
 *   - 1원 이상의 정수가 아니면 거부 -- 0 은 그 수업들이 통째로 무보수가 된다
 *   - 제안값이 있고 그와 다르면 사유가 있어야 한다 (Missing unitPriceReason)
 *
 * @param {string} payCategory
 * @param {{
 *   manualUnitPrice?: number | string | null,
 *   unitPriceReason?: string,
 *   issuerRole?: string,
 *   unitPrice?: number | string | null,
 *   fullRoomRate?: number | string | null,
 * }} [options]
 * @returns {{ unitPrice: number, source: string, standardUnitPrice: number | null, reason: string }}
 */
export function resolveIssueUnitPrice(payCategory, options = {}) {
  const productUnitPrice = (() => {
    if (unitPriceSourceFor(payCategory) !== UNIT_PRICE_SOURCE.MANUAL || isBlank(options?.unitPrice)) return null;
    const parsed = Number(options.unitPrice);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  })();
  const standard = standardIssueUnitPrice(payCategory, {
    productUnitPrice, fullRoomRate: options?.fullRoomRate,
  });
  const reason = String(options?.unitPriceReason ?? "").trim().slice(0, UNIT_PRICE_REASON_MAX);

  if (isBlank(options?.manualUnitPrice)) {
    return {
      unitPrice: resolveUnitPrice(payCategory, { unitPrice: options?.unitPrice, fullRoomRate: options?.fullRoomRate }),
      source: standard.source,
      standardUnitPrice: standard.value,
      reason: "",
    };
  }

  if (!canSetUnitPrice(options?.issuerRole)) throw new Error("Forbidden manualUnitPrice");
  const manual = Number(String(options.manualUnitPrice).trim());
  if (!Number.isInteger(manual) || manual < 1) throw new Error("Invalid manualUnitPrice");
  if (standard.value === manual) {
    // 제안값을 그대로 적었다. 바꾼 것이 아니므로 출처도 그대로다.
    return { unitPrice: manual, source: standard.source, standardUnitPrice: standard.value, reason: "" };
  }
  if (standard.value !== null && !reason) throw new Error("Missing unitPriceReason");
  return {
    unitPrice: manual,
    source: ISSUE_UNIT_PRICE_SOURCE.MANUAL,
    standardUnitPrice: standard.value,
    reason,
  };
}
