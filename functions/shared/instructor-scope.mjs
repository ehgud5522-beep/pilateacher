/**
 * 강사가 보는 회원의 범위, 그리고 만료·재등록 판정.
 *
 * ── 왜 한 파일인가 ──
 * 세 곳이 같은 답을 내야 한다.
 *
 *   1. 트리거   clients.instructorIds 를 채운다 (Admin SDK)
 *   2. 강사 화면 "내 만료 회원" 과 재등록률
 *   3. 대표 화면 강사별 같은 표
 *
 * 화면마다 따로 세면 같은 회원이 한쪽에서는 만료이고 다른 쪽에서는 아니다. 그
 * 순간 두 숫자 중 어느 것도 믿을 수 없게 된다 -- 이 저장소에서 급여로 이미
 * 겪은 일이다 (일정 탭 ₩50,000 vs 월간 리포트 ₩0).
 *
 * ── 여기에 없는 것 ──
 * Firestore 읽기가 없다. 순수 함수만 둔다. 부르는 쪽이 회원권과 원장을 읽어
 * 넘긴다. 그래야 트리거와 화면이 같은 함수를 쓸 수 있다.
 *
 * 앱은 src/data/schema/instructor-scope.js 로 가져온다. 원본이 여기 있는 것은
 * **트리거가 같은 함수를 써야 하기 때문이다** -- Functions 는 functions/ 만
 * 배포되므로 src/ 를 가져올 수 없다. 두 벌이 되면 트리거가 채운 instructorIds
 * 와 화면이 세는 만료가 서로 다른 규칙을 따르게 된다.
 *
 * 자세한 배경은 docs/instructor-scope-plan.md 에 있다.
 */

import { PASS_STATUS } from "./constants.mjs";

/* Firestore Timestamp · Date · 문자열 · 숫자를 하나로. payroll-repository 의
   toDate 와 같은 판정이다. 저쪽을 부르지 않는 것은 방향 때문이다 -- schema 가
   repositories 를 참조하면 트리거(Functions)가 이 파일을 가져올 때 앱의 읽기
   계층까지 딸려 온다. */
function timeOf(value) {
  if (value === undefined || value === null || value === "") return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === "function") {
    try { return value.toDate().getTime(); } catch (_error) { return NaN; }
  }
  if (typeof value === "number") return value;
  return new Date(String(value)).getTime();
}

const text = (value) => String(value ?? "").trim();

/** 만료 사유. 화면 문구는 EXPIRY_REASON_LABELS 에 있다. */
export const EXPIRY_REASON = Object.freeze({
  /** 회차를 다 썼다. */
  USED_UP: "used_up",
  /** 회차가 남았는데 날짜가 지났다. */
  DATE_PASSED: "date_passed",
  /** 사람이 끊었다 -- 취소·환불. */
  CANCELLED: "cancelled",
});

export const EXPIRY_REASON_LABELS = Object.freeze({
  [EXPIRY_REASON.USED_UP]: "소진",
  [EXPIRY_REASON.DATE_PASSED]: "기간 만료",
  [EXPIRY_REASON.CANCELLED]: "취소",
});

/** 만료 후 이 기간 안에 새 회원권이 나가면 재등록이다. */
export const REENROLL_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const remainingOf = (pass) => {
  const count = pass?.remainingCount;
  return Number.isInteger(count) && count >= 0 ? count : 0;
};

/**
 * 이 회원권이 지금 살아 있는가.
 *
 * pass-repository 의 isDeductablePass 와 같은 판정이다. 저쪽은 "차감할 수
 * 있는가" 를 묻고 이쪽은 "담당강사가 아직 이 회원을 보는가" 를 묻는데, 답이
 * 같아야 한다 -- 차감할 수 있는 회원권을 가진 회원이 강사 목록에서 사라지면
 * 그 강사는 출석 체크를 못 한다.
 *
 * @param {any} pass @param {Date} [now]
 */
export function isLivePass(pass, now = new Date()) {
  if (pass?.status !== PASS_STATUS.ACTIVE) return false;
  if (remainingOf(pass) <= 0) return false;
  const expiry = timeOf(pass?.expiresAt);
  /* 만료일을 못 읽으면 살아 있는 것으로 본다. 읽히지 않는 값 때문에 회원을
     강사에게서 빼앗지 않는다 -- 그 실수는 화면에서 드러나지 않고, 강사는
     회원이 없어진 이유를 물을 곳이 없다. */
  if (!Number.isFinite(expiry)) return true;
  return expiry >= now.getTime();
}

/**
 * 끝난 회원권 하나의 사유와 시점.
 *
 * ── lastDeductedAt 을 왜 받는가 ──
 * 소진의 만료일은 **회원권 문서에 없다.** 마지막 차감이 일어난 날이고 그것은
 * 원장에 있다. 부르는 쪽이 읽어 넘긴다. 못 넘기면 at 이 null 로 나가고 화면은
 * 날짜 자리를 비운다 -- 틀린 날짜를 지어내지 않는다.
 *
 * @param {any} pass
 * @param {{ now?: Date, lastDeductedAt?: any }} [options]
 * @returns {{ live: boolean, reason: string, at: Date|null }}
 */
export function passExpiry(pass, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  if (isLivePass(pass, now)) return { live: true, reason: "", at: null };

  const expiryTime = timeOf(pass?.expiresAt);
  const expiresAt = Number.isFinite(expiryTime) ? new Date(expiryTime) : null;

  if (pass?.status === PASS_STATUS.CANCELLED) {
    return { live: false, reason: EXPIRY_REASON.CANCELLED, at: expiresAt };
  }

  /* 순서가 있다. 회차를 다 쓴 뒤에 날짜도 지났다면 그 회원권은 **소진**으로
     끝난 것이다 -- 강사가 재등록 상담에서 할 말이 다르다. "다 쓰셨어요" 와
     "기간이 지났어요" 는 같은 만료가 아니다. */
  if (remainingOf(pass) <= 0) {
    const deducted = timeOf(options.lastDeductedAt);
    return {
      live: false,
      reason: EXPIRY_REASON.USED_UP,
      at: Number.isFinite(deducted) ? new Date(deducted) : null,
    };
  }

  return { live: false, reason: EXPIRY_REASON.DATE_PASSED, at: expiresAt };
}

/* 발급 시각. 같으면 id 로 가른다 -- 한 배치로 두 장이 나가면 createdAt 이
   같은 serverTimestamp 가 되고, 그때 "가장 최근" 이 실행마다 달라진다. */
const issuedTimeOf = (pass) => {
  const at = timeOf(pass?.createdAt);
  return Number.isFinite(at) ? at : 0;
};

function latestPass(passes) {
  return passes.reduce((latest, pass) => {
    if (!latest) return pass;
    const gap = issuedTimeOf(pass) - issuedTimeOf(latest);
    if (gap > 0) return pass;
    if (gap < 0) return latest;
    return text(pass?.id) > text(latest?.id) ? pass : latest;
  }, null);
}

/**
 * 이 회원을 보는 강사들.
 *
 * ── 규칙 ──
 * 1. 살아 있는 회원권의 담당강사 전부
 * 2. 살아 있는 것이 하나도 없으면 -- **가장 최근 회원권의 담당강사 한 명**.
 *    기한 없이 남는다. 만료 회원도 담당이 있어야 재등록 상담을 한다.
 *
 * ── 인수인계가 왜 자동으로 처리되는가 ──
 * 인수인계는 회원권의 instructorId 자체를 바꾼다. 그러면 1번으로 새 강사가
 * 들어오고 이전 강사는 그 자리에서 사라진다 -- 따로 뺄 것이 없다.
 *
 * 반대로 **재등록은 즉시 빼지 않는다.** A 의 회원권이 아직 살아 있는데 B 가
 * 새로 발급했다면 A 는 아직 그 회원을 가르치고 있다. A 는 자기 회원권이 끝날
 * 때 빠진다.
 *
 * @param {Array<any>} passes 이 회원의 회원권 전부 (듀엣이면 그 회원이 낀 것)
 * @param {{ now?: Date }} [options]
 * @returns {Array<string>} 강사 uid. 중복 없음, 정렬됨
 */
export function instructorIdsFor(passes, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const all = (Array.isArray(passes) ? passes : []).filter(Boolean);

  const live = all.filter((pass) => isLivePass(pass, now));
  const source = live.length ? live : [latestPass(all)].filter(Boolean);

  const ids = new Set();
  source.forEach((pass) => {
    const instructorId = text(pass?.instructorId);
    if (instructorId) ids.add(instructorId);
  });
  return [...ids].sort();
}

/**
 * 이 회원이 만료 회원인가, 그렇다면 왜 언제.
 *
 * 살아 있는 회원권이 **하나도 없으면** 만료다. 사유와 날짜는 가장 최근에 끝난
 * 회원권에서 가져온다.
 *
 * @param {Array<any>} passes
 * @param {{ now?: Date, lastDeductedAtByPassId?: Record<string, any>|Map<string, any> }} [options]
 * @returns {{ expired: boolean, reason: string, at: Date|null, passId: string, instructorId: string }}
 */
export function clientExpiry(passes, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const all = (Array.isArray(passes) ? passes : []).filter(Boolean);
  const none = { expired: false, reason: "", at: null, passId: "", instructorId: "" };

  if (!all.length) return none;
  if (all.some((pass) => isLivePass(pass, now))) return none;

  const lookup = options.lastDeductedAtByPassId;
  const deductedAt = (passId) => (lookup && typeof lookup.get === "function"
    ? lookup.get(passId)
    : lookup?.[passId]);

  /* 끝난 시점이 가장 늦은 것을 고른다. 발급 순서가 아니다 -- 먼저 발급한
     회원권을 나중까지 쓰는 일이 실제로 있고, 그때 재등록 창(30일)의 기준이
     되는 것은 **마지막으로 수업이 끝난 날**이다. */
  const ended = all
    .map((pass) => ({ pass, expiry: passExpiry(pass, { now, lastDeductedAt: deductedAt(text(pass?.id)) }) }))
    .filter((item) => !item.expiry.live);
  if (!ended.length) return none;

  const last = ended.reduce((latest, item) => {
    const left = latest.expiry.at ? latest.expiry.at.getTime() : -Infinity;
    const right = item.expiry.at ? item.expiry.at.getTime() : -Infinity;
    if (right > left) return item;
    if (right < left) return latest;
    // 날짜를 모르는 것끼리는 발급 순서로 가른다.
    return issuedTimeOf(item.pass) > issuedTimeOf(latest.pass) ? item : latest;
  });

  return {
    expired: true,
    reason: last.expiry.reason,
    at: last.expiry.at,
    passId: text(last.pass?.id),
    instructorId: text(last.pass?.instructorId),
  };
}

/**
 * 만료 후 이 회원권이 재등록인가.
 *
 * **만료일 당일이 0일째다.** 30일 창이면 만료일로부터 30일째까지가 재등록이고
 * 31일째는 아니다. 경계는 테스트로 못 박혀 있다.
 *
 * 담당강사는 보지 않는다 -- 다른 강사에게 재등록했어도 그 회원은 돌아온
 * 것이고, 이전 강사의 "만료했지만 돌아왔다" 에 들어간다.
 *
 * @param {Date|any} expiredAt @param {Date|any} issuedAt
 * @param {{ windowDays?: number }} [options]
 */
export function isReenrollment(expiredAt, issuedAt, options = {}) {
  const from = timeOf(expiredAt);
  const to = timeOf(issuedAt);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
  if (to < from) return false;
  const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : REENROLL_WINDOW_DAYS;
  return to - from <= windowDays * DAY_MS;
}

/**
 * 이 회원에게 일어난 **만료 사건** 전부. 끝난 회원권 하나가 사건 하나다.
 *
 * ── clientExpiry 와 무엇이 다른가 ──
 * clientExpiry 는 **지금 만료 회원인가**를 묻는다 (회원 탭의 만료 칩).
 * 이쪽은 **언제 만료했었나**를 묻는다 (이번 달 / 지난달 현황).
 *
 * 둘은 다른 질문이고, 섞으면 숫자가 조용히 틀린다. 돌아왔다가 또 만료한
 * 회원을 마지막 만료만 보고 세면 "재등록 안 함"이 된다 -- 실제로는 한 번
 * 돌아왔는데도.
 *
 * @param {Array<any>} passes
 * @param {{ now?: Date, lastDeductedAtByPassId?: Record<string, any>|Map<string, any> }} [options]
 * @returns {Array<{ passId: string, instructorId: string, reason: string, at: Date|null }>}
 *   만료 시점 오름차순. 시점을 모르는 것은 앞에 온다.
 */
export function expiryEventsFor(passes, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const lookup = options.lastDeductedAtByPassId;
  const deductedAt = (passId) => (lookup && typeof lookup.get === "function"
    ? lookup.get(passId)
    : lookup?.[passId]);

  return (Array.isArray(passes) ? passes : [])
    .filter(Boolean)
    .map((pass) => ({ pass, expiry: passExpiry(pass, { now, lastDeductedAt: deductedAt(text(pass?.id)) }) }))
    .filter((item) => !item.expiry.live)
    .map((item) => ({
      passId: text(item.pass?.id),
      instructorId: text(item.pass?.instructorId),
      reason: item.expiry.reason,
      at: item.expiry.at,
      issuedAt: issuedTimeOf(item.pass),
    }))
    .sort((left, right) => {
      const gap = (left.at ? left.at.getTime() : -Infinity) - (right.at ? right.at.getTime() : -Infinity);
      return gap !== 0 ? gap : left.issuedAt - right.issuedAt;
    });
}

/**
 * 이 만료 뒤에 회원이 돌아왔는가.
 *
 * 돌아왔다 = 만료일로부터 창(기본 30일) 안에 **다른 회원권이 나갔다.**
 * 담당강사는 보지 않는다 -- 다른 강사에게 재등록했어도 그 회원은 돌아온 것이다.
 *
 * @returns {"returned"|"gone"|"pending"}
 *   pending 은 아직 창이 안 끝난 것이다. 만료한 지 사흘 된 회원을 "안 돌아옴"
 *   으로 세면 이번 달 재등록률이 늘 낮게 나오고, 그 숫자를 보고 판단하면
 *   틀린다.
 */
export function returnOutcome(event, passes, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const windowDays = Number.isFinite(options.windowDays) ? options.windowDays : REENROLL_WINDOW_DAYS;
  const returned = (Array.isArray(passes) ? passes : []).filter(Boolean).some((pass) => {
    if (text(pass?.id) === event.passId) return false;
    return isReenrollment(event.at, pass?.createdAt, { windowDays });
  });
  if (returned) return "returned";
  const at = event.at ? event.at.getTime() : NaN;
  if (Number.isFinite(at) && now.getTime() - at < windowDays * DAY_MS) return "pending";
  return "gone";
}

/**
 * 강사 한 명의 만료·재등록 집계.
 *
 * **강사 화면과 대표 화면이 이 함수 하나를 쓴다.** 대표 화면은 강사마다 한 번씩
 * 부른다 -- 따로 세면 두 화면의 숫자가 갈라지고, 그러면 비교가 의미를 잃는다.
 *
 * ── 무엇을 세는가 ──
 * 회원 수다, 만료 건수가 아니다. 한 회원이 두 번 만료했으면 기간 안의 **가장
 * 최근 만료** 하나로 센다.
 *
 * ── 인수인계로 옮겨간 회원 ──
 * 만료 사건은 그 회원권의 담당강사를 들고 있다. 인수인계되면 회원권의
 * instructorId 자체가 새 강사이므로 이전 강사의 집계에 들어오지 않는다.
 *
 * @param {Array<{ clientId: string, name?: string, passes: Array<any> }>} rows
 * @param {{ instructorId?: string, now?: Date, within?: { start: Date, end: Date },
 *   lastDeductedAtByPassId?: any, windowDays?: number }} [options]
 */
export function summarizeExpiries(rows, options = {}) {
  const instructorId = text(options.instructorId);
  const within = options.within;
  const members = [];

  (Array.isArray(rows) ? rows : []).filter(Boolean).forEach((row) => {
    const events = expiryEventsFor(row.passes, options)
      .filter((event) => (instructorId ? event.instructorId === instructorId : true))
      .filter((event) => {
        if (!within) return true;
        /* 기간을 물었는데 만료일을 모르면 셀 수 없다 -- 어느 달에 넣을지
           정할 근거가 없다. 아무 달에나 넣는 것보다 빼는 편이 낫다. */
        if (!event.at) return false;
        const at = event.at.getTime();
        return at >= within.start.getTime() && at < within.end.getTime();
      });
    if (!events.length) return;

    const anchor = events[events.length - 1];
    const outcome = returnOutcome(anchor, row.passes, options);
    members.push({
      clientId: text(row.clientId),
      name: text(row.name),
      reason: anchor.reason,
      at: anchor.at,
      outcome,
      reenrolled: outcome === "returned",
    });
  });

  members.sort((left, right) => {
    const gap = (right.at ? right.at.getTime() : 0) - (left.at ? left.at.getTime() : 0);
    return gap !== 0 ? gap : left.clientId.localeCompare(right.clientId);
  });

  const expired = members.length;
  const reenrolled = members.filter((member) => member.reenrolled).length;
  const pending = members.filter((member) => member.outcome === "pending").length;
  /* 비율의 분모에서 pending 을 뺀다. 아직 30일이 안 지난 회원을 "안 돌아옴"
     으로 세면 이번 달 재등록률이 늘 낮게 나온다 -- 달이 끝나고 나서야 참값이
     되는 숫자를 달 중간에 보고 판단하게 된다. */
  const decided = expired - pending;
  return {
    expired,
    reenrolled,
    pending,
    rate: decided > 0 ? reenrolled / decided : 0,
    members,
  };
}
