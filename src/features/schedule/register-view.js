/**
 * 일정 등록 개편 (2026-11-17 대표 승인 "그렇게 해주고"). 회원을 먼저 고르면 그 회원의 회원권으로
 * 유형 · 길이를 미리 채우고, 최근 회원과 지난 수업 시간을 바로 누를 수 있게 한다. 그리기는 App.jsx.
 *
 * 미리 채우는 것은 **새 일정**에서만이다. 이미 있는 일정을 고칠 때 회원을 바꿨다고 유형이 저절로
 * 바뀌면, 강사가 고르지 않은 회원권에서 빠지는 일정이 된다.
 */

const text = (value) => String(value ?? "").trim();

/** 시간 순서 키 -- 날짜 · 시작 시각. */
const orderKey = (lesson) => `${text(lesson?.date)} ${text(lesson?.start).padStart(5, "0")}`;

const memberIdsOf = (lesson) => {
  const attendees = Array.isArray(lesson?.attendees) ? lesson.attendees : [];
  const ids = attendees.map((attendee) => text(attendee?.memberId)).filter(Boolean);
  if (ids.length) return ids;
  return text(lesson?.memberId) ? [text(lesson.memberId)] : [];
};

/**
 * 최근에 수업한 회원 (가장 최근 일정부터, 겹치지 않게). 개인 일정 · 그룹은 세지 않는다.
 * @param {any[]} schedule
 * @param {any[]} members
 * @param {{ limit?: number, today?: string, isActive?: (member: any) => boolean }} [options]
 */
export function recentMembers(schedule, members, { limit = 3, today = "", isActive = () => true } = {}) {
  const byId = new Map((Array.isArray(members) ? members : []).map((member) => [text(member?.id), member]));
  const lessons = (Array.isArray(schedule) ? schedule : [])
    .filter((lesson) => lesson && !lesson.personal && text(lesson.type) !== "그룹" && (!today || text(lesson.date) <= today))
    .sort((left, right) => orderKey(right).localeCompare(orderKey(left)));
  const seen = new Set();
  const picked = [];
  for (const lesson of lessons) {
    for (const id of memberIdsOf(lesson)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const member = byId.get(id);
      if (member && isActive(member)) picked.push(member);
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
}

/**
 * 그 회원의 가장 최근 수업 시간 (오늘 이전). 없으면 null.
 * @returns {null | { start: string, dur: number, date: string }}
 */
export function lastLessonTimeOf(schedule, memberId, today = "") {
  const id = text(memberId);
  if (!id) return null;
  const lessons = (Array.isArray(schedule) ? schedule : [])
    .filter((lesson) => lesson && !lesson.personal && memberIdsOf(lesson).includes(id) && (!today || text(lesson.date) < today) && /^\d{1,2}:\d{2}$/.test(text(lesson.start)))
    .sort((left, right) => orderKey(right).localeCompare(orderKey(left)));
  const last = lessons[0];
  if (!last) return null;
  const dur = Number(last.dur) > 0 ? Number(last.dur) : 0;
  return { start: text(last.start).padStart(5, "0"), dur, date: text(last.date) };
}

/**
 * 회원을 골랐을 때 미리 채울 유형. 회원권이 말하는 것만 -- 모르면 지금 고른 것을 그대로 둔다.
 *  - 2:1 회원권(짝이 목록에 있음) → 듀엣, 짝을 두 번째 칸에
 *  - 디오사 관리권만 있음 → 그 관리(30 · 50분)
 *  - 그 밖 → 개인
 * @param {{ member: any, members: any[], careOnly?: { careOnly?: boolean, grade?: string } | null, careKeyOfGrade?: (grade: string) => string }} input
 * @returns {{ formKind: string, partnerId: string, source: "duet_pass" | "care_pass" | "solo" }}
 */
export function suggestLessonKind({ member, members, careOnly = null, careKeyOfGrade = () => "" }) {
  const partnerId = text(member?.duetWith);
  if (partnerId && (Array.isArray(members) ? members : []).some((item) => text(item?.id) === partnerId)) {
    return { formKind: "duet", partnerId, source: "duet_pass" };
  }
  if (careOnly?.careOnly && careOnly.grade) {
    const key = careKeyOfGrade(careOnly.grade);
    if (key) return { formKind: key, partnerId: "", source: "care_pass" };
  }
  return { formKind: "solo", partnerId: "", source: "solo" };
}

/** 하단 버튼 아래 한 줄: "11.18(수) 15:00~15:50 · 김하나". 회원 수업인데 회원이 없으면 그 말. */
export function registerSummaryLine({ date, start, end, dayOfWeek, names = [], needsMember = false, title = "" }) {
  const when = `${text(date).slice(5).replace("-", ".")}(${dayOfWeek(date)}) ${text(start)}~${text(end)}`;
  if (needsMember && !names.filter(Boolean).length) return "회원을 먼저 골라 주세요";
  const who = names.filter(Boolean).join(" · ") || text(title);
  return who ? `${when} · ${who}` : when;
}
