/**
 * 회원권 한 장 = 카드 한 개. **합치지 않는다.**
 *
 * ── 왜 합치면 안 되는가 ──
 * 강사 화면은 여러 장을 한 장처럼 보여줬다. 잔여와 누적은 더하고, 상품명 ·
 * 만료일 · 회당 금액은 **그중 한 장의 것**만 썼다. 그래서 1:1 두 장과 2:1 두
 * 장을 가진 회원이 "2:1 신규 · 잔여 194회 · 2026.11.09" 로 보였다 -- 11/09 에
 * 사라지는 것은 13회뿐인데 194회가 그날 끝나는 것처럼 읽힌다.
 *
 * 숫자가 틀린 것이 아니라 **서로 다른 회원권의 숫자가 한 줄에 섞인 것**이다.
 * 합계를 지우고 장별로 되돌린다.
 *
 * ── 정규 · 서비스를 여기서 센다 ──
 * 화면이 쓰던 regular/service 는 기기의 레거시 칸이고, roster-bridge 가 0 으로
 * 눌러 내보낸다 (의도된 0 이다 -- 두 숫자가 한 화면에 있으면 어느 것이 맞는지
 * 아무도 모른다). 그래서 잔여가 194 인 옆에 "정규 0 · 서비스 0" 이 섰다.
 *
 * 회원권에서 다시 센다. 서비스를 먼저 쓰므로(deduction-pricing.js) 세 숫자만
 * 있으면 정해진다:
 *
 *   쓴 횟수   = (총 + 서비스) - 잔여
 *   서비스 잔여 = 서비스 - min(쓴 횟수, 서비스)
 *   정규 잔여   = 잔여 - 서비스 잔여
 *
 * serviceUsed 를 읽지 않는 것은 **회원 앱에 그 칸이 가지 않기 때문**이다
 * (member-view.js 의 허용 목록). 한쪽만 다른 식으로 세면 같은 회원권이 두
 * 화면에서 다른 숫자가 되고, 그것이 이 파일이 막으려는 바로 그 일이다.
 * 세 숫자에서 나오는 값은 serviceUsed 와 구성상 같다 -- 차감 한 번에 잔여가
 * 1 줄고 서비스가 남아 있으면 serviceUsed 가 1 오르기 때문이다.
 *
 * ── 두 앱이 함께 쓴다 ──
 * 강사 앱은 passes 문서를, 회원 앱은 memberViews 투영을 읽는다. 모양이 달라서
 * 칸 이름만 맞춰 두면 같은 식으로 센다. **회원에게 가지 않는 것은 여기서도
 * 만들지 않는다** -- 급여카테고리와 금액은 투영에 없고, 없는 것을 그리려 하면
 * 회원 화면에 빈 칸이 생기거나 누군가 그 칸을 채우러 투영을 연다.
 */

import { PAY_CATEGORY_LABELS } from "../../data/schema/display-names.js";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

/** Firestore Timestamp 도 Date 도 문자열도 온다. 못 읽으면 null 이다. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    try { return toDate(value.toDate()); } catch { return null; }
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 이 카드가 어느 묶음에 들어가는가. */
export const PASS_GROUP = Object.freeze({
  /** 지금 쓸 수 있다. 만료가 가까운 순으로 선다. */
  ACTIVE: "active",
  /** 다 썼거나 만료됐거나 취소됐다. 접어서 아래에 둔다. */
  ENDED: "ended",
});

/** 다음 수업에서 이 회원권이 쓰이는가. 표시와 실제 차감이 어긋나면 안 된다. */
export const NEXT_DEDUCT = Object.freeze({
  NONE: "",
  /** 1:1 수업을 하면 여기서 빠진다. */
  SOLO: "solo",
  /** 2:1 수업을 하면 여기서 빠진다. */
  DUET: "duet",
});

/**
 * 정규 · 서비스 잔여. 세 숫자에서 나온다 -- 위 머리말 참고.
 *
 * @param {{ totalSessions?: unknown, serviceSessions?: unknown, remainingCount?: unknown }} pass
 * @returns {{ regular: number, service: number }}
 */
export function remainingSplit(pass) {
  const service = count(pass?.serviceSessions);
  const issued = count(pass?.totalSessions) + service;
  const remaining = count(pass?.remainingCount);
  const spent = Math.max(0, issued - remaining);
  const serviceLeft = Math.max(0, service - Math.min(spent, service));
  /* 잔여를 넘지 않게 한 번 더 막는다. 이관분은 총 횟수와 잔여가 따로 적혀
     오므로 둘이 어긋난 행이 있을 수 있고, 그때 서비스가 잔여보다 커지면
     정규가 음수로 나온다 -- 화면에 "-3회" 가 뜨는 길이다. */
  const service2 = Math.min(serviceLeft, remaining);
  return { regular: Math.max(0, remaining - service2), service: service2 };
}

/** 지금 쓸 수 있는가. 회원 앱의 isUsable 과 같은 판정이다. */
export function isUsablePass(pass, now = new Date()) {
  const status = text(pass?.status);
  if (status && status !== "active") return false;
  if (count(pass?.remainingCount) <= 0) return false;
  const expiresAt = toDate(pass?.expiresAt);
  return !expiresAt || expiresAt.getTime() >= now.getTime();
}

/** 왜 끝났는가. "다 썼다" 와 "기간이 지났다" 는 재등록 상담이 다르다. */
export function endedReason(pass, now = new Date()) {
  const status = text(pass?.status);
  if (status && status !== "active") return status === "cancelled" ? "취소됨" : "종료됨";
  if (count(pass?.remainingCount) <= 0) return "모두 사용";
  const expiresAt = toDate(pass?.expiresAt);
  if (expiresAt && expiresAt.getTime() < now.getTime()) return "기간 만료";
  return "";
}

/**
 * 회원이 낸 돈 ÷ 정규 유료 횟수. **강사 앱에서만 쓴다.**
 *
 * 서비스 회차는 분모에서 뺀다 -- 공짜로 받은 회차까지 나누면 회원이 실제로 낸
 * 단가보다 낮게 나온다. 회원 투영에는 계약 금액이 없으므로 거기서는 0 이다.
 */
export function memberUnitPrice(pass) {
  const paid = count(pass?.totalSessions);
  const price = count(pass?.contractPrice);
  return paid > 0 && price > 0 ? Math.round(price / paid) : 0;
}

/** 만료가 이른 것부터. 같으면 먼저 발급된 것부터 -- 계약의 순서다. */
const byExpiry = (left, right) => {
  const at = (pass) => toDate(pass?.expiresAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const made = (pass) => toDate(pass?.createdAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return at(left) - at(right) || made(left) - made(right);
};

/**
 * 카드 한 장.
 *
 * @param {any} pass 강사 앱의 passes 문서 또는 회원 앱의 memberViews 투영
 * @param {{ now?: Date, nextDeduct?: string }} [options]
 */
export function passCard(pass, { now = new Date(), nextDeduct = NEXT_DEDUCT.NONE } = {}) {
  const category = text(pass?.category);
  const split = remainingSplit(pass);
  const usable = isUsablePass(pass, now);
  return {
    passId: text(pass?.id || pass?.passId),
    /* 상품명. 계약할 때 들은 이름이 먼저다 -- 이관분은 productId 자체가 이름이고,
       회원 투영은 서버가 displayName 으로 정해서 보낸다. */
    name: text(pass?.displayName) || text(pass?.productId),
    category,
    /* 급여카테고리는 회원에게 가지 않는다. 없으면 빈 문자열이고, 화면은 그 줄을
       그리지 않는다 -- 빈 칸을 두면 누군가 채우러 투영을 연다. */
    categoryLabel: category ? PAY_CATEGORY_LABELS[category] || category : "",
    remaining: count(pass?.remainingCount),
    /* 발급된 전부. 정규와 서비스를 더한 것이 그 회원권의 크기다. */
    issued: count(pass?.totalSessions) + count(pass?.serviceSessions),
    regularLeft: split.regular,
    serviceLeft: split.service,
    expiresAt: toDate(pass?.expiresAt),
    unitPrice: memberUnitPrice(pass),
    purchaseRound: count(pass?.purchaseRound),
    /* 2:1 은 두 사람의 화면에 같은 카드가 선다. 이름이 없으면 투영이 보내 준
       partnerName 을 쓰고, 강사 앱은 clientId 로 명부에서 찾는다. */
    isDuet: pass?.isDuet === true || (Array.isArray(pass?.clientIds) && pass.clientIds.length > 1),
    partnerName: text(pass?.partnerName),
    group: usable ? PASS_GROUP.ACTIVE : PASS_GROUP.ENDED,
    endedReason: usable ? "" : endedReason(pass, now),
    nextDeduct,
  };
}

/**
 * 종류별 요약 한 줄. **합계가 아니라 갈래다.**
 *
 * "사용 중 4장 · 1:1 111회 · 2:1 83회". 한 숫자로 합치면 그것이 지금 지우려는
 * 바로 그 화면이 된다 -- 1:1 과 2:1 은 다른 수업에서 쓰이므로 더해도 쓸 데가 없다.
 *
 * @param {Array<any>} cards passCard 의 결과
 */
export function passSummary(cards) {
  const active = (Array.isArray(cards) ? cards : []).filter((card) => card.group === PASS_GROUP.ACTIVE);
  if (active.length === 0) return "사용 중인 회원권 없음";
  const solo = active.filter((card) => !card.isDuet).reduce((sum, card) => sum + card.remaining, 0);
  const duet = active.filter((card) => card.isDuet).reduce((sum, card) => sum + card.remaining, 0);
  const parts = [`사용 중 ${active.length}장`];
  if (solo > 0) parts.push(`1:1 ${solo}회`);
  if (duet > 0) parts.push(`2:1 ${duet}회`);
  return parts.join(" · ");
}

/**
 * 한 회원의 카드 전부. 사용 중이 먼저, 만료가 가까운 순이다.
 *
 * @param {{
 *   passes?: Array<any>, now?: Date,
 *   nextSoloPassId?: string, nextDuetPassId?: string,
 * }} input
 *   nextSoloPassId / nextDuetPassId 는 **lesson-settlement 가 고른 것**을 받는다.
 *   여기서 다시 고르지 않는다 -- 한 줄이라도 다르게 고르면 화면이 가리키는
 *   회원권과 실제로 빠지는 회원권이 갈라지고, 그때는 되돌릴 수도 없다.
 * @returns {{ active: Array<any>, ended: Array<any>, summary: string }}
 */
export function passCardList(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const solo = text(input.nextSoloPassId);
  const duet = text(input.nextDuetPassId);
  const list = (Array.isArray(input.passes) ? input.passes : []).filter(Boolean);

  const cards = list.slice().sort(byExpiry).map((pass) => {
    const id = text(pass?.id || pass?.passId);
    let nextDeduct = NEXT_DEDUCT.NONE;
    if (id && id === solo) nextDeduct = NEXT_DEDUCT.SOLO;
    else if (id && id === duet) nextDeduct = NEXT_DEDUCT.DUET;
    return passCard(pass, { now, nextDeduct });
  });

  return {
    active: cards.filter((card) => card.group === PASS_GROUP.ACTIVE),
    /* 끝난 것은 만료가 **늦은** 순이다. 최근에 끝난 것이 먼저 보여야 재등록
       상담에 쓸 수 있다 -- 삼 년 전에 끝난 회원권이 맨 위에 설 이유가 없다. */
    ended: cards.filter((card) => card.group === PASS_GROUP.ENDED).reverse(),
    summary: passSummary(cards),
  };
}
