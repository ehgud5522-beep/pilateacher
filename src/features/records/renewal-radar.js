/**
 * 재등록 레이더 (2026-11-21 대표: "추천대로 진행").
 *
 * 회원권이 곧 끝나는 회원을 강사별로 모으고, 위험 신호가 많은 회원을 위로 올린다. 강사별 기록률과
 * 재등록률을 한 줄에 나란히 둔다 -- "기록을 잘하는 강사가 재등록도 잘 받는가" 를 숫자로 보려는 것이다.
 *
 * ── 강사 일을 늘리지 않는다 (대표, 같은 날) ──
 * 신호는 전부 강사가 평소에 하는 일에서 저절로 나온다: 출석 확정(원장) · 회원에게 보낸 말(lessonNotes) ·
 * 비포애프터 카드. 강사가 새로 누르거나 적을 것은 없다. 이 화면은 대표 · 총괄만 본다.
 *
 * ── 빠진 신호: 수업기록 공백 ──
 * 수업기록 원문은 강사 폰에만 있다(서버 저장 스위치 꺼짐). 회원 단위 공백은 서버 저장이 켜질 때 붙인다.
 * 강사 단위 기록률은 폰이 올린 숫자(recordActivity)로 본다.
 *
 * 대상 · 속도 계산은 shared/renewal-forecast.mjs 를 그대로 쓴다 -- 브리핑 아래 한 줄과 숫자가 갈라지지 않게.
 * 순수 함수다. 문구 · 색 · 정렬 · 기준 숫자는 여기서만 정한다.
 */

import { RENEWAL_ALERT, kstDaysBetween, livePassesOf, renewalForecast, timeOf } from "../../../functions/shared/renewal-forecast.mjs";

const text = (value) => String(value ?? "").trim();
const DAY_MS = 86400000;

/** 대상: 잔여 이 횟수 이하, 또는 만료 이 날수 안쪽, 또는 지금 속도로 다 못 씀. */
export const RADAR_REMAINING_MAX = 3;
export const RADAR_EXPIRY_DAYS = 14;
/** 급함: 잔여 1회 이하 또는 만료 7일 안쪽. */
export const RADAR_URGENT_REMAINING = 1;
export const RADAR_URGENT_DAYS = 7;
/** 출석 속도: 최근 4주와 그 전 4주를 견준다. 그 전 4주가 이 횟수 이상이고 절반 이하로 줄면 신호. */
export const PACE_WINDOW_DAYS = 28;
export const PACE_DROP_MIN_BEFORE = 2;
export const PACE_DROP_RATIO = 0.5;
/** 마지막 출석이 이 날수보다 오래되면 신호. */
export const ABSENT_DAYS = 14;
/** 비포애프터를 이 날수 넘게 안 보냈으면 신호 (비포애프터 공유 현황의 "오래전" 과 같은 값). */
export const BEFORE_AFTER_STALE_DAYS = 60;
/** 최근 이 날수 동안 출석했는데 회원에게 보낸 말이 한 번도 없으면 신호. */
export const MEMBER_NOTE_DAYS = 30;
/** 재등록률: 최근 이 날수 안에 결정된 후보만. 이 수보다 적으면 퍼센트 대신 "N명 중 M명". */
export const RATE_WINDOW_DAYS = 90;
export const RATE_MIN_SAMPLE = 5;

export const RADAR_SIGNAL = Object.freeze({
  PACE_DROP: "pace_drop",
  ABSENT: "absent",
  NEVER_ATTENDED: "no_attendance_8w",
  BEFORE_AFTER_STALE: "before_after_stale",
  BEFORE_AFTER_NEVER: "before_after_never",
  NO_MEMBER_NOTE: "no_member_note",
});

/** 신호 문구. 같은 화면에 코드도 함께 적는다 (CLAUDE.md 4). */
export function radarSignalLabel(signal) {
  switch (signal.code) {
    case RADAR_SIGNAL.PACE_DROP: return `출석 줄어듦 (4주 ${signal.before}회 → ${signal.recent}회)`;
    case RADAR_SIGNAL.ABSENT: return `${signal.days}일째 출석 없음`;
    case RADAR_SIGNAL.NEVER_ATTENDED: return "8주 동안 출석 없음";
    case RADAR_SIGNAL.BEFORE_AFTER_STALE: return `비포애프터 ${signal.days}일 전`;
    case RADAR_SIGNAL.BEFORE_AFTER_NEVER: return "비포애프터 받은 적 없음";
    case RADAR_SIGNAL.NO_MEMBER_NOTE: return `${MEMBER_NOTE_DAYS}일 동안 보낸 말 없음`;
    default: return signal.code;
  }
}

const clientIdsOfPass = (pass) => [pass?.clientId, ...(Array.isArray(pass?.clientIds) ? pass.clientIds : [])].map(text).filter(Boolean);

/** 확정된 차감(되돌린 것 뺌). 듀엣은 한 수업에 회원마다 한 줄이다. */
function confirmedDeductions(ledger) {
  const entries = (Array.isArray(ledger) ? ledger : []).filter(Boolean);
  const corrected = new Set(entries.filter((entry) => text(entry.type) === "correction" && text(entry.correctsEntryId))
    .map((entry) => `${text(entry.passId)}/${text(entry.correctsEntryId)}`));
  return entries.filter((entry) => text(entry.type) === "deduct" && !corrected.has(`${text(entry.passId)}/${text(entry.id)}`));
}

/**
 * 회원 한 명의 신호.
 * @param {{ attendance: number[], notes: number[], notesKnown?: boolean, share: null | { linked: boolean, lastSentAt: number }, shareKnown: boolean, now: number }} input
 *   attendance = 그 회원의 확정 차감 시각들, notes = 회원에게 보낸 말 시각들. notesKnown = false 면(아직 읽는 중 · 못 읽음) 보낸 말 신호를 내지 않는다
 */
export function memberSignals({ attendance, notes, notesKnown = true, share, shareKnown, now }) {
  const signals = [];
  const times = (attendance || []).filter(Number.isFinite);
  const recent = times.filter((at) => at > now - PACE_WINDOW_DAYS * DAY_MS && at <= now).length;
  const before = times.filter((at) => at > now - 2 * PACE_WINDOW_DAYS * DAY_MS && at <= now - PACE_WINDOW_DAYS * DAY_MS).length;
  if (before >= PACE_DROP_MIN_BEFORE && recent <= before * PACE_DROP_RATIO) signals.push({ code: RADAR_SIGNAL.PACE_DROP, before, recent });

  const last = times.length ? Math.max(...times) : NaN;
  if (!Number.isFinite(last)) signals.push({ code: RADAR_SIGNAL.NEVER_ATTENDED });
  else {
    const days = kstDaysBetween(last, now);
    if (days > ABSENT_DAYS) signals.push({ code: RADAR_SIGNAL.ABSENT, days });
  }

  /* 비포애프터: 회원 앱에 연결된 회원만 받을 수 있다. 서버 집계를 못 읽었으면 신호를 내지 않는다 -- 모르는 것을 "안 보냄" 으로 칠하지 않는다. */
  if (shareKnown && share?.linked) {
    if (!share.lastSentAt) signals.push({ code: RADAR_SIGNAL.BEFORE_AFTER_NEVER });
    else {
      const days = kstDaysBetween(share.lastSentAt, now);
      if (days > BEFORE_AFTER_STALE_DAYS) signals.push({ code: RADAR_SIGNAL.BEFORE_AFTER_STALE, days });
    }
  }

  const since = now - MEMBER_NOTE_DAYS * DAY_MS;
  const attendedLately = times.some((at) => at > since);
  if (notesKnown && attendedLately && !(notes || []).some((at) => Number.isFinite(at) && at > since)) signals.push({ code: RADAR_SIGNAL.NO_MEMBER_NOTE });
  return signals;
}

/** 대상인가 · 급한가. forecast 는 renewalForecast 결과. */
export function radarTarget(forecast) {
  if (!forecast) return { target: false, urgent: false };
  const soon = forecast.daysToExpiry !== null && forecast.daysToExpiry <= RADAR_EXPIRY_DAYS;
  const target = forecast.remaining <= RADAR_REMAINING_MAX || soon || forecast.alert === RENEWAL_ALERT.CANNOT_USE_UP;
  const urgent = forecast.remaining <= RADAR_URGENT_REMAINING || (forecast.daysToExpiry !== null && forecast.daysToExpiry <= RADAR_URGENT_DAYS);
  return { target, urgent: target && urgent };
}

/** 회원 줄의 회원권 문구. */
export function radarPassLabel(forecast) {
  if (!forecast) return "";
  const parts = [`잔여 ${forecast.remaining}회`];
  if (forecast.daysToExpiry !== null) parts.push(forecast.daysToExpiry <= 0 ? "오늘 만료" : `만료 ${forecast.daysToExpiry}일 전`);
  if (forecast.alert === RENEWAL_ALERT.CANNOT_USE_UP && forecast.unusable > 0) parts.push(`이 속도면 ${forecast.unusable}회 남김`);
  return parts.join(" · ");
}

/**
 * 재등록률 한 칸. rows = 그 강사의 후보 줄(renewalCandidates). 최근 90일 안에 결정된 것만.
 * @returns {{ renewed: number, decided: number, pending: number, rate: number|null }}
 */
export function instructorRenewalRate(rows, now) {
  const since = now - RATE_WINDOW_DAYS * DAY_MS;
  let renewed = 0;
  let decided = 0;
  let pending = 0;
  for (const row of rows || []) {
    if (text(row?.status) === "pending") { pending += 1; continue; }
    const at = timeOf(row?.decidedAt);
    if (!Number.isFinite(at) || at < since || at > now + DAY_MS) continue;
    if (text(row.status) === "renewed") { renewed += 1; decided += 1; }
    else if (text(row.status) === "lapsed") decided += 1;
  }
  return { renewed, decided, pending, rate: decided ? renewed / decided : null };
}

/** 재등록률 문구. 표본이 적으면 퍼센트를 내지 않는다 -- 4명 중 3명이 75% 로 보이면 흔들리는 숫자가 단단해 보인다. */
export function renewalRateLabel(rate) {
  if (!rate.decided) return { label: "재등록 결과 아직 없음", code: "renewal_rate_none" };
  if (rate.decided < RATE_MIN_SAMPLE) return { label: `재등록 ${rate.decided}명 중 ${rate.renewed}명`, code: "renewal_rate_small" };
  return { label: `재등록 ${Math.round(rate.rate * 100)}% (${rate.decided}명 중 ${rate.renewed}명)`, code: "renewal_rate" };
}

/** 기록률 문구. activity = 그 강사의 recordActivity 한 달치(없으면 null). known = false 면 아직 읽는 중 · 못 읽음. */
export function recordRateLabel(activity, known = true) {
  if (!known) return { label: "기록률 확인 중", code: "record_rate_pending", rate: null };
  const attended = Number(activity?.attended) || 0;
  const recorded = Number(activity?.recorded) || 0;
  if (!activity) return { label: "기록률 — 폰 앱 보고 없음", code: "no_device_report", rate: null };
  if (!attended) return { label: "기록률 — 출석 처리한 수업 없음", code: "no_attended_lessons", rate: null };
  const rate = Math.min(1, recorded / attended);
  return { label: `기록 ${Math.round(rate * 100)}% (${recorded}/${attended})`, code: "record_rate", rate };
}

/**
 * 레이더 표.
 * @param {{
 *   clients?: any[], passes?: any[], ledger?: any[],
 *   lessonNotes?: any[] | null,     null = 아직 모름 (보낸 말 신호를 내지 않는다)
 *   shares?: any[] | null,          비포애프터 카드 줄 (beforeAfterShareStats). null = 못 읽음
 *   activities?: any[] | null,      null = 아직 모름. recordActivity (이 달 · 지난달 섞여도 된다 -- month 로 고른다)
 *   activityMonth?: string,         기록률에 쓸 달 "YYYY-MM"
 *   candidates?: any[] | null,      renewalCandidates. null = 못 읽음
 *   instructors?: any[], canonicalInstructorId?: (id: unknown) => string, excludedClientIds?: Set<string> | null,
 *   now: any,
 * }} input
 */
export function renewalRadar(input) {
  const now = timeOf(input.now);
  const canonical = typeof input.canonicalInstructorId === "function" ? input.canonicalInstructorId : (id) => text(id);
  const excluded = input.excludedClientIds instanceof Set ? input.excludedClientIds : new Set();
  const passes = (Array.isArray(input.passes) ? input.passes : []).filter(Boolean);
  const ledger = (Array.isArray(input.ledger) ? input.ledger : []).filter(Boolean);
  const deductions = confirmedDeductions(ledger);

  const attendanceBy = new Map();
  for (const entry of deductions) {
    const id = text(entry.clientId);
    const at = timeOf(entry.occurredAt);
    if (!id || !Number.isFinite(at)) continue;
    if (!attendanceBy.has(id)) attendanceBy.set(id, []);
    attendanceBy.get(id).push(at);
  }
  const notesKnown = Array.isArray(input.lessonNotes);
  const notesBy = new Map();
  for (const note of notesKnown ? input.lessonNotes : []) {
    if (!note || !text(note.memberNote)) continue;
    const id = text(note.clientId);
    const at = timeOf(note.createdAt);
    if (!id || !Number.isFinite(at)) continue;
    if (!notesBy.has(id)) notesBy.set(id, []);
    notesBy.get(id).push(at);
  }
  const shareKnown = Array.isArray(input.shares);
  const lastShareBy = new Map();
  for (const share of shareKnown ? input.shares : []) {
    if (!share?.sharedAt || !["active", "revoked"].includes(text(share.status))) continue;
    const id = text(share.clientId);
    const at = timeOf(share.sharedAt);
    if (Number.isFinite(at) && at > (lastShareBy.get(id) || 0)) lastShareBy.set(id, at);
  }

  const rows = new Map();
  const rowOf = (id) => {
    const key = canonical(id) || text(id) || "";
    if (!rows.has(key)) rows.set(key, { instructorId: key, members: [], candidates: [] });
    return rows.get(key);
  };

  /* 듀엣 공유 회원권은 한 회원권에 두 사람 -- 두 사람 모두 줄에 선다. 같은 회원을 두 번 세우지는 않는다. */
  const seen = new Set();
  const clients = (Array.isArray(input.clients) ? input.clients : []).filter((client) => client && text(client.id));
  for (const client of clients) {
    const clientId = text(client.id);
    if (seen.has(clientId) || client.archived === true || excluded.has(clientId)) continue;
    seen.add(clientId);
    const forecast = renewalForecast({ clientId, passes, entries: ledger, now });
    const { target, urgent } = radarTarget(forecast);
    if (!target) continue;
    /* 담당 = 마지막으로 끝날 회원권의 강사 (재등록 후보 줄과 같은 기준). 없으면 회원 담당 강사 첫 사람. */
    const live = livePassesOf(passes, clientId, now);
    const instructorId = text(live.at(-1)?.instructorId) || text((Array.isArray(client.instructorIds) ? client.instructorIds : [])[0]);
    const signals = memberSignals({
      attendance: attendanceBy.get(clientId) || [],
      notes: notesBy.get(clientId) || [],
      notesKnown,
      share: { linked: Boolean(text(client.userId)), lastSentAt: lastShareBy.get(clientId) || 0 },
      shareKnown,
      now,
    });
    rowOf(instructorId).members.push({
      clientId, name: text(client.name), urgent, forecast, signals,
      duet: live.some((pass) => clientIdsOfPass(pass).length > 1),
    });
  }

  const candidatesKnown = Array.isArray(input.candidates);
  for (const row of candidatesKnown ? input.candidates : []) {
    if (!row || excluded.has(text(row.clientId))) continue;
    rowOf(row.instructorId).candidates.push(row);
  }

  const activitiesKnown = Array.isArray(input.activities);
  const month = text(input.activityMonth);
  const activityBy = new Map();
  for (const activity of activitiesKnown ? input.activities : []) {
    if (!activity || !text(activity.userId) || (month && text(activity.month) !== month)) continue;
    const key = canonical(activity.userId) || text(activity.userId);
    const at = timeOf(activity.checkedAt) || 0;
    const prior = activityBy.get(key);
    if (!prior || (timeOf(prior.checkedAt) || 0) < at) activityBy.set(key, activity);
  }

  const roster = new Map((input.instructors || []).map((member) => [canonical(member?.userId) || text(member?.userId), member]));
  return [...rows.values()].map((row) => {
    const member = roster.get(row.instructorId) || null;
    const members = row.members.slice().sort(compareMembers);
    const rate = instructorRenewalRate(row.candidates, now);
    return {
      instructorId: row.instructorId,
      name: text(member?.displayName || member?.name),
      active: !member || text(member?.status || "active") === "active",
      members,
      atRisk: members.filter((item) => item.signals.length > 0).length,
      urgent: members.filter((item) => item.urgent).length,
      renewal: candidatesKnown ? rate : null,
      record: recordRateLabel(activityBy.get(row.instructorId) || null, activitiesKnown),
    };
  }).filter((row) => row.members.length > 0 || (row.renewal && (row.renewal.decided || row.renewal.pending)))
    .sort((left, right) => right.urgent - left.urgent || right.atRisk - left.atRisk || right.members.length - left.members.length || left.name.localeCompare(right.name, "ko"));
}

/* 급한 회원 → 신호 많은 회원 → 만료 가까운 회원 → 잔여 적은 회원. */
function compareMembers(left, right) {
  const days = (item) => (item.forecast?.daysToExpiry ?? 9999);
  return Number(right.urgent) - Number(left.urgent)
    || right.signals.length - left.signals.length
    || days(left) - days(right)
    || (left.forecast?.remaining ?? 0) - (right.forecast?.remaining ?? 0)
    || left.name.localeCompare(right.name, "ko");
}

/** 표 위 요약. */
export function radarSummary(rows) {
  const members = (rows || []).flatMap((row) => row.members);
  return {
    total: members.length,
    urgent: members.filter((item) => item.urgent).length,
    atRisk: members.filter((item) => item.signals.length > 0).length,
  };
}
