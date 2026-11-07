/**
 * 회원 앱 수업 취소 — 판정 한 벌 (2026-11-07, 5차 1단계). **순수 함수만 둔다.**
 *
 * 서버(functions/src/member-cancel.js) · 강사 앱 · 회원 앱이 같은 파일을 쓴다.
 * 마감 · 남은 횟수 · 막힌 이유가 세 곳에서 따로 계산되면 화면이 "취소할 수
 * 있어요" 라고 하는데 서버가 거절하는 일이 생긴다. 결정은 서버가 하고, 화면은
 * 같은 계산으로 미리 보여 줄 뿐이다.
 *
 * ── 대표 결정 ──
 * - 수업 시작 24시간 전까지 회원이 직접 취소. 마감은 **서버 시각**으로 계산한다
 * - 취소 가능 횟수는 대표 설정값(runtimeConfig/scheduleSync.memberCancel.limit).
 *   **여기에 숫자를 두지 않는다** -- 설정이 비어 있으면 기능이 꺼진 것이다
 * - 적용 기간: 월 기준(month) 또는 회원권 기준(pass). 대표 설정
 * - 성공한 취소만 횟수를 쓴다. 강사가 다시 일정에 넣어도 돌려주지 않는다 --
 *   필요하면 담당 강사가 추가 부여한다
 * - 스위치가 켜진 강사(시범)의 수업만, 그리고 그 강사의 일정 동기화가 켜져 있을
 *   때만 -- 동기화가 꺼진 기기는 서버의 취소를 받지 못해, 강사가 모르는 취소가 된다
 */

const text = (value) => String(value ?? "").trim();

/** 마감: 수업 시작 몇 시간 전까지 (대표 결정 24시간). 정책이지 설정이 아니다. */
export const CANCEL_DEADLINE_HOURS = 24;

export const MEMBER_CANCEL_MODE = Object.freeze({ OFF: "off", LISTED: "listed", ALL: "all" });
export const MEMBER_CANCEL_PERIOD = Object.freeze({ MONTH: "month", PASS: "pass" });

/** 추가 부여 한 번의 범위. 사유는 반드시 적는다. */
export const GRANT_LIMITS = Object.freeze({ minAmount: 1, maxAmount: 10, maxReason: 200 });

/** 대표 설정의 횟수 범위. 0 은 "직접 취소를 받지 않는다(추가 부여만)" 이다. */
export const LIMIT_RANGE = Object.freeze({ min: 0, max: 20 });

/**
 * 설정 화면이 **처음 비어 있을 때 칸에 채워 보여 줄** 값 (대표 결정: 기본 3회).
 * 서버 판정은 이 값을 쓰지 않는다 -- 대표가 저장한 값만 쓰고, 저장 전에는 꺼져 있다.
 */
export const DEFAULT_LIMIT_HINT = 3;

/**
 * 왜 취소하지 못하는가. 화면 문구 · 진단이 이 코드 하나로 이어진다
 * (member/src/cancel-copy.js · 테스트가 코드 → 문구를 고정한다).
 */
export const CANCEL_REASON = Object.freeze({
  /** 기능이 꺼져 있다 (스위치 · 시범 강사 밖 · 동기화 꺼짐 · 설정 없음). 버튼을 그리지 않는다. */
  FEATURE_OFF: "feature_off",
  NOT_FOUND: "lesson_not_found",
  /** 이 회원의 예약이 아니다. */
  NOT_OWN: "not_own_lesson",
  /** 이미 확정된 수업. */
  SETTLED: "lesson_settled",
  /** 강사가 취소 · 삭제한 수업. */
  CANCELLED: "lesson_cancelled",
  /** 이 회원이 이미 취소했다 -- 중복 클릭. 오류가 아니라 성공으로 돌려준다. */
  ALREADY: "already_cancelled",
  DEADLINE: "deadline_passed",
  NO_REMAINING: "no_remaining",
  /** 회원권 기준인데 쓸 수 있는 회원권이 없다. */
  NO_PASS: "no_active_pass",
});

const MS_HOUR = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * MS_HOUR;

export function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?._seconds === "number") return new Date(value._seconds * 1000);
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at : null;
}

/**
 * 설정 한 벌. **못 읽거나 비어 있으면 꺼진 것이다** -- 회원이 센터 일정을 바꾸는
 * 자리라, 모르면 켜지 않는다 (sync-switch.js 와 같은 쪽).
 *
 * @returns {{ mode: string, userIds: string[], limit: number | null, period: string, configured: boolean }}
 */
export function readMemberCancelConfig(raw) {
  const modes = /** @type {string[]} */ (Object.values(MEMBER_CANCEL_MODE));
  const periods = /** @type {string[]} */ (Object.values(MEMBER_CANCEL_PERIOD));
  const mode = modes.includes(text(raw?.mode)) ? text(raw.mode) : MEMBER_CANCEL_MODE.OFF;
  const userIds = [...new Set((Array.isArray(raw?.userIds) ? raw.userIds : []).map(text).filter(Boolean))];
  const rawLimit = raw?.limit;
  const limit = rawLimit !== null && rawLimit !== undefined && rawLimit !== "" && Number.isInteger(Number(rawLimit))
    && Number(rawLimit) >= LIMIT_RANGE.min && Number(rawLimit) <= LIMIT_RANGE.max
    ? Number(rawLimit) : null;
  const period = periods.includes(text(raw?.period)) ? text(raw.period) : "";
  return { mode, userIds, limit, period, configured: limit !== null && Boolean(period) };
}

/** 일정 동기화가 이 강사에게 켜져 있는가 (sync-switch.js 의 scheduleSyncEnabledFor 와 같은 답). */
function scheduleSyncOn(syncRaw, userId) {
  const mode = text(syncRaw?.mode);
  if (mode === "all") return true;
  if (mode === "listed") return (Array.isArray(syncRaw?.userIds) ? syncRaw.userIds : []).map(text).includes(text(userId));
  return false;
}

/**
 * 이 강사의 수업에 회원 취소를 받는가.
 *
 * @param {any} scheduleSyncDoc runtimeConfig/scheduleSync 문서 전체 (memberCancel 칸이 그 안에 산다)
 * @param {string} instructorId 수업의 담당 강사
 */
export function memberCancelEnabledFor(scheduleSyncDoc, instructorId) {
  const config = readMemberCancelConfig(scheduleSyncDoc?.memberCancel);
  if (!config.configured || !text(instructorId)) return false;
  if (config.mode === MEMBER_CANCEL_MODE.OFF) return false;
  if (config.mode === MEMBER_CANCEL_MODE.LISTED && !config.userIds.includes(text(instructorId))) return false;
  return scheduleSyncOn(scheduleSyncDoc, instructorId);
}

/** 취소 마감 시각. */
export function cancelDeadline(startsAt) {
  const at = toDate(startsAt);
  return at ? new Date(at.getTime() - CANCEL_DEADLINE_HOURS * MS_HOUR) : null;
}

/** 한국 시각의 달 "2026-11". 서버가 UTC 여도 센터의 달로 센다. */
export function monthKey(at) {
  const date = toDate(at);
  if (!date) return "";
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 횟수를 세는 칸. 월 기준이면 **취소하는 달**(한국 시각), 회원권 기준이면 그 회원권.
 * 세지 못하면 빈 문자열.
 *
 * @param {{ period?: string, at?: any, passId?: string }} [input]
 */
export function bucketKey({ period, at, passId } = {}) {
  if (period === MEMBER_CANCEL_PERIOD.MONTH) {
    const month = monthKey(at);
    return month ? `m:${month}` : "";
  }
  if (period === MEMBER_CANCEL_PERIOD.PASS) return text(passId) ? `p:${text(passId)}` : "";
  return "";
}

/** 칸 하나의 사용 · 추가. 없는 칸은 0 이다. */
export function bucketOf(ledger, key) {
  const row = ledger?.buckets?.[key] || {};
  const count = (value) => Math.max(0, Math.floor(Number(value) || 0));
  return { used: count(row.used), granted: count(row.granted) };
}

/** 남은 취소 가능 횟수 = 설정 + 추가 부여 − 사용. 음수가 되지 않는다. */
export function remainingIn(ledger, key, limit) {
  const { used, granted } = bucketOf(ledger, key);
  return Math.max(0, (Number(limit) || 0) + granted - used);
}

const clientIdsOf = (lesson) => {
  const list = Array.isArray(lesson?.clientIds) ? lesson.clientIds.map(text).filter(Boolean) : [];
  return list.length ? list : (text(lesson?.clientId) ? [text(lesson.clientId)] : []);
};

/** 이 회원이 이 수업을 이미 취소했는가 (서버가 남긴 표시). */
export function cancelledByMember(lesson, clientId) {
  const mark = lesson?.memberCancellations?.[text(clientId)];
  return Boolean(mark && typeof mark === "object");
}

/**
 * 취소해도 되는가. 차례가 곧 우선순위다 -- 화면에는 가장 먼저 걸린 이유 하나만 말한다.
 *
 * 1. 기능 꺼짐 → 2. 수업 없음 → 3. 이미 내가 취소함(중복 클릭) → 4. 내 예약 아님 →
 * 5. 확정됨 → 6. 강사가 취소함 → 7. 마감 지남 → 8. 회원권 없음(회원권 기준) → 9. 횟수 없음
 *
 * 3 이 4 보다 앞이다: 듀엣에서 취소하면 그 회원은 clientIds 에서 빠지므로, 두 번째
 * 클릭이 "내 예약 아님" 으로 읽히면 성공한 취소가 오류 화면이 된다.
 *
 * @param {{
 *   now: Date, lesson: any, clientId: string, scheduleSyncDoc: any,
 *   ledger?: any, passId?: string,
 * }} input
 * @returns {{ ok: boolean, reason: string, deadline: Date | null, bucket: string, limit: number | null, remaining: number | null, period: string }}
 */
export function decideMemberCancel(input) {
  const now = toDate(input?.now) || new Date();
  const lesson = input?.lesson || null;
  const clientId = text(input?.clientId);
  const config = readMemberCancelConfig(input?.scheduleSyncDoc?.memberCancel);
  const deadline = cancelDeadline(lesson?.startsAt);
  const base = { deadline, bucket: "", limit: config.limit, remaining: null, period: config.period };
  const refuse = (reason, extra = {}) => ({ ok: false, reason, ...base, ...extra });

  if (!lesson) return refuse(CANCEL_REASON.NOT_FOUND);
  if (!memberCancelEnabledFor(input?.scheduleSyncDoc, text(lesson.instructorId))) return refuse(CANCEL_REASON.FEATURE_OFF);
  const status = text(lesson.status);
  if (cancelledByMember(lesson, clientId) && !(status === "scheduled" && clientIdsOf(lesson).includes(clientId))) {
    return refuse(CANCEL_REASON.ALREADY);
  }
  if (!clientIdsOf(lesson).includes(clientId)) return refuse(CANCEL_REASON.NOT_OWN);
  if (status === "completed") return refuse(CANCEL_REASON.SETTLED);
  if (status !== "scheduled" || lesson.deletedAt) return refuse(CANCEL_REASON.CANCELLED);
  if (!deadline || now.getTime() > deadline.getTime()) return refuse(CANCEL_REASON.DEADLINE);

  const bucket = bucketKey({ period: config.period, at: now, passId: input?.passId });
  if (!bucket) return refuse(CANCEL_REASON.NO_PASS);
  const remaining = remainingIn(input?.ledger, bucket, config.limit);
  if (remaining <= 0) return refuse(CANCEL_REASON.NO_REMAINING, { bucket, remaining: 0 });
  return { ok: true, reason: "", ...base, bucket, remaining };
}

/**
 * 취소 뒤의 수업 문서 변경. 강사 기기의 "취소" 와 같은 모양이다
 * (src/features/schedule/schedule-publish.js):
 * - 혼자 남은 사람이 없으면(개인 · 듀엣 둘 다 취소) status "cancelled", 회원은 남긴다
 *   (서버가 그 사람들의 회원 화면을 다시 만든다). deletedAt 은 두지 않는다 -- 지운
 *   일정이 아니라 출석 취소다. 받는 기기는 일정을 남기고 출석을 취소로 바꾼다
 * - 듀엣에서 한 명만: 그 사람만 clientIds 에서 빠지고 예약은 그대로
 *
 * 번호(revision)를 올린다 -- 강사 기기는 번호가 다를 때만 서버를 따른다.
 *
 * @returns {object} 문서에 합칠 칸 (updatedAt 은 부르는 쪽이)
 */
export function lessonPatchForCancel(lesson, clientId, mark) {
  const id = text(clientId);
  const everyone = clientIdsOf(lesson);
  const rest = everyone.filter((other) => other !== id);
  const marks = { ...(lesson?.memberCancellations && typeof lesson.memberCancellations === "object" ? lesson.memberCancellations : {}), [id]: mark };
  const revision = Math.max(0, Number(lesson?.revision) || 0) + 1;
  if (rest.length === 0) {
    return { status: "cancelled", clientIds: everyone, clientId: everyone[0] || id, memberCancellations: marks, revision };
  }
  const grades = lesson?.careGrades && typeof lesson.careGrades === "object" ? { ...lesson.careGrades } : {};
  delete grades[id];
  return { status: "scheduled", clientIds: rest, clientId: rest[0], careGrades: grades, memberCancellations: marks, revision };
}

/**
 * 회원권 기준일 때 횟수를 셀 회원권. 쓸 수 있는 것(진행 중 · 잔여 있음 · 기간 안) 중
 * 먼저 끝나는 것. 없으면 빈 문자열.
 */
export function activePassIdFor(passes, clientId, now = new Date()) {
  const id = text(clientId);
  const at = (toDate(now) || new Date()).getTime();
  const usable = (Array.isArray(passes) ? passes : []).filter((pass) => {
    const owners = [text(pass?.clientId), ...(Array.isArray(pass?.clientIds) ? pass.clientIds.map(text) : [])];
    if (!owners.includes(id)) return false;
    if (text(pass?.status) !== "active") return false;
    if (!(Number(pass?.remainingCount) > 0)) return false;
    const expires = toDate(pass?.expiresAt);
    return !expires || expires.getTime() >= at;
  });
  usable.sort((left, right) => {
    const l = toDate(left?.expiresAt)?.getTime() ?? Infinity;
    const r = toDate(right?.expiresAt)?.getTime() ?? Infinity;
    return l - r || text(left?.id || left?.passId).localeCompare(text(right?.id || right?.passId));
  });
  return text(usable[0]?.id || usable[0]?.passId);
}

/**
 * 추가 부여를 할 수 있는가. 대표 · 총괄매니저는 누구에게나, 그 밖에는 **담당**만
 * (회원 문서의 instructorIds -- 트리거가 회원권에서 채우는 "누가 이 회원을 맡는가").
 */
export function mayGrantMemberCancel(role, callerUid, client) {
  if (["owner", "area_manager"].includes(text(role))) return true;
  const assigned = Array.isArray(client?.instructorIds) ? client.instructorIds.map(text) : [];
  return Boolean(text(callerUid)) && assigned.includes(text(callerUid));
}

/** 추가 부여 입력 검사. 통과하면 정리된 값, 아니면 이유 코드. */
export function validateGrant(input) {
  const amount = Number(input?.amount);
  if (!Number.isInteger(amount) || amount < GRANT_LIMITS.minAmount || amount > GRANT_LIMITS.maxAmount) {
    return { ok: false, reason: "grant_amount_invalid" };
  }
  const reason = text(input?.reason);
  if (!reason) return { ok: false, reason: "grant_reason_required" };
  if (reason.length > GRANT_LIMITS.maxReason) return { ok: false, reason: "grant_reason_too_long" };
  return { ok: true, amount, reason };
}

/** 대표 화면: 추가 부여를 강사별로 모은다. @returns {Array<{ grantedBy: string, count: number, amount: number }>} */
export function grantsByGranter(grants) {
  const rows = new Map();
  for (const grant of Array.isArray(grants) ? grants : []) {
    const id = text(grant?.grantedBy);
    if (!id) continue;
    const row = rows.get(id) || { grantedBy: id, count: 0, amount: 0 };
    row.count += 1;
    row.amount += Math.max(0, Number(grant?.amount) || 0);
    rows.set(id, row);
  }
  return [...rows.values()].sort((left, right) => right.count - left.count || left.grantedBy.localeCompare(right.grantedBy));
}
