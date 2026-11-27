import { daySpanLabel } from "./day-span.mjs";
/**
 * 재등록 알림 -- 규칙 계산, AI 아님 (설계 문서 4단계, 2026-11-16 대표 승인).
 *
 * 회원권 잔여 · 만료일 · 최근 출석 속도로 "언제 다 쓸지" 를 계산한다. 앱(브리핑 아래 한 줄 · "다 못 쓸 회원")과
 * 서버(재등록 후보 기록)가 이 파일 하나를 같이 쓴다 -- 따로 세면 두 숫자가 갈라진다.
 *
 * 속도 = 최근 4주(28일) 차감 횟수 ÷ 주. 회원권이 4주보다 새것이면 발급일부터. 홀딩 기간은 뺀다(쉬는 주가 속도를
 *        낮추지 않게). 차감이 2번 미만이거나 본 기간이 7일 미만이면 "속도 모름" -- 예상을 내지 않는다.
 *        듀엣 공유 회원권은 한 장의 원장에 두 사람 차감이 다 있으므로 그대로 함께 센다.
 *        되돌린 차감(correction)은 뺀다.
 * 소진   = 쓰는 회원권 여러 장을 발급 순서대로(차감 순서와 같다) 한 장씩 그 속도로 쓴다고 보고, 만료 전에 못 쓰는
 *        회차가 있으면 "다 못 씀".
 *
 * 화면 문구에 "AI" 를 쓰지 않는다.
 */

export const RENEWAL_WINDOW_DAYS = 28;
export const MIN_DEDUCTIONS_FOR_PACE = 2;
export const LOW_REMAINING_RATIO = 0.3;
export const EXPIRY_ALERT_DAYS = Object.freeze([30, 14, 7]);
const DAY_MS = 86400000;
const KST_MS = 9 * 3600000;

export const RENEWAL_ALERT = Object.freeze({
  NONE: "none",
  PACE_UNKNOWN: "pace_unknown",
  NORMAL: "normal",
  EXPIRY_SOON: "expiry_soon",
  LOW_REMAINING: "low_remaining",
  CANNOT_USE_UP: "cannot_use_up",
});

const text = (value) => String(value ?? "").trim();
export function timeOf(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value?._seconds === "number") return value._seconds * 1000;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}
const intOf = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** 한국 날짜 "YYYY-MM-DD" (기기 시간대와 상관없이). */
export const kstDay = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10);
/** 한국 날짜 차이(일). 만료가 오늘이면 0. */
export const kstDaysBetween = (fromMs, toMs) => Math.round((Date.parse(kstDay(toMs)) - Date.parse(kstDay(fromMs))) / DAY_MS);

const clientIdsOf = (pass) => {
  const list = Array.isArray(pass?.clientIds) ? pass.clientIds.map(text).filter(Boolean) : [];
  const anchor = text(pass?.clientId);
  return anchor && !list.includes(anchor) ? [anchor, ...list] : list.length ? list : anchor ? [anchor] : [];
};
export const passBelongsToClient = (pass, clientId) => clientIdsOf(pass).includes(text(clientId));

/** 지금 쓸 수 있는 회원권: 진행 중 · 잔여 > 0 · 만료 전(만료일 없으면 쓸 수 있음). 발급 순. */
export function livePassesOf(passes, clientId, now) {
  const at = timeOf(now);
  return (Array.isArray(passes) ? passes : [])
    .filter((pass) => pass && passBelongsToClient(pass, clientId) && text(pass.status) === "active" && intOf(pass.remainingCount) > 0)
    .filter((pass) => { const expiry = timeOf(pass.expiresAt); return !Number.isFinite(expiry) || expiry >= at; })
    .sort((left, right) => (timeOf(left.createdAt) || 0) - (timeOf(right.createdAt) || 0) || text(left.id).localeCompare(text(right.id)));
}

/** [from, to) 와 홀딩 구간이 겹치는 밀리초. */
const heldOverlapMs = (pass, from, to) => {
  const start = timeOf(pass?.holdFrom);
  const end = timeOf(pass?.holdUntil);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.min(end, to) - Math.max(start, from));
};

/**
 * 주당 출석 속도. 모르면 null.
 * @param {{ passes: any[], entries: any[], now: any }} input  entries = 그 회원권들의 원장 줄 (deduct · correction)
 */
export function weeklyPace({ passes, entries, now }) {
  const at = timeOf(now);
  const list = Array.isArray(passes) ? passes : [];
  if (!list.length) return { pace: null, deductions: 0, days: 0 };
  const passIds = new Set(list.map((pass) => text(pass.id)));
  const issued = Math.min(...list.map((pass) => timeOf(pass.createdAt)).filter(Number.isFinite));
  const from = Math.max(at - RENEWAL_WINDOW_DAYS * DAY_MS, Number.isFinite(issued) ? issued : at - RENEWAL_WINDOW_DAYS * DAY_MS);
  /* 홀딩은 그 회원권들 중 가장 긴 겹침만 뺀다 -- 같은 기간을 두 장이 함께 쉬었으면 한 번이다. */
  const held = Math.max(0, ...list.map((pass) => heldOverlapMs(pass, from, at)));
  const spanMs = Math.max(0, at - from - held);
  const rows = (Array.isArray(entries) ? entries : []).filter((entry) => passIds.has(text(entry?.passId)));
  const corrected = new Set(rows.filter((entry) => text(entry.type) === "correction").map((entry) => text(entry.correctsEntryId)));
  const deductions = rows.filter((entry) => text(entry.type) === "deduct" && !corrected.has(text(entry.id)))
    .filter((entry) => { const t = timeOf(entry.occurredAt); return Number.isFinite(t) && t >= from && t <= at; }).length;
  const days = spanMs / DAY_MS;
  if (deductions < MIN_DEDUCTIONS_FOR_PACE || days < 7) return { pace: null, deductions, days: Math.round(days) };
  return { pace: deductions / (days / 7), deductions, days: Math.round(days) };
}

/**
 * 한 회원의 예상. 회원권이 없으면 null.
 * @returns {null | { remaining, total, ratio, pace, expiresAt, daysToExpiry, exhaustAt, unusable, alert, expiryThreshold, passIds }}
 */
export function renewalForecast({ clientId, passes, entries, now }) {
  const at = timeOf(now);
  const live = livePassesOf(passes, clientId, at);
  if (!live.length) return null;
  const remaining = live.reduce((sum, pass) => sum + intOf(pass.remainingCount), 0);
  const total = live.reduce((sum, pass) => sum + intOf(pass.totalSessions) + intOf(pass.serviceSessions), 0);
  const expiries = live.map((pass) => timeOf(pass.expiresAt)).filter(Number.isFinite);
  const expiresAt = expiries.length ? Math.max(...expiries) : NaN;
  const daysToExpiry = Number.isFinite(expiresAt) ? kstDaysBetween(at, expiresAt) : null;
  const { pace } = weeklyPace({ passes: live, entries, now: at });

  let exhaustAt = NaN;
  let unusable = 0;
  if (pace) {
    let cursor = at;
    for (const pass of live) {
      const left = intOf(pass.remainingCount);
      const expiry = timeOf(pass.expiresAt);
      const needMs = (left / pace) * 7 * DAY_MS;
      if (!Number.isFinite(expiry) || cursor + needMs <= expiry) { cursor += needMs; continue; }
      const usable = Math.max(0, ((expiry - cursor) / (7 * DAY_MS)) * pace);
      unusable += left - usable;
      cursor = Math.max(cursor, expiry);
    }
    exhaustAt = unusable > 0.5 ? NaN : cursor;
  }
  unusable = Math.round(unusable);

  const ratio = total > 0 ? remaining / total : 1;
  const expiryThreshold = daysToExpiry === null ? null : EXPIRY_ALERT_DAYS.slice().reverse().find((days) => daysToExpiry <= days) ?? null;
  const alert = !pace
    ? (unusable > 0 ? RENEWAL_ALERT.CANNOT_USE_UP : expiryThreshold !== null ? RENEWAL_ALERT.EXPIRY_SOON : RENEWAL_ALERT.PACE_UNKNOWN)
    /* 차례: 다 못 씀 > 만료 임박 > 잔여 30% 이하. 날짜가 걸린 것이 먼저다 -- 날짜는 미룰 수 없다. */
    : unusable > 0 ? RENEWAL_ALERT.CANNOT_USE_UP
      : expiryThreshold !== null ? RENEWAL_ALERT.EXPIRY_SOON
        : ratio <= LOW_REMAINING_RATIO ? RENEWAL_ALERT.LOW_REMAINING
          : RENEWAL_ALERT.NORMAL;
  return {
    remaining, total, ratio, pace,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    daysToExpiry,
    exhaustAt: Number.isFinite(exhaustAt) ? exhaustAt : null,
    unusable,
    alert, expiryThreshold,
    passIds: live.map((pass) => text(pass.id)),
  };
}

/** 재등록 후보로 남길 알림인가 (평소 · 속도 모름은 아니다). */
export const isRenewalAlert = (forecast) => Boolean(forecast) && [RENEWAL_ALERT.LOW_REMAINING, RENEWAL_ALERT.EXPIRY_SOON, RENEWAL_ALERT.CANNOT_USE_UP].includes(forecast.alert);

const md = (ms) => { const day = kstDay(ms); return `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}`; };
const weeksLabel = (fromMs, toMs) => {
  const weeks = Math.max(1, Math.round((toMs - fromMs) / (7 * DAY_MS)));
  return `약 ${weeks}주 뒤 소진`;
};

/** 브리핑 아래 한 줄. AI 라는 말은 없다. */
export function renewalLine(forecast, now) {
  if (!forecast) return "";
  const at = timeOf(now);
  const head = `잔여 ${forecast.remaining}회`;
  /* 날 수 대신 "약 4달 반" · "2주" (2026-11-24 대표, day-span.mjs). */
  const expiry = forecast.daysToExpiry !== null ? (forecast.daysToExpiry <= 0 ? "오늘 만료" : `만료까지 ${daySpanLabel(forecast.daysToExpiry)}`) : "";
  switch (forecast.alert) {
    case RENEWAL_ALERT.CANNOT_USE_UP:
      return [head, expiry, forecast.pace ? `이 속도면 약 ${forecast.unusable}회 남음` : ""].filter(Boolean).join(" · ");
    case RENEWAL_ALERT.LOW_REMAINING:
      return [`${head} (${Math.round(forecast.ratio * 100)}%)`, forecast.exhaustAt ? weeksLabel(at, forecast.exhaustAt) : "", "재등록 상담 시기"].filter(Boolean).join(" · ");
    case RENEWAL_ALERT.EXPIRY_SOON:
      return [head, expiry].filter(Boolean).join(" · ");
    case RENEWAL_ALERT.NORMAL:
      return [head, forecast.exhaustAt ? weeksLabel(at, forecast.exhaustAt) : ""].filter(Boolean).join(" · ");
    default:
      return [head, forecast.expiresAt ? `만료 ${md(forecast.expiresAt)}` : ""].filter(Boolean).join(" · ");
  }
}

/* ── 재등록률 (서버가 남긴 후보 줄로 센다) ── */
export const CANDIDATE_STATUS = Object.freeze({ PENDING: "pending", RENEWED: "renewed", LAPSED: "lapsed" });
export const LAPSE_AFTER_DAYS = 30;

/**
 * 후보 하나의 다음 상태. 같은 회원에게 후보가 생긴 뒤 새 회원권이 나갔으면 재등록, 회원권이 끝나고 30일이 지나도
 * 없으면 끊김. 담당 강사는 보지 않는다 -- 다른 강사에게 재등록했어도 돌아온 것이다 (만료 회원 화면과 같은 기준).
 */
export function candidateOutcome(candidate, passes, now) {
  const at = timeOf(now);
  const since = timeOf(candidate?.enteredAt);
  const ids = Array.isArray(candidate?.clientIds) && candidate.clientIds.length ? candidate.clientIds : [candidate?.clientId];
  const renewal = (Array.isArray(passes) ? passes : [])
    .filter((pass) => pass && text(pass.id) !== text(candidate?.passId) && text(pass.status) !== "cancelled")
    .filter((pass) => ids.some((id) => passBelongsToClient(pass, id)))
    .filter((pass) => { const t = timeOf(pass.createdAt); return Number.isFinite(t) && Number.isFinite(since) && t >= since; })
    .sort((left, right) => timeOf(left.createdAt) - timeOf(right.createdAt))[0];
  if (renewal) return { status: CANDIDATE_STATUS.RENEWED, renewedPassId: text(renewal.id), decidedAt: timeOf(renewal.createdAt), renewedInstructorId: text(renewal.instructorId) };
  const endedAt = timeOf(candidate?.endedAt);
  if (Number.isFinite(endedAt) && at - endedAt >= LAPSE_AFTER_DAYS * DAY_MS) return { status: CANDIDATE_STATUS.LAPSED, decidedAt: endedAt + LAPSE_AFTER_DAYS * DAY_MS };
  return { status: CANDIDATE_STATUS.PENDING };
}

/**
 * 재등록률 표. rows = 후보 줄. 기준 달 = 결정된 달(한국 시간). 대기 중은 분모에 넣지 않는다.
 * @returns {Array<{ key: string, month: string, renewed: number, lapsed: number, pending: number, rate: number|null }>}
 */
export function renewalRates(rows, groupBy) {
  const table = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = text(groupBy(row));
    const decided = timeOf(row.decidedAt);
    const month = row.status === CANDIDATE_STATUS.PENDING || !Number.isFinite(decided) ? "pending" : kstDay(decided).slice(0, 7);
    const id = `${key}|${month}`;
    const entry = table.get(id) || { key, month, renewed: 0, lapsed: 0, pending: 0, rate: null };
    if (row.status === CANDIDATE_STATUS.RENEWED) entry.renewed += 1;
    else if (row.status === CANDIDATE_STATUS.LAPSED) entry.lapsed += 1;
    else entry.pending += 1;
    table.set(id, entry);
  }
  return [...table.values()].map((entry) => ({ ...entry, rate: entry.renewed + entry.lapsed ? entry.renewed / (entry.renewed + entry.lapsed) : null }))
    .sort((left, right) => right.month.localeCompare(left.month) || left.key.localeCompare(right.key));
}
