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
import { expiryOrderWarning, expiryOutOfOrder } from "./purchase-round.js";

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

/**
 * 화면이 쓰는 날짜 형식(YYYY-MM-DD). 읽지 못하면 빈 문자열이다.
 *
 * Date 를 그대로 내보내지 않는다. 화면의 ymd() 는 문자열을 받아 slice 하는데,
 * Date 에는 slice 가 없어 **회원 상세가 통째로 죽는다** -- 배포 563 에서 실제로
 * 일어난 일이다. 날짜를 쓰는 쪽이 둘(판정은 Date, 표시는 문자열)이라 둘 다
 * 내보내고, 표시하는 쪽이 고를 일이 없게 한다.
 */
export function isoDay(value) {
  const at = toDate(value);
  if (!at) return "";
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/**
 * 이 회원권을 뭐라고 부를 것인가. **id 는 절대 쓰지 않는다.**
 *
 * 앱에서 발급한 회원권은 productId 가 **상품 문서의 id** 다. 이관분은
 * productId 자체가 상품명이라(migration-repository) 한동안 productId 를
 * 그대로 썼는데, 그래서 앱 발급분 카드에 긴 식별자가 제목으로 떴다.
 * 회원에게도 강사에게도 뜻이 없는 글자다.
 *
 * 순서가 있다. 계약할 때 들은 이름이 먼저이고, 그것이 없으면 상품 목록에서
 * 찾고, 그래도 없으면 종류와 횟수로 만든다 -- 상품이 지워졌거나 아주 옛
 * 회원권이 그렇고, 그때 빈 칸을 두면 무슨 회원권인지 알 수 없다.
 *
 *   1. pass.displayName  회원 투영이 서버에서 정해 보낸 이름
 *   2. pass.productName  발급 때 함께 저장한 이름
 *   3. 상품 목록 조회     productId 로 찾은 지금의 이름
 *   4. 종류 + 총 횟수     "1:1 PT 20회"
 *
 * 이관분의 productId 는 이름이지만 그것도 3번을 지나 4번으로 가지 않는다 --
 * 2번과 3번 사이에 두면 id 가 다시 제목이 될 길이 열린다. 이관분은
 * displayName 을 서버가 채우고(member-view), 강사 앱에서는 아래 migratedName
 * 이 "csv_" 가 아닌 productId 만 이름으로 받아들인다.
 *
 * @param {any} pass
 * @param {(productId: string) => string} [lookup] 상품 목록에서 이름 찾기
 */
export function passTitle(pass, lookup) {
  const given = text(pass?.displayName) || text(pass?.productName);
  if (given) return given;

  const productId = text(pass?.productId);
  const found = typeof lookup === "function" ? text(lookup(productId)) : "";
  if (found) return found;

  /* 이관분은 productId 가 이름이다. 식별자처럼 생긴 것은 받지 않는다 --
     앱 발급분의 productId 가 여기로 새면 다시 id 가 제목이 된다. */
  if (productId && !looksLikeId(productId)) return productId;

  return generatedTitle(pass);
}

/* 식별자처럼 생겼는가. 상품 문서 id 는 newId() 가 만들고, 사람이 지은 상품명은
   공백이나 한글이 섞인다. 둘을 가르는 선은 "사람이 읽을 것이 있는가" 다. */
const looksLikeId = (value) => {
  const raw = text(value);
  if (!raw) return true;
  if (/[\s가-힣]/.test(raw)) return false;
  // 영숫자(하이픈·밑줄 포함)만 20자 넘게 이어지면 id 로 본다.
  return raw.length >= 20 && /^[A-Za-z0-9_-]+$/.test(raw);
};

/** 아무 이름도 없을 때. 종류와 횟수로 부른다 -- 빈 칸보다는 낫다. */
function generatedTitle(pass) {
  const total = count(pass?.totalSessions) + count(pass?.serviceSessions);
  const category = text(pass?.category);
  const duet = category.startsWith("pt_2_1")
    || pass?.isDuet === true
    || (Array.isArray(pass?.clientIds) && pass.clientIds.length > 1);
  const kind = duet ? "2:1 PT" : category.startsWith("pt_1_1") ? "1:1 PT" : "회원권";
  return total > 0 ? `${kind} ${total}회` : kind;
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
  /* 디오사 관리 수업을 하면 여기서 빠진다. A 와 B 를 나눈다 -- **따로 파는
     회원권**이라 30분 수업은 A 에서만, 50분은 B 에서만 빠진다. 한 칸으로
     묶으면 카드가 "관리 수업 시 차감" 이라 적고, 50분 수업을 넣은 회원은
     자기 A 회원권이 왜 안 빠지는지 알 수 없다. */
  CARE_A: "care_a",
  CARE_B: "care_b",
});

/** 다음 차감 표시의 문구. 어느 수업에서 빠지는지를 그대로 말한다. */
export const NEXT_DEDUCT_LABEL = Object.freeze({
  [NEXT_DEDUCT.SOLO]: "1:1 수업 시 차감",
  [NEXT_DEDUCT.DUET]: "2:1 수업 시 차감",
  [NEXT_DEDUCT.CARE_A]: "관리 30분 수업 시 차감",
  [NEXT_DEDUCT.CARE_B]: "관리 50분 수업 시 차감",
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
  /* 회원권이 쓴 서비스를 세고 있으면 그것이 참이다. 역산은 "차감만 일어났다"
     를 전제하는데, 대표가 [잔여 조정]으로 잔여를 올리면 그 전제가 깨진다 --
     그때 카드만 서비스가 늘어난 것처럼 보이고, 급여 판정은 serviceUsed 를
     쓰므로 둘이 갈린다.

     회원 앱 투영에는 이 칸이 가지 않는다 (member-view 의 허용 목록). 그래서
     없을 때는 그대로 역산한다 -- 두 화면이 대개 같고, 조정이 있었던 회원권만
     강사 화면이 더 정확하다. */
  const counted = Number.isInteger(pass?.serviceUsed) && pass.serviceUsed >= 0
    ? Math.min(pass.serviceUsed, service)
    : Math.min(Math.max(0, issued - remaining), service);
  const serviceLeft = Math.max(0, service - counted);
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
 * @param {{ now?: Date, nextDeduct?: string, productName?: (id: string) => string }} [options]
 */
export function passCard(pass, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nextDeduct = text(options.nextDeduct) || NEXT_DEDUCT.NONE;
  const category = text(pass?.category);
  const split = remainingSplit(pass);
  const usable = isUsablePass(pass, now);
  return {
    passId: text(pass?.id || pass?.passId),
    /* 상품명. 순서는 passTitle 의 머리말에 있다 -- **id 는 절대 제목이 되지
       않는다.** */
    name: passTitle(pass, options.productName),
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
    /* 표시용. 위 isoDay 의 머리말 참고 -- 화면에 Date 를 넘기면 죽는다. */
    expiresOn: isoDay(pass?.expiresAt),
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
 * 목록 카드 한 줄이 쓸 요약. **상세와 같은 갈래를 쓴다.**
 *
 * 목록은 잔여를 한 숫자로 합치고 만료일을 한 날짜로 보여줬다 -- 상세에서
 * 지운 바로 그 화면이 목록에 남아 있으면, 강사는 목록에서 본 숫자를 믿고
 * 상세를 열어 다른 숫자를 보게 된다.
 *
 * 가장 빠른 만료는 **몇 회가 그날 끝나는지와 함께** 말한다. 날짜만 적으면
 * 합계 전부가 그날 끝나는 것으로 읽힌다 -- 고치려던 오해가 그것이다.
 *
 * @param {Array<any>} cards passCard 의 결과
 */
export function passListSummary(cards) {
  const active = (Array.isArray(cards) ? cards : []).filter((card) => card.group === PASS_GROUP.ACTIVE);
  if (active.length === 0) return null;
  const sum = (duet) => active.filter((card) => card.isDuet === duet)
    .reduce((total, card) => total + card.remaining, 0);
  /* 목록은 만료가 가까운 순으로 정렬된 것을 받는다 (passCardList). 맨 앞이 곧
     가장 먼저 끝나는 회원권이고, 만료일이 없는 것은 맨 뒤라 앞에 서지 않는다. */
  const soonest = active.find((card) => card.expiresOn) || null;
  return {
    count: active.length,
    solo: sum(false),
    duet: sum(true),
    soonestOn: soonest ? soonest.expiresOn : "",
    soonestRemaining: soonest ? soonest.remaining : 0,
  };
}

/**
 * 한 회원의 카드 전부. 사용 중이 먼저, 만료가 가까운 순이다.
 *
 * 차수와 만료일이 어긋난 카드에는 expiryOrderWarning 한 줄이 붙는다 --
 * 2026-10-09 부터 차감이 차수 순이라, 뒤 차수가 먼저 만료되면 그 회차를
 * 쓰지 못한 채 잃는다.
 *
 * @param {{
 *   passes?: Array<any>, now?: Date, productName?: (id: string) => string,
 *   nextSoloPassId?: string, nextDuetPassId?: string,
 *   nextCareAPassId?: string, nextCareBPassId?: string,
 * }} input
 *   productName  productId 로 상품 이름을 찾는 함수. 없으면 종류와 횟수로 만든다.
 *   nextSoloPassId / nextDuetPassId 는 **lesson-settlement 가 고른 것**을 받는다.
 *   여기서 다시 고르지 않는다 -- 한 줄이라도 다르게 고르면 화면이 가리키는
 *   회원권과 실제로 빠지는 회원권이 갈라지고, 그때는 되돌릴 수도 없다.
 * @returns {{ active: Array<any>, ended: Array<any>, summary: string }}
 */
export function passCardList(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const solo = text(input.nextSoloPassId);
  const duet = text(input.nextDuetPassId);
  /* 관리 수업의 다음 차감. 둘을 따로 받는다 -- 한 칸이면 어느 길이의 수업이
     이 회원권을 쓰는지 카드가 말하지 못한다. */
  const careA = text(input.nextCareAPassId);
  const careB = text(input.nextCareBPassId);
  const list = (Array.isArray(input.passes) ? input.passes : []).filter(Boolean);

  /* 뒤 차수가 앞 차수보다 먼저 만료되는 회원권. 차수 순으로 쓰므로 그 회차는
     손도 못 대 보고 사라질 수 있다 -- 회원이 돈을 낸 회차다.

     자동으로 피하지 않는다 (순서를 뒤집으면 예측이 깨진다). 카드가 먼저
     말하고, 대표가 만료일을 옮겨 푼다. */
  const outOfOrder = new Map(expiryOutOfOrder(list, { now }).map((row) => [
    text(row.pass?.id || row.pass?.passId), expiryOrderWarning(row),
  ]));

  const cards = list.slice().sort(byExpiry).map((pass) => {
    const id = text(pass?.id || pass?.passId);
    let nextDeduct = NEXT_DEDUCT.NONE;
    if (id && id === solo) nextDeduct = NEXT_DEDUCT.SOLO;
    else if (id && id === duet) nextDeduct = NEXT_DEDUCT.DUET;
    else if (id && id === careA) nextDeduct = NEXT_DEDUCT.CARE_A;
    else if (id && id === careB) nextDeduct = NEXT_DEDUCT.CARE_B;
    return {
      ...passCard(pass, { now, nextDeduct, productName: input.productName }),
      expiryOrderWarning: outOfOrder.get(id) || "",
    };
  });

  return {
    active: cards.filter((card) => card.group === PASS_GROUP.ACTIVE),
    /* 끝난 것은 만료가 **늦은** 순이다. 최근에 끝난 것이 먼저 보여야 재등록
       상담에 쓸 수 있다 -- 삼 년 전에 끝난 회원권이 맨 위에 설 이유가 없다. */
    ended: cards.filter((card) => card.group === PASS_GROUP.ENDED).reverse(),
    summary: passSummary(cards),
  };
}
