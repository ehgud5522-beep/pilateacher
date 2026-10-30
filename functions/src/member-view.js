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

/**
 * 회원권 한 건에서 내보낼 것. 이 목록에 없는 필드는 나가지 않는다.
 *
 * ── 상품명과 차수는 나가지 않는다 (2026-10-30, 대표 결정) ──
 * 상품명에는 "깍두기 · 양도권 · 세일즈" 같은 센터 안의 이름이 붙고, 차수는
 * 재등록 몇 번째인지다. 둘 다 관리용이고 회원이 볼 것이 아니다. 회원 화면은
 * 수업 유형과 횟수로 이름을 짓는다 ("1:1 필라테스 수업 10회") -- 그 재료만
 * 내보낸다. 화면에서 가리는 것으로 끝내지 않는 이유는 이 문서가 통째로 회원
 * 폰에 내려가기 때문이다.
 */
const PASS_FIELDS = Object.freeze([
  "passId", "lessonType", "totalSessions", "serviceSessions",
  "remainingCount", "expiresAt", "status", "isDuet", "partnerName",
]);

/** 회원 화면이 이름을 짓는 수업 유형. 급여카테고리 문자열을 그대로 내보내지 않는다. */
const LESSON_TYPE = Object.freeze({
  SOLO: "1:1",
  DUET: "2:1",
  DIOSA: "diosa",
  OTHER: "other",
});

/* functions/shared/constants.mjs 의 값과 같다 (SESSION_TYPE · DIOSA_CATEGORIES).
   이 파일은 CommonJS 라 그 모듈을 require 하지 않고 값만 적는다 -- 같은지는
   tests/member-view.test.js 가 본다. */
const SESSION_TYPE_SOLO = "pt_1_1";
const SESSION_TYPE_DUET = "pt_2_1";
const DIOSA_CATEGORIES = Object.freeze(["diosa_a", "diosa_b"]);

/**
 * 이 회원권은 어떤 수업인가.
 *
 * 상품이 스스로 말하는 sessionType 이 먼저다. 없는 옛 상품과 이관분은 회원권의
 * 급여카테고리로 가른다 (앱의 productGroupOf 와 같은 순서). 그래도 모르면 두
 * 사람이 함께 쓰는 회원권은 2:1 이다. 나머지는 "other" -- 화면이 유형 없이
 * "필라테스 수업 N회" 로 부른다.
 */
function lessonTypeOf(pass, productSessionTypes, shared) {
  const productId = text(pass?.productId);
  const sessionType = productSessionTypes && typeof productSessionTypes.get === "function"
    ? text(productSessionTypes.get(productId))
    : text(productSessionTypes?.[productId]);
  if (sessionType === SESSION_TYPE_SOLO) return LESSON_TYPE.SOLO;
  if (sessionType === SESSION_TYPE_DUET) return LESSON_TYPE.DUET;
  const category = text(pass?.category);
  if (category.startsWith("pt_1_1")) return LESSON_TYPE.SOLO;
  if (category.startsWith("pt_2_1")) return LESSON_TYPE.DUET;
  if (DIOSA_CATEGORIES.includes(category)) return LESSON_TYPE.DIOSA;
  if (shared) return LESSON_TYPE.DUET;
  return LESSON_TYPE.OTHER;
}

/** 수업 이력 한 건에서 내보낼 것. */
/* lessonType 은 그 수업이 어떤 회원권에서 차감됐는지로 정한다 -- 회원 앱이
   이력 한 줄을 "1:1 필라테스 수업" 으로 부른다 (2026-10-30). passId 는 내보내지
   않는다. */
const HISTORY_FIELDS = Object.freeze(["occurredAt", "type", "lessonType", "instructorName", "memberNote"]);

/**
 * 회원에게 보낼 말의 길이.
 *
 * 짧아야 하는 이유가 있다. 이것은 수업기록이 아니라 회원에게 건네는 한두
 * 문장이고, 길어지면 강사가 내부 기록을 여기에 옮겨 적게 된다 -- 그 순간
 * 두 칸을 나눈 이유가 사라진다. 화면도 같은 값으로 막는다.
 */
const MEMBER_NOTE_MAX = 200;

/**
 * 이 이력 한 건에 붙는 회원용 문구.
 *
 * 차감에만 붙인다. 되돌린 차감(correction)과 담당 강사 변경(transfer)은 그
 * 수업에 대한 말이 아니고, 같은 문구를 두 줄에 겹쳐 보여 주면 회원은 수업이
 * 두 번 있었다고 읽는다.
 *
 * 길이를 여기서도 자른다. 화면과 리포지토리가 이미 막지만, 투영은 원본이
 * 무엇이든 회원에게 나가는 마지막 관문이라 스스로 지켜야 한다.
 */
function memberNoteFor(entry, notes) {
  if (text(entry?.type) !== LEDGER_TYPE_DEDUCT) return "";
  const lessonId = text(entry?.lessonId);
  if (!lessonId) return "";
  const found = notes && typeof notes.get === "function"
    ? text(notes.get(lessonId))
    : text(notes?.[lessonId]);
  return found.slice(0, MEMBER_NOTE_MAX);
}

/**
 * 예정 수업 한 건에서 내보낼 것 (2026-10-30, 대표 결정).
 *
 * 날짜 · 시간 · 수업 이름의 재료(유형) · 담당 강사 · 지점만. **강사 메모, 상품명,
 * 차수, 단가는 담지 않는다** -- 일정 문서에도 메모는 없지만, 여기서 한 번 더
 * 고른다. 다른 회원(듀엣 상대)의 id 도 내보내지 않는다.
 */
const SCHEDULE_FIELDS = Object.freeze(["startsAt", "endsAt", "lessonType", "instructorName", "locationName"]);

/** 회원 화면이 오늘 지난 수업도 그날 칸에 보이게, 하루 전부터 싣는다. */
const SCHEDULE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_MAX = 60;

/** 투영 문서의 최상위. */
const VIEW_FIELDS = Object.freeze([
  "organizationId", "clientId", "userId", "name", "locationName", "clientStatus",
  "remainingTotal", "nextExpiresAt", "passes", "history", "schedule", "journey", "updatedAt",
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
  /* 강사가 자기를 위해 쓴 수업기록. 회원에게 나가는 것은 강사가 따로 적은
     memberNote 한 줄뿐이고, 원문은 어떤 모양으로도 여기에 실리지 않는다. */
  "notes", "lessonRecord", "confirmedRecord", "transcript", "rawTranscript", "aiMemory",
]);

/** 회원에게 보여 줄 이력의 종류. 발급·취소는 회원권 목록에 이미 있다. */
const HISTORY_TYPES = Object.freeze(["deduct", "correction", "transfer"]);

const PASS_STATUS_ACTIVE = "active";
const PASS_STATUS_CANCELLED = "cancelled";
const LEDGER_TYPE_DEDUCT = "deduct";

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
 *   productSessionTypes?: Record<string, string> | Map<string, string>,
 *   instructorNames?: Record<string, string> | Map<string, string>,
 *   clientNames?: Record<string, string> | Map<string, string>,
 *   buildJourney?: ((input: any) => any) | null,
 *   instructorSessions?: number,
 *   now?: Date,
 * }} input
 *   client            organizations/{org}/clients/{clientId} 문서
 *   passes            그 회원의 회원권 전부 (끝난 것 포함)
 *   ledger            그 회원권들의 원장 항목
 *   memberNotes       lessonId → 강사가 회원에게 보내려고 적은 말
 *   locationName      지점 이름. id 가 아니다
 *   productSessionTypes productId → 상품의 sessionType. 수업 유형을 가른다
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
      lessonType: lessonTypeOf(pass, input?.productSessionTypes, others.length > 0),
      totalSessions: count(pass.totalSessions),
      serviceSessions: count(pass.serviceSessions),
      remainingCount: count(pass.remainingCount),
      expiresAt: toDate(pass.expiresAt),
      status: text(pass.status),
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
  const lessonTypeByPass = new Map(passes.map((pass) => [pass.passId, pass.lessonType]));
  const history = (Array.isArray(input?.ledger) ? input.ledger : [])
    .filter(Boolean)
    .filter((entry) => HISTORY_TYPES.includes(text(entry.type)))
    .filter((entry) => passIds.has(text(entry.passId)))
    .map((entry) => ({
      occurredAt: toDate(entry.occurredAt),
      type: text(entry.type),
      lessonType: lessonTypeByPass.get(text(entry.passId)) || LESSON_TYPE.OTHER,
      /* 이름을 박아 둔다. 강사가 퇴사해도 그때 가르친 사람의 이름이 남아야
         한다 -- uid 를 내보내고 화면에서 찾게 하면 그 이름이 사라진다. */
      instructorName: lookup(input?.instructorNames, text(entry.instructorId)),
      /* 강사가 회원에게 보내려고 따로 적은 말. 수업기록 원문이 아니다 --
         원문은 강사가 다음 수업을 준비하려고 쓴 글이고 읽는 사람이 다르다.
         두 칸이 나뉘어 있다는 것이 이 줄의 전부다. */
      memberNote: memberNoteFor(entry, input?.memberNotes),
    }))
    .filter((entry) => entry.occurredAt)
    .sort((left, right) => right.occurredAt - left.occurredAt);

  /* 여정은 주입받은 계산이 만든다. 없으면 null 이고 화면은 그 줄을 그리지
     않는다 -- 지어낸 값을 넣는 것보다 없는 편이 낫다.

     회원 화면이 쓰는 것은 "지금까지 몇 번" 하나다. 계산 결과에는 회차마다의
     차수(round · currentRound)와 passId 가 들어 있어서, 통째로 내보내면 위에서
     뺀 차수가 여기로 다시 나간다. 쓰는 숫자만 고른다. */
  let journey = null;
  if (typeof input?.buildJourney === "function") {
    try {
      const built = input.buildJourney({
        passes: all,
        instructorSessions: count(input?.instructorSessions),
      });
      journey = built ? { usedTotal: count(built.usedTotal) } : null;
    } catch (_error) {
      journey = null;
    }
  }

  /* 예정 수업. 지난 것과 취소된 것은 싣지 않는다 -- 취소는 목록에서 사라지는
     것으로 충분하다 ("취소됨" 을 따로 그리지 않는다). */
  const from = now.getTime() - SCHEDULE_LOOKBACK_MS;
  /* 예정 수업을 못 읽었으면(null) null 로 둔다 -- 빈 배열은 "없다" 이고 null 은
     "모른다" 다. 회원 화면이 둘을 다르게 말한다. */
  const schedule = input?.scheduled === null ? null : (Array.isArray(input?.scheduled) ? input.scheduled : [])
    .filter((lesson) => lesson && text(lesson.status) === "scheduled")
    .filter((lesson) => clientIdsOf(lesson).includes(clientId))
    .map((lesson) => ({
      startsAt: toDate(lesson.startsAt),
      endsAt: toDate(lesson.endsAt),
      lessonType: Object.values(LESSON_TYPE).includes(text(lesson.lessonType))
        ? text(lesson.lessonType) : LESSON_TYPE.OTHER,
      instructorName: lookup(input?.instructorNames, text(lesson.instructorId)),
      locationName: lookup(input?.locationNames, text(lesson.locationId)) || text(input?.locationName),
    }))
    .filter((lesson) => lesson.startsAt && lesson.startsAt.getTime() >= from)
    .sort((left, right) => left.startsAt - right.startsAt)
    .slice(0, SCHEDULE_MAX);

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
    schedule,
    journey,
    updatedAt: now,
  };
}

module.exports = {
  FORBIDDEN_FIELDS,
  HISTORY_FIELDS,
  HISTORY_TYPES,
  LESSON_TYPE,
  MEMBER_NOTE_MAX,
  PASS_FIELDS,
  SCHEDULE_FIELDS,
  VIEW_FIELDS,
  buildMemberView,
};
