"use strict";

/**
 * 회원이 읽을 문서 하나를 만든다. 순수 함수 — 읽지도 쓰지도 않는다.
 *
 * ── 왜 투영인가 ──
 * Firestore 규칙은 문서 단위로만 열고 닫는다. 필드를 골라 숨길 수 없다.
 * passes 한 문서에 remainingCount(회원이 볼 것)와 baseUnitPrice·
 * netContractPrice(급여 근거)가 같이 있어서, 회원에게 그 문서를 열면 단가가
 * 함께 나간다. 원장은 더 심하다 -- unitPrice 와 rule 이 항목마다 있다.
 *
 * 그래서 회원은 원본을 읽지 않고 이 함수가 만든 것만 읽는다.
 * 설계는 docs/member-app-design.md 2장.
 *
 * ── 이 파일이 개인정보의 유일한 관문이다 ──
 * 여기가 맞으면 나머지가 틀려도 새어 나가지 않고, 여기가 틀리면 나머지가 다
 * 맞아도 새어 나간다. 그래서 이 함수는 트리거보다 먼저 만들고 먼저 고정한다.
 *
 * 필드는 허용 목록으로 고른다. 금지 목록만 두면 원본에 새 필드가 생길 때마다
 * 조용히 따라 나간다 -- 지금 없는 필드를 막을 방법이 없기 때문이다. 허용
 * 목록은 반대다: 새 필드는 기본이 "안 나감" 이고, 내보내려면 사람이 손으로
 * 적어야 한다.
 *
 * ── buildJourney 를 주입받는 이유 ──
 * 여정 계산은 앱 쪽 src/features/members/pass-journey.js 에 이미 있고, 계산을
 * 두 번 쓰지 않는다. 그런데 Functions 는 functions/ 디렉터리만 배포된다
 * (firebase.ai-gateway.json 의 source). 그래서 여기서 require 할 수 없다.
 *
 * 그 문제를 이 파일에서 풀지 않는다. 주입으로 받아 두면 이 함수는 순수한 채로
 * 테스트되고, "어떻게 배포에 넣을 것인가" 는 트리거를 만들 때(설계 10장 5번)
 * 한 번 정하면 된다. 주입하지 않으면 journey 는 null 이고 화면은 그 줄을
 * 그리지 않는다 -- 지어낸 값을 넣는 것보다 없는 편이 낫다.
 */

/** 회원권 한 건에서 내보낼 것. 이 목록에 없는 필드는 나가지 않는다. */
const PASS_FIELDS = Object.freeze([
  "passId", "purchaseRound", "totalSessions", "serviceSessions",
  "remainingCount", "expiresAt", "status", "isDuet", "partnerName",
  /* 회원이 계약할 때 들은 이름. 금액도 카테고리도 아니다 -- 이름 하나다.
     없으면 빈 문자열이고 화면이 "22회 회원권" 으로 부른다. */
  "displayName",
]);

/**
 * 이 회원권을 뭐라고 부르는가.
 *
 * 상품 문서의 이름이 먼저다. 없으면 productId 자체가 이름인 경우를 본다 --
 * 엑셀 이관이 상품명을 그대로 id 로 썼다(migration-repository.js 의
 * `productId: requireText(record, "상품명")`). 그 회원권들이 반송점 명부의
 * 대부분이고, 이름을 못 찾으면 회원 화면에서 전부 "N회 회원권" 이 된다.
 *
 * 만들어진 id 와 사람이 적은 이름은 글자로 갈린다: 생성된 id 는 영숫자와
 * 하이픈뿐이고, 이관이 넣은 이름에는 한글·공백·콜론이 섞인다.
 */
function passDisplayName(productId, productNames) {
  const id = text(productId);
  if (!id) return "";
  const found = productNames && typeof productNames.get === "function"
    ? text(productNames.get(id))
    : text(productNames?.[id]);
  if (found) return found;
  // 이관이 붙이는 자리표시자. 이름이 아니다.
  if (id === "csv") return "";
  return /^[A-Za-z0-9_-]+$/.test(id) ? "" : id;
}

/** 수업 이력 한 건에서 내보낼 것. */
const HISTORY_FIELDS = Object.freeze(["occurredAt", "type", "instructorName"]);

/** 투영 문서의 최상위. */
const VIEW_FIELDS = Object.freeze([
  "organizationId", "clientId", "userId", "name", "locationName", "clientStatus",
  "remainingTotal", "nextExpiresAt", "passes", "history", "journey", "updatedAt",
]);

/**
 * 어떤 경우에도 투영에 들어가면 안 되는 필드.
 *
 * 허용 목록이 이미 막고 있으므로 이 목록은 코드가 쓰지 않는다 -- 테스트만
 * 쓴다. 두 겹으로 두는 이유는 허용 목록에 실수로 한 줄이 늘었을 때 그것을
 * 잡을 것이 필요해서다. 설계 문서 2장의 표와 같은 목록이다.
 */
const FORBIDDEN_FIELDS = Object.freeze([
  "baseUnitPrice", "netContractPrice", "unitPrice", "rule", "category",
  "handedOver", "serviceUsed", "instructorId", "createdBy", "reason",
  "paymentMethod", "contractPrice", "fullRoomRate", "isDeputyDirector",
  "phone", "clientIds",
]);

/** 회원에게 보여 줄 이력의 종류. 발급·취소는 회원권 목록에 이미 있다. */
const HISTORY_TYPES = Object.freeze(["deduct", "correction", "transfer"]);

const PASS_STATUS_ACTIVE = "active";
const PASS_STATUS_CANCELLED = "cancelled";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0);

/** Firestore Timestamp · Date · 문자열이 섞여 온다. 못 읽으면 null 이다. */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value.toDate === "function") {
    try {
      const at = value.toDate();
      return Number.isFinite(at?.getTime?.()) ? at : null;
    } catch (_error) { return null; }
  }
  const at = new Date(String(value));
  return Number.isFinite(at.getTime()) ? at : null;
}

/** 이 회원권을 함께 쓰는 회원 전부. clientIds 가 없는 옛 회원권은 한 명이다. */
function clientIdsOf(pass) {
  const anchor = text(pass?.clientId);
  const listed = Array.isArray(pass?.clientIds) ? pass.clientIds.map(text).filter(Boolean) : [];
  if (!listed.length) return anchor ? [anchor] : [];
  return listed.includes(anchor) || !anchor ? listed : [anchor, ...listed];
}

/**
 * 지금 쓸 수 있는 회원권인가.
 *
 * 만료·취소된 것을 더하면 화면이 실제보다 많이 남았다고 말한다. 회원이 그
 * 숫자를 믿고 센터에 오면 그 자리에서 문제가 된다.
 */
function isUsablePass(pass, now) {
  if (text(pass?.status) !== PASS_STATUS_ACTIVE) return false;
  if (count(pass?.remainingCount) <= 0) return false;
  const expiresAt = toDate(pass?.expiresAt);
  return !expiresAt || expiresAt.getTime() >= now.getTime();
}

/**
 * 회원 하나의 투영.
 *
 * @param {{
 *   client?: any,
 *   passes?: Array<any>,
 *   ledger?: Array<any>,
 *   locationName?: string,
 *   instructorNames?: Record<string, string> | Map<string, string>,
 *   clientNames?: Record<string, string> | Map<string, string>,
 *   buildJourney?: ((input: any) => any) | null,
 *   instructorSessions?: number,
 *   now?: Date,
 * }} input
 *   client            organizations/{org}/clients/{clientId} 문서
 *   passes            그 회원의 회원권 전부 (끝난 것 포함)
 *   ledger            그 회원권들의 원장 항목
 *   locationName      지점 이름. id 가 아니다
 *   instructorNames   uid → 이름. 원장은 uid 만 들고 있다
 *   clientNames       clientId → 이름. 듀엣 상대를 부르는 데 쓴다
 *   buildJourney      앱의 pass-journey 계산. 없으면 journey 는 null
 *   instructorSessions 담당 강사 기준 누적. 여정의 "앱 이전" 구간에 쓴다
 * @returns {object | null} 회원이 누구인지 모르면 null
 */
function buildMemberView(input) {
  const client = input?.client || null;
  const clientId = text(client?.clientId || client?.id);
  if (!clientId) return null;

  const now = input?.now instanceof Date ? input.now : new Date();
  const lookup = (table, key) => {
    if (!table) return "";
    if (typeof table.get === "function") return text(table.get(key));
    return text(table[key]);
  };

  /* 취소된 회원권은 여정에도 목록에도 넣지 않는다. 잘못 발급해 되돌린 것이라
     그 회차는 일어나지 않았다 -- 잔여 0 이라고 다 쓴 것으로 그리면 오지 않은
     수업이 회원 화면에 남는다. */
  const all = (Array.isArray(input?.passes) ? input.passes : [])
    .filter(Boolean)
    .filter((pass) => clientIdsOf(pass).includes(clientId))
    .filter((pass) => text(pass.status) !== PASS_STATUS_CANCELLED);

  const passes = all.map((pass) => {
    const others = clientIdsOf(pass).filter((id) => id !== clientId);
    return {
      passId: text(pass.id || pass.passId),
      purchaseRound: count(pass.purchaseRound),
      totalSessions: count(pass.totalSessions),
      serviceSessions: count(pass.serviceSessions),
      remainingCount: count(pass.remainingCount),
      expiresAt: toDate(pass.expiresAt),
      status: text(pass.status),
      displayName: passDisplayName(pass.productId, input?.productNames),
      isDuet: others.length > 0,
      /* 듀엣 상대의 이름은 언제나 보여준다 (확정 2번). 이름을 모르면 빈
         문자열이고, 화면은 "함께 쓰는 분" 으로 적는다 -- uid 나 clientId 를
         내보내지 않는다. */
      partnerName: others.length ? lookup(input?.clientNames, others[0]) : "",
    };
  });

  const usable = all.filter((pass) => isUsablePass(pass, now));
  const expiryDates = usable.map((pass) => toDate(pass.expiresAt)).filter(Boolean);

  const passIds = new Set(passes.map((pass) => pass.passId).filter(Boolean));
  const history = (Array.isArray(input?.ledger) ? input.ledger : [])
    .filter(Boolean)
    .filter((entry) => HISTORY_TYPES.includes(text(entry.type)))
    .filter((entry) => passIds.has(text(entry.passId)))
    .map((entry) => ({
      occurredAt: toDate(entry.occurredAt),
      type: text(entry.type),
      /* 이름을 박아 둔다. 강사가 퇴사해도 그때 가르친 사람의 이름이 남아야
         한다 -- uid 를 내보내고 화면에서 찾게 하면 그 이름이 사라진다. */
      instructorName: lookup(input?.instructorNames, text(entry.instructorId)),
    }))
    .filter((entry) => entry.occurredAt)
    .sort((left, right) => right.occurredAt - left.occurredAt);

  /* 여정은 주입받은 계산이 만든다. 없으면 null 이고 화면은 그 줄을 그리지
     않는다 -- 지어낸 값을 넣는 것보다 없는 편이 낫다. */
  let journey = null;
  if (typeof input?.buildJourney === "function") {
    try {
      journey = input.buildJourney({
        passes: all,
        instructorSessions: count(input?.instructorSessions),
      }) || null;
    } catch (_error) {
      journey = null;
    }
  }

  return {
    organizationId: text(client.organizationId),
    clientId,
    /* 이 문서를 읽을 사람. 규칙이 이 값과 request.auth.uid 를 견준다.
       비어 있으면 아무도 읽지 못한다 -- 아직 연결되지 않은 회원이다. */
    userId: text(client.userId),
    name: text(client.name),
    locationName: text(input?.locationName),
    clientStatus: text(client.status),
    remainingTotal: usable.reduce((sum, pass) => sum + count(pass.remainingCount), 0),
    nextExpiresAt: expiryDates.length
      ? new Date(Math.min(...expiryDates.map((at) => at.getTime())))
      : null,
    passes,
    history,
    journey,
    updatedAt: now,
  };
}

module.exports = {
  FORBIDDEN_FIELDS,
  HISTORY_FIELDS,
  HISTORY_TYPES,
  PASS_FIELDS,
  VIEW_FIELDS,
  buildMemberView,
};
