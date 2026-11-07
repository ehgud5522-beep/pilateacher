/**
 * "확인할 수업" 큐 정리 (2026-11-07 대표 결정).
 *
 * ── 왜 ──
 * 큐는 기기 데이터만으로 만들어진다. 다른 기기 · PC 에서 확정된 수업은 이 기기에서
 * "출석 미처리" 로 남는데 잠겨 있어 지울 수도 없었다. 날짜 하한도 없어 지난달
 * 수업이 계속 쌓였고, 듀엣 한 수업이 회원 둘 + 확정 하나로 세 줄이 됐다. 한 강사의
 * 첫 화면에 49건이 떠 있던 이유다.
 *
 * ── 무엇을 하는가 ──
 *   1. 서버 확정 상태와 대조한다. 완료 · 취소 · 삭제 표시된 수업은 큐에서 빠진다
 *      (데이터는 그대로다 -- 큐가 세지 않을 뿐).
 *   2. 다른 기기에서 확정돼 잠긴 수업(settledElsewhereAt)은 완료로 본다.
 *   3. 11월 1일(QUEUE_CUTOFF) 이전 수업은 요약과 목록에서 빼고 "지난 항목" 에만 접어 둔다.
 *   4. **확정할 수 있는 기간(7일)이 지난 항목도 "지난 항목" 으로 간다** (2026-11-07 대표).
 *      출석 · 확정 · 수업 기록 알림 전부다. 기준은 확정과 같은 settleDeadline
 *      (pass-repository.js) -- 수업 시작 시각 + 7일이 되는 순간부터 지난 항목이다.
 *      그 전까지는 확정이 받아지고, 그 순간부터는 규칙이 거절한다. 둘이 어긋나지 않는다.
 *      마감 2일 전부터는 "모레/내일/오늘까지 확정해야 해요" 를 단다.
 *   5. 같은 수업의 줄은 한 묶음이다 -- 듀엣은 한 수업으로 보인다.
 *
 * 탭은 셋이다: 오늘 · 지난 미처리(확정 기간 안) · 지난 항목(접힘). "관리자 확인" 탭은
 * 없앴다 (2026-11-07 대표) -- 확정할 수 없게 된 수업을 강사 화면에 모아 둘 이유가 없다.
 *
 * 판정만 순수 함수로 둔다. 서버 읽기와 기기 저장은 부르는 쪽이 한다.
 * 아무것도 쓰지 않는다. 서버 데이터도 지우거나 바꾸지 않는다.
 */

import { settleDeadline } from "../../data/repositories/pass-repository.js";
import { settlementTime } from "./settlement-duplicate.js";

/** 이 날짜(기기 시각, YYYY-MM-DD)보다 앞선 수업은 큐에서 뺀다. 데이터는 지우지 않는다. */
export const QUEUE_CUTOFF = "2026-11-01";

/** 마감까지 이만큼(달력 일수) 남으면 항목에 마감 표시를 단다. */
export const DEADLINE_WARN_DAYS = 2;

/** 서버 상태를 다시 묻는 간격. 그 사이에는 기기에 적어 둔 답을 쓴다. */
export const SERVER_STATE_TTL_MS = 6 * 60 * 60 * 1000;

/** 한 번에 묻는 수업 수의 상한. 넘치면 다음 열기 때 이어서 묻는다. */
export const SERVER_STATE_READ_LIMIT = 60;

export const QUEUE_TAB = Object.freeze({
  TODAY: "today",
  OVERDUE: "overdue",
  ARCHIVED: "archived",
});

/** 화면이 그리는 순서. */
export const QUEUE_TABS = Object.freeze([QUEUE_TAB.TODAY, QUEUE_TAB.OVERDUE, QUEUE_TAB.ARCHIVED]);

export const QUEUE_TAB_LABEL = Object.freeze({
  [QUEUE_TAB.TODAY]: "오늘",
  [QUEUE_TAB.OVERDUE]: "지난 미처리",
  [QUEUE_TAB.ARCHIVED]: "지난 항목",
});

/** 서버 수업 문서가 말하는 상태. */
export const SERVER_STATE = Object.freeze({
  COMPLETED: "completed",
  REMOVED: "removed",
  SCHEDULED: "scheduled",
  UNKNOWN: "unknown",
});

const text = (value) => String(value ?? "").trim();

/**
 * 서버 문서 하나를 상태로. 없으면(기기에만 있는 수업 · 못 읽음) UNKNOWN 이다 --
 * "없다" 를 "끝났다" 로 읽지 않는다.
 *
 * @param {any} document 서버 lessons 문서 또는 null
 */
export function serverStateOf(document) {
  if (!document) return SERVER_STATE.UNKNOWN;
  if (document.deletedAt) return SERVER_STATE.REMOVED;
  const status = text(document.status);
  if (status === "completed") return SERVER_STATE.COMPLETED;
  if (status === "cancelled") return SERVER_STATE.REMOVED;
  if (status === "scheduled") return SERVER_STATE.SCHEDULED;
  return SERVER_STATE.UNKNOWN;
}

/** 큐 항목의 수업 id. 수업 없는 기록 확인 · 초안은 빈 문자열. */
export const queueLessonIdOf = (task) => text(task?.lessonId || task?.s?.id || task?.lesson?.id);

/** 큐 항목의 수업 날짜(YYYY-MM-DD). 모르면 빈 문자열. */
export const queueDateOf = (task) => text(task?.s?.date || task?.lesson?.date || task?.session?.date);

const daysBetween = (fromDay, toDay) => {
  const from = new Date(`${fromDay}T00:00:00`);
  const to = new Date(`${toDay}T00:00:00`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
};

const localDay = (at) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;

/**
 * 이 수업의 확정 마감(settleDeadline). 수업이 없거나 날짜를 모르면 null -- 수업 없는 기록
 * 확인 · 초안은 마감이 없다 (그래서 지난 항목으로 가지도 않고 마감 표시도 없다).
 *
 * 수업 시각은 확정이 원장에 적는 것과 같은 식이다 (settlementTime: 날짜 + 시작, 없으면 00:00).
 *
 * @param {any} lesson
 */
export function queueDeadlineOf(lesson) {
  if (!lesson || !text(lesson.date)) return null;
  const at = settlementTime(lesson);
  return at ? settleDeadline(at) : null;
}

/** 마감이 지났는가 -- 지금이 마감과 같거나 지났으면 확정이 거절된다. */
export const isPastSettleDeadline = (deadline, now) => Boolean(deadline) && deadline.getTime() <= Number(now);

/**
 * 마감 표시. 마감일까지 달력으로 0 · 1 · 2일 남았을 때만. 지났거나 그보다 멀면 null.
 *
 * 대표 문구는 "내일까지 확정해야 해요" 하나였다. 2일 전부터 같은 말을 쓰면 이틀 남은
 * 날에 "내일까지" 가 거짓이 되므로 남은 날로 말을 바꾼다 (모레 · 내일 · 오늘).
 *
 * @param {Date | null} deadline @param {number} now
 */
export function deadlineBadgeOf(deadline, now) {
  if (!deadline || isPastSettleDeadline(deadline, now)) return null;
  const daysLeft = daysBetween(localDay(new Date(Number(now))), localDay(deadline));
  if (daysLeft < 0 || daysLeft > DEADLINE_WARN_DAYS) return null;
  const word = daysLeft === 0 ? "오늘" : daysLeft === 1 ? "내일" : "모레";
  return { daysLeft, label: `${word}까지 확정해야 해요` };
}

/**
 * 이 수업이 다른 곳에서 이미 끝났는가.
 *
 * - 다른 기기에서 확정돼 이 기기에서 잠긴 수업(settledElsewhereAt) -- 동기화가 7일 안에서 건다
 * - 서버가 completed 인데 이 기기가 확정하지 않은 수업 -- 7일 창 밖에서 다른 곳이 확정했다
 * - 서버가 취소 · 삭제 표시한 수업
 *
 * 이 기기에서 확정한 수업(orgSettledAt)은 여기 해당하지 않는다 -- 그 수업의 기록은
 * 이 기기에서 쓸 수 있고, 쓰지 않았으면 진짜 할 일이다.
 */
function closedElsewhere(lesson, serverState) {
  if (lesson?.settledElsewhereAt) return true;
  if (serverState === SERVER_STATE.REMOVED) return true;
  if (serverState === SERVER_STATE.COMPLETED && !lesson?.orgSettledAt) return true;
  return false;
}

/**
 * 큐 항목들을 묶고 탭으로 나눈다.
 *
 * @param {{
 *   tasks: Array<any>,
 *   today: string,
 *   now?: number | Date,
 *   serverStates?: Record<string, string>,
 *   snoozed?: Record<string, boolean>,
 *   dismissed?: Record<string, string>,
 *   cutoff?: string,
 * }} input
 *   now           지금(밀리초). 확정 마감을 가르는 시각이다. 없으면 today 의 정오로 본다
 *   serverStates  수업 id → SERVER_STATE. 없는 id 는 아직 못 물은 것(UNKNOWN)
 *   snoozed       묶음 key → 보류. 요약에서 빠지고 목록에는 "보류" 로 남는다 (기기에만)
 *   dismissed     묶음 key → 숨긴 날. [모두 지우기] 로 목록에서 뺀 것 (기기에만, 2026-11-07).
 *                 수업 · 출석 · 확정 · 기록은 처리되지 않은 그대로다 -- 큐가 세지 않을 뿐
 */
export function organizeLessonQueue(input) {
  const today = text(input?.today);
  const now = input?.now instanceof Date ? input.now.getTime()
    : Number.isFinite(Number(input?.now)) && input?.now !== null && input?.now !== undefined ? Number(input.now)
      : new Date(`${today}T12:00:00`).getTime();
  const cutoff = text(input?.cutoff) || QUEUE_CUTOFF;
  const serverStates = input?.serverStates || {};
  const snoozed = input?.snoozed || {};
  const dismissed = input?.dismissed || {};

  /** @type {Map<string, any>} */
  const groups = new Map();
  /* archived = 지난 항목 전체(컷오프 + 마감 지남), expired = 그중 마감이 지나 넘어간 것. */
  const counts = { doneElsewhere: 0, pending: 0, unknown: 0, archived: 0, expired: 0, dismissed: 0 };

  for (const task of Array.isArray(input?.tasks) ? input.tasks : []) {
    if (!task) continue;
    const lessonId = queueLessonIdOf(task);
    const lesson = task.s || task.lesson || null;
    const state = lessonId ? (serverStates[lessonId] || SERVER_STATE.UNKNOWN) : SERVER_STATE.UNKNOWN;
    const key = lessonId ? `lesson|${lessonId}` : text(task.key);
    if (!groups.has(key)) {
      groups.set(key, { key, lessonId, lesson, date: queueDateOf(task), serverState: state, tasks: [], memberIds: [] });
    }
    const group = groups.get(key);
    group.tasks.push(task);
    const memberId = text(task.memberId || task.a?.memberId);
    if (memberId && !group.memberIds.includes(memberId)) group.memberIds.push(memberId);
    if (!group.date) group.date = queueDateOf(task);
  }

  const out = { [QUEUE_TAB.TODAY]: [], [QUEUE_TAB.OVERDUE]: [], [QUEUE_TAB.ARCHIVED]: [] };
  for (const group of groups.values()) {
    if (lessonClosed(group)) { counts.doneElsewhere += 1; continue; }
    if (dismissed[group.key]) { counts.dismissed += 1; continue; }
    /* 확정 항목이 먼저 -- 돈이 걸린 일이고, 출석 · 기록은 확정 화면에서 함께 본다. */
    group.tasks.sort((left, right) => Number(right.kind === "settlement") - Number(left.kind === "settlement"));
    group.snoozed = Boolean(snoozed[group.key]);
    /* 마감은 수업 하나에 하나다 -- 듀엣의 두 회원 · 확정 줄이 같이 넘어간다. */
    group.deadline = queueDeadlineOf(group.lesson || (group.date ? { date: group.date } : null));
    const expired = isPastSettleDeadline(group.deadline, now);
    const beforeCutoff = Boolean(group.date) && group.date < cutoff;
    let tab;
    if (beforeCutoff) tab = QUEUE_TAB.ARCHIVED;
    else if (expired) tab = QUEUE_TAB.ARCHIVED;
    else if (group.date && group.date === today) tab = QUEUE_TAB.TODAY;
    else tab = QUEUE_TAB.OVERDUE;
    group.tab = tab;
    /* "마감 지남" 은 컷오프가 아니라 확정 기간 때문에 넘어간 것만 센다 -- 진단이 둘을 가른다. */
    group.expired = !beforeCutoff && expired;
    /* 확정하지 않은 수업에만 단다. 이 기기가 확정한 수업의 기록 알림은 돈이 걸려 있지 않다. */
    group.badge = tab !== QUEUE_TAB.ARCHIVED && !group.lesson?.orgSettledAt ? deadlineBadgeOf(group.deadline, now) : null;
    out[tab].push(group);
    if (tab === QUEUE_TAB.ARCHIVED) {
      counts.archived += 1;
      if (group.expired) counts.expired += 1;
    } else if (group.serverState === SERVER_STATE.SCHEDULED) counts.pending += 1;
    else counts.unknown += 1;
  }
  for (const tab of Object.keys(out)) {
    /* 최근 것이 위. 날짜 없는 묶음(수업 없는 초안)은 맨 아래. */
    out[tab].sort((left, right) => (right.date || "").localeCompare(left.date || "") || left.key.localeCompare(right.key));
  }
  const active = (tab) => out[tab].filter((group) => !group.snoozed).length;
  return {
    tabs: out,
    /** 첫 화면 요약: "오늘 미처리 N건" */
    todayCount: active(QUEUE_TAB.TODAY),
    overdueCount: active(QUEUE_TAB.OVERDUE),
    archivedCount: out[QUEUE_TAB.ARCHIVED].length,
    /** 시트를 열 만한 것이 있는가 (지난 항목만 있어도 연다 · 숨긴 것만 있어도 되살리러 연다) */
    total: Object.values(out).reduce((sum, list) => sum + list.length, 0),
    /** [모두 지우기] 로 숨긴 묶음 수 -- 시트가 "다시 보기" 를 낸다 */
    dismissedCount: counts.dismissed,
    /** 진단: 완료인데 남은 것 / 진짜 미처리 / 판단 불가 / 지난 항목 · 그중 마감 지남 (묶음 수) */
    counts,
  };

  function lessonClosed(group) {
    return Boolean(group.lessonId) && closedElsewhere(group.lesson, group.serverState);
  }
}

/**
 * 서버에 물어야 할 수업 id. 지난 항목(컷오프 이전)은 묻지 않는다 -- 큐에 세지 않으므로
 * 읽을 이유가 없다. 기기에 적어 둔 답이 TTL 안이면 다시 묻지 않는다. 상한까지만.
 *
 * @param {{ tasks: Array<any>, cache?: Record<string, { state: string, at: number }>, now: number, cutoff?: string }} input
 */
export function lessonIdsToCheck(input) {
  const cutoff = text(input?.cutoff) || QUEUE_CUTOFF;
  const cache = input?.cache || {};
  const ids = [];
  for (const task of Array.isArray(input?.tasks) ? input.tasks : []) {
    const lessonId = queueLessonIdOf(task);
    if (!lessonId || ids.includes(lessonId)) continue;
    const date = queueDateOf(task);
    if (date && date < cutoff) continue;
    // 마감이 지난 수업도 묻지 않는다 -- 지난 항목이라 세지 않는다.
    if (isPastSettleDeadline(queueDeadlineOf(task.s || task.lesson || (date ? { date } : null)), input.now)) continue;
    const cached = cache[lessonId];
    if (cached && Number(input.now) - Number(cached.at) < SERVER_STATE_TTL_MS) continue;
    ids.push(lessonId);
    if (ids.length >= SERVER_STATE_READ_LIMIT) break;
  }
  return ids;
}

/** 기기에 적어 둔 답에서 상태만. TTL 이 지난 것도 쓴다 -- 다시 묻기 전까지는 그것이 최선이다. */
export function serverStatesFromCache(cache) {
  return Object.fromEntries(Object.entries(cache || {}).map(([id, entry]) => [id, text(entry?.state) || SERVER_STATE.UNKNOWN]));
}

/* ── 기기 저장 ─────────────────────────────────────────────────────────────
   셋 다 이 기기에만 둔다. 서버에 쓰지 않는다 -- 보류는 "이 강사가 이
   화면에서 어떻게 보고 싶은가" 이고, 서버 답은 다시 물으면 얻는 값이다. */
export const QUEUE_SERVER_CACHE_KEY = "pilateacher_lesson_queue_server_v1";
export const QUEUE_MARKS_KEY = "pilateacher_lesson_queue_marks_v1";
export const QUEUE_COUNTS_KEY = "pilateacher_lesson_queue_counts_v1";

const readJson = (storage, key, fallback) => {
  try {
    const value = JSON.parse(storage?.getItem(key) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (storage, key, value) => {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* 사파리 사생활 모드 -- 다음에 다시 묻는다 */ }
};

/** 서버 답 캐시. 오래된 것은 200개만 남긴다. */
export function readServerCache(storage) { return readJson(storage, QUEUE_SERVER_CACHE_KEY, {}); }
export function writeServerCache(storage, cache) {
  const kept = Object.entries(cache || {}).sort((left, right) => Number(right[1]?.at) - Number(left[1]?.at)).slice(0, 200);
  writeJson(storage, QUEUE_SERVER_CACHE_KEY, Object.fromEntries(kept));
}

/**
 * 서버 문서들을 캐시에 합친다. 읽은 것만 바꾼다 -- 못 읽은 id 는 예전 답(또는 없음)을 둔다.
 *
 * @param {Record<string, { state: string, at: number }>} cache
 * @param {Record<string, any>} documents id → 문서 또는 null
 * @param {number} now
 */
export function mergeServerCache(cache, documents, now) {
  const next = { ...(cache || {}) };
  for (const [id, document] of Object.entries(documents || {})) next[id] = { state: serverStateOf(document), at: now };
  return next;
}

/**
 * 보류 표시. { snoozed: { key: true } }
 *
 * "관리자 확인" 표시는 없앴다 (2026-11-07). 예전 기기에 남은 escalated 칸은 읽지 않는다 --
 * 그 묶음은 이제 날짜대로 지난 미처리 · 지난 항목에 선다.
 */
export function readQueueMarks(storage) {
  const marks = readJson(storage, QUEUE_MARKS_KEY, {});
  return { snoozed: { ...(marks.snoozed || {}) }, dismissed: { ...(marks.dismissed || {}) } };
}

/** 숨긴 표시를 남겨 두는 기간. 그보다 오래된 수업의 표시는 지운다 -- 기기 저장이 끝없이 늘지 않게. */
export const DISMISS_KEEP_DAYS = 90;

/**
 * [모두 지우기] (2026-11-07 대표). 지금 큐에 선 묶음 전부를 **목록에서만** 숨긴다.
 * 수업 · 출석 · 확정 · 기록 데이터는 건드리지 않는다 -- 처리 안 된 것은 처리 안 된 채로 둔다.
 * 기기에만 적는다. 숨긴 날이 아니라 수업 날짜를 적어, 90일 지난 수업의 표시는 정리한다.
 *
 * @param {{ snoozed?: any, dismissed?: Record<string, string> }} marks
 * @param {Array<{ key: string, date?: string }>} groups
 * @param {string} today YYYY-MM-DD
 */
export function dismissQueueGroups(marks, groups, today) {
  const keepFrom = new Date(`${text(today)}T12:00:00`);
  keepFrom.setDate(keepFrom.getDate() - DISMISS_KEEP_DAYS);
  const pad = (value) => String(value).padStart(2, "0");
  const floor = `${keepFrom.getFullYear()}-${pad(keepFrom.getMonth() + 1)}-${pad(keepFrom.getDate())}`;
  const dismissed = Object.fromEntries(Object.entries(marks?.dismissed || {}).filter(([, day]) => text(day) >= floor));
  for (const group of Array.isArray(groups) ? groups : []) {
    if (text(group?.key)) dismissed[text(group.key)] = text(group.date) || text(today);
  }
  return { ...marks, snoozed: { ...(marks?.snoozed || {}) }, dismissed };
}

/** 숨긴 것을 모두 다시 보이게. */
export function restoreDismissedGroups(marks) {
  return { ...marks, snoozed: { ...(marks?.snoozed || {}) }, dismissed: {} };
}
export function writeQueueMarks(storage, marks) { writeJson(storage, QUEUE_MARKS_KEY, marks); }

/** 진단 화면이 보는 마지막 분류 개수. 이름 · 기록 내용은 담지 않는다. */
export function writeQueueCounts(storage, counts, at, reads = 0) {
  writeJson(storage, QUEUE_COUNTS_KEY, { ...counts, reads: Number(reads) || 0, at });
}
export function readQueueCounts(storage) { return readJson(storage, QUEUE_COUNTS_KEY, null); }
