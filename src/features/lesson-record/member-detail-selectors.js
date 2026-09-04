const PREFIX_NAMES = "오늘 수업|수업|변화|회원 반응|반응|다음 확인|다음";

export const LESSON_RECORD_PREFIX = new RegExp(`^\\s*(${PREFIX_NAMES})\\s*[:：]\\s*`);

const PREFIX_SCAN = new RegExp(`(?:^|\\s+)(${PREFIX_NAMES})\\s*[:：]\\s*`, "g");
const INTERNAL_ORIGIN_TAG = /\[(?:AI|MANUAL|STT)\]/gi;
const LEADING_DATE_TAG = /^\s*\[(\d{1,2})\/(\d{1,2})\]\s*/;
const EMPTY_TODAY = new Set(["", "운동", "수업", "진행", "함", "했음"]);
const SETTLED_ATTENDANCE = new Set(["done", "noshow", "cancel"]);

const clean = (value) => String(value ?? "").replace(INTERNAL_ORIGIN_TAG, "").trim().replace(/\s+/g, " ");
const normalized = (value) => clean(value).toLocaleLowerCase("ko-KR").replace(/[\s.,!?;:'"`()\[\]{}·~_-]+/g, "");
const itemText = (item) => clean(typeof item === "string" ? item : item?.text);
const joined = (value) => Array.isArray(value) ? value.map(itemText).filter(Boolean).join(" · ") : clean(value);
const uniqueText = (values) => {
  const seen = new Set();
  return values.flatMap((value) => clean(value) ? [clean(value)] : []).filter((value) => {
    const key = normalized(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" · ");
};

const fieldForPrefix = (label) => ({
  "오늘 수업": "today",
  "수업": "today",
  "변화": "change",
  "회원 반응": "reaction",
  "반응": "reaction",
  "다음 확인": "next",
  "다음": "next",
})[label] || null;

export function stripLessonRecordTags(value) {
  const withoutOrigin = clean(value);
  const date = withoutOrigin.match(LEADING_DATE_TAG);
  return {
    text: clean(date ? withoutOrigin.slice(date[0].length) : withoutOrigin),
    dateHint: date ? `${String(date[1]).padStart(2, "0")}.${String(date[2]).padStart(2, "0")}` : "",
  };
}

export function parseLegacyLessonRecordBody(value) {
  const stripped = stripLessonRecordTags(value);
  const matches = [...stripped.text.matchAll(PREFIX_SCAN)];
  const result = { today: "", change: "", reaction: "", next: "", dateHint: stripped.dateHint };
  if (!matches.length) return { ...result, today: stripped.text };
  matches.forEach((match, index) => {
    const field = fieldForPrefix(match[1]);
    if (!field) return;
    const start = (match.index || 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : stripped.text.length;
    result[field] = uniqueText([result[field], stripped.text.slice(start, end)]);
  });
  return result;
}

export function meaningfulToday(value) {
  const text = stripLessonRecordTags(value).text;
  return EMPTY_TODAY.has(normalized(text)) ? "기록 없음" : (text || "기록 없음");
}

export function lessonSessionRepresentative(session) {
  const fields = [
    ["today", "", session?.today === "기록 없음" ? "" : session?.today],
    ["change", "변화", session?.change],
    ["reaction", "회원 반응", session?.reaction],
    ["next", "다음 확인", session?.next],
  ];
  const selected = fields.find(([, , value]) => clean(value));
  if (!selected) return { field: "empty", label: "", text: "기록 없음", display: "기록 없음" };
  const [field, label, value] = selected;
  const text = clean(value);
  return { field, label, text, display: label ? `${label} · ${text}` : text };
}

export function normalizedLessonType(value) {
  const type = clean(value);
  if (["개", "개인", "개인레슨"].includes(type)) return "개인";
  if (["그", "그룹", "그룹레슨"].includes(type)) return "그룹";
  if (["상", "상담"].includes(type)) return "상담";
  return type || "수업";
}

export function formatMemberLessonDate(value, { weekday = false, now = new Date() } = {}) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "날짜 없음";
  const [, year, month, day] = match;
  const base = Number(year) === now.getFullYear() ? `${month}.${day}` : `${year.slice(2)}.${month}.${day}`;
  if (!weekday) return base;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00`);
  const label = Number.isNaN(parsed.getTime()) ? "" : ["일", "월", "화", "수", "목", "금", "토"][parsed.getDay()];
  return label ? `${base} (${label})` : base;
}

const scheduleMemberIds = (lesson) => [...new Set([
  lesson?.memberId,
  ...(Array.isArray(lesson?.memberIds) ? lesson.memberIds : []),
  ...(Array.isArray(lesson?.attendees) ? lesson.attendees.map((item) => item?.memberId) : []),
].map((value) => String(value || "").trim()).filter(Boolean))];

const lessonForNote = (note, schedule) => {
  const sid = String(note?.sid || "").trim();
  return sid ? (schedule || []).find((lesson) => String(lesson?.id || "") === sid) || null : null;
};

const recordState = (note) => {
  const record = note?.lessonRecord || null;
  const state = String(record?.confirmationStatus || note?.confirmationStatus || "");
  const stage = String(record?.stage || "");
  const confirmable = Boolean(record) || state === "pending" || state === "confirmed";
  const confirmed = !confirmable || stage === "confirmed_record";
  return { confirmable, confirmed };
};

const viewOfNote = (note) => {
  const record = note?.lessonRecord || {};
  const structured = record.confirmedRecord || record.structuredDraft || note?.aiSummaryTeacherEdited || note?.aiSummary || {};
  const legacy = parseLegacyLessonRecordBody(normalized(note?.title) === normalized(note?.body) ? "" : note?.body);
  const today = joined(structured.didToday || structured.todayExercises) || legacy.today;
  const change = joined(structured.observations || structured.pain) || legacy.change;
  const reaction = joined(structured.responses || structured.improvements) || legacy.reaction;
  const next = joined(structured.nextFocus) || legacy.next;
  const source = record.confirmedRecord || record.structuredDraft || note?.aiSummaryTeacherEdited || note?.aiSummary ? "ai" : "manual";
  return {
    today: meaningfulToday(today),
    change: stripLessonRecordTags(change).text,
    reaction: stripLessonRecordTags(reaction).text,
    next: stripLessonRecordTags(next).text,
    source,
    dateHint: legacy.dateHint,
  };
};

const explicitRecordTime = (note) => clean(note?.createdAt || note?.recordedAt || note?.lessonRecord?.recordedAt || note?.lessonRecord?.createdAt);

function groupingOf(note, memberId, schedule) {
  const lesson = lessonForNote(note, schedule);
  const sid = String(note?.sid || "").trim();
  if (sid) return { key: sid, lesson, missingTime: false, explicitRecordTime: "" };
  const date = String(note?.date || "").slice(0, 10);
  const startTime = clean(lesson?.start || note?.startTime || note?.start);
  const type = normalizedLessonType(lesson?.type || note?.type);
  if (startTime) return { key: `${memberId}|${date}|${startTime}|${type}`, lesson, missingTime: false, explicitRecordTime: "" };
  const createdAt = explicitRecordTime(note);
  return {
    key: createdAt ? `${memberId}|${date}||${type}|${createdAt}` : `${memberId}|${date}||${type}`,
    lesson,
    missingTime: true,
    explicitRecordTime: createdAt,
  };
}

export function selectMemberLessonSessions({ member, schedule = [] } = {}) {
  const memberId = String(member?.id || "").trim();
  const groups = new Map();
  (member?.notes || []).filter((note) => !["상담", "인바디"].includes(note?.type)).forEach((note) => {
    const grouping = groupingOf(note, memberId, schedule);
    const list = groups.get(grouping.key) || [];
    list.push({ note, ...grouping, view: viewOfNote(note) });
    groups.set(grouping.key, list);
  });

  return [...groups.entries()].map(([key, entries]) => {
    const lesson = entries.find((entry) => entry.lesson)?.lesson || null;
    const notes = entries.map((entry) => entry.note);
    const states = notes.map(recordState);
    const confirmableCount = states.filter((state) => state.confirmable).length;
    const confirmedCount = states.filter((state) => state.confirmable && state.confirmed).length;
    const confirmationState = !confirmableCount || confirmedCount === confirmableCount ? "confirmed" : confirmedCount ? "partial" : "pending";
    const values = entries.map((entry) => entry.view);
    const change = uniqueText(values.map((view) => view.change));
    let reaction = uniqueText(values.map((view) => view.reaction));
    if (normalized(change) && normalized(change) === normalized(reaction)) reaction = "";
    const mergedWithoutTime = entries.length > 1 && entries.every((entry) => entry.missingTime && !entry.explicitRecordTime);
    const confirmedAt = notes.map((note) => note?.lessonRecord?.confirmedAt || note?.confirmedAt || "").filter(Boolean).sort().at(-1) || "";
    const date = String(lesson?.date || notes.map((note) => note?.date || "").filter(Boolean).sort().at(-1) || "").slice(0, 10);
    const startTime = clean(lesson?.start || notes.map((note) => note?.startTime || note?.start).find(Boolean));
    return {
      key,
      date,
      startTime,
      type: normalizedLessonType(lesson?.type || notes[0]?.type),
      today: meaningfulToday(uniqueText(values.map((view) => view.today).filter((value) => value !== "기록 없음"))),
      change,
      reaction,
      next: uniqueText(values.map((view) => view.next)),
      source: values.some((view) => view.source === "ai") ? "ai" : "manual",
      confirmationState,
      confirmedAt,
      confirmedCount,
      confirmableCount,
      records: notes,
      lesson,
      sourceDateHint: values.map((view) => view.dateHint).find(Boolean) || "",
      mergedWithoutTime,
      warning: mergedWithoutTime ? "시간 정보 없음 · 합쳐진 기록일 수 있음" : "",
    };
  }).sort((a, b) => `${b.date}|${b.startTime}|${b.confirmedAt}|${b.key}`.localeCompare(`${a.date}|${a.startTime}|${a.confirmedAt}|${a.key}`));
}

export function selectLessonSheetBriefing({ sessions = [], briefing = null } = {}) {
  const lesson = sessions[0] || null;
  if (lesson) return { source: "lesson_record", date: lesson.date, session: lesson, text: lessonSessionRepresentative(lesson).display, next: lesson.next };
  const fallback = (briefing?.lines || []).find((entry) => !["first_lesson", "no_memory", "membership"].includes(entry?.kind)) || null;
  if (!fallback) return null;
  const stripped = stripLessonRecordTags(fallback.text);
  const sourceDate = (fallback.sourceRefs || []).map((entry) => String(entry?.date || "").slice(0, 10)).filter(Boolean).sort().at(-1) || "";
  const assessmentFallback = fallback.kind === "posture_reminder" || fallback.kind === "milestone"
    || (fallback.sourceRefs || []).some((entry) => entry?.type === "assessment");
  return {
    source: assessmentFallback ? "posture_fallback" : "memory_fallback",
    date: sourceDate,
    session: null,
    text: stripped.text,
    dateHint: stripped.dateHint,
    next: "",
  };
}

export function selectMemberDetailStatus({ member, schedule = [], now = new Date() } = {}) {
  const memberId = String(member?.id || "");
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const nextLesson = schedule.filter((lesson) => scheduleMemberIds(lesson).includes(memberId)
    && String(lesson?.date || "") >= today
    && (lesson?.attendees || []).find((attendee) => String(attendee?.memberId || "") === memberId)?.status === "booked")
    .sort((a, b) => `${a.date}|${a.start || ""}`.localeCompare(`${b.date}|${b.start || ""}`))[0] || null;
  const remaining = Math.max(0, Number(member?.regular || 0) + Number(member?.service || 0));
  const expiry = String(member?.contractEnd || "").slice(0, 10);
  const expiryTime = expiry ? new Date(`${expiry}T00:00:00`).getTime() : NaN;
  const todayTime = new Date(`${today}T00:00:00`).getTime();
  const daysToExpiry = Number.isNaN(expiryTime) ? null : Math.ceil((expiryTime - todayTime) / 86400000);
  const criticalReasons = [remaining === 0 ? "잔여 0회" : "", daysToExpiry !== null && daysToExpiry < 0 ? "기간 만료" : ""].filter(Boolean);
  const warningReasons = [remaining > 0 && remaining <= 3 ? `잔여 ${remaining}회` : "", daysToExpiry !== null && daysToExpiry >= 0 && daysToExpiry <= 30 ? "만료 임박" : "", !nextLesson ? "다음 예약 없음" : ""].filter(Boolean);
  return {
    remaining,
    nextLesson,
    expiry,
    daysToExpiry,
    risk: criticalReasons.length ? "critical" : warningReasons.length ? "warning" : "normal",
    reasons: criticalReasons.length ? criticalReasons : warningReasons,
  };
}

const lessonEnded = (lesson, now) => {
  const date = String(lesson?.date || "");
  const end = clean(lesson?.end || lesson?.start || "23:59");
  const at = new Date(`${date}T${end}:00`).getTime();
  return date && !Number.isNaN(at) && at <= now.getTime();
};

const attendanceStatusFor = (lesson, memberId) => {
  const attendee = (lesson?.attendees || []).find((item) => String(item?.memberId || "") === String(memberId || ""));
  if (attendee) return String(attendee.status || "booked");
  if (String(lesson?.memberId || "") === String(memberId || "")) return String(lesson?.status || "booked");
  return "";
};

export function isPastUnresolvedAttendance({ lesson, memberId, now = new Date() } = {}) {
  const status = attendanceStatusFor(lesson, memberId);
  return Boolean(status) && lessonEnded(lesson, now) && !SETTLED_ATTENDANCE.has(status);
}

export function pendingLessonState(item) {
  const reasons = item?.reasons || [];
  if (reasons.includes("attendance")) return { key: "attendance", label: "출석 미처리", action: "출석 처리" };
  if (reasons.includes("record")) return { key: "record", label: "기록 필요", action: "기록하기" };
  if (item?.session?.confirmationState === "partial") {
    return { key: "partial", label: `일부 확인 (${item.session.confirmedCount}/${item.session.confirmableCount})`, action: "확인" };
  }
  if (reasons.includes("confirmation") || reasons.includes("local_draft")) return { key: "confirmation", label: "확인 필요", action: "확인" };
  return { key: "confirmed", label: "확인 완료", action: "" };
}

export function formatMemberLessonHeader(session, sessions = [], options = {}) {
  const sameDateCount = sessions.filter((item) => item?.date && item.date === session?.date).length;
  const time = sameDateCount > 1 && session?.startTime ? ` ${session.startTime}` : "";
  const type = options.includeType === false ? "" : ` · ${session?.type || "수업"}`;
  return `${formatMemberLessonDate(session?.date, { weekday: options.weekday !== false })}${time}${type}`;
}

export function selectMemberLessonCounts({ member, schedule = [], now = new Date() } = {}) {
  const memberId = String(member?.id || "");
  return schedule.reduce((counts, lesson) => {
    const status = attendanceStatusFor(lesson, memberId);
    if (!status || lesson?.personal) return counts;
    if (status === "done") counts.completed += 1;
    else if (isPastUnresolvedAttendance({ lesson, memberId, now })) counts.unresolved += 1;
    else if (status === "booked") counts.reserved += 1;
    return counts;
  }, { completed: 0, reserved: 0, unresolved: 0 });
}

export function selectPendingLessonSessions({ members = [], schedule = [], pendingDrafts = [], now = new Date() } = {}) {
  const pending = new Map();
  const add = (key, payload, reason) => {
    const current = pending.get(key) || { ...payload, key, reasons: [] };
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    pending.set(key, current);
  };
  const sessionsByMember = new Map(members.map((member) => [String(member?.id || ""), selectMemberLessonSessions({ member, schedule })]));

  members.forEach((member) => {
    (sessionsByMember.get(String(member?.id || "")) || []).filter((session) => session.confirmationState !== "confirmed")
      .forEach((session) => add(`${member.id}|${session.key}`, { memberId: member.id, lessonId: session.lesson?.id || "", session }, "confirmation"));
  });

  schedule.filter((lesson) => lessonEnded(lesson, now) && !lesson?.personal).forEach((lesson) => {
    (lesson.attendees || []).forEach((attendee) => {
      const memberId = String(attendee?.memberId || "");
      const key = `${memberId}|${lesson.id}`;
      const session = (sessionsByMember.get(memberId) || []).find((item) => item.key === String(lesson.id)) || null;
      if (isPastUnresolvedAttendance({ lesson, memberId, now })) {
        add(key, { memberId, lessonId: lesson.id, lesson, session }, "attendance");
        if (session && session.confirmationState !== "confirmed") add(key, { memberId, lessonId: lesson.id, lesson, session }, "confirmation");
        return;
      }
      if (attendee?.status !== "done") return;
      if (attendee?.status === "done" && !session) add(key, { memberId, lessonId: lesson.id, lesson, session }, "record");
      if (session && session.confirmationState !== "confirmed") add(key, { memberId, lessonId: lesson.id, lesson, session }, "confirmation");
    });
  });

  (pendingDrafts || []).forEach((draft) => {
    const memberId = String(draft?.memberId || "");
    const lessonId = String(draft?.lessonId || "");
    if (!memberId || !lessonId) return;
    const lesson = schedule.find((item) => String(item?.id || "") === lessonId) || null;
    const session = (sessionsByMember.get(memberId) || []).find((item) => item.key === lessonId) || null;
    add(`${memberId}|${lessonId}`, { memberId, lessonId, lesson, session, pendingDraft: draft }, "local_draft");
  });

  const sessions = [...pending.values()].sort((a, b) => `${a.lesson?.date || a.session?.date || ""}|${a.lesson?.start || a.session?.startTime || ""}|${a.key}`.localeCompare(`${b.lesson?.date || b.session?.date || ""}|${b.lesson?.start || b.session?.startTime || ""}|${b.key}`));
  return {
    sessions,
    count: sessions.length,
    countForMember: (memberId) => sessions.filter((session) => String(session.memberId) === String(memberId)).length,
  };
}
