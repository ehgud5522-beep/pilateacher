import { isBriefingMemory } from "./member-memory.js";

/**
 * 수업 관리 시트 전용 표시 셀렉터 — 읽기 전용이다.
 *
 * createMemberBriefing() 의 생성 로직은 건드리지 않고, 이미 만들어진
 * briefing.lines / briefing.memories 에서 시트에 보여줄 것만 고른다.
 * 없는 데이터를 만들어내지 않는다 — 고를 것이 없으면 null 을 돌려주고
 * 시트는 섹션 자체를 그리지 않는다.
 */

export const LESSON_SHEET_BRIEFING_KIND = Object.freeze({
  VOICE: "voice",
  POSTURE: "posture",
});

/* 직전 1회분만 보여준다 — "오늘 이어서" 한 줄을 더해도 4줄을 넘기지 않는다. */
const VOICE_BODY_MAX_LINES = 3;
/* 촬영 이벤트(비포/애프터/추천 시점)는 강사가 쓸 정보가 아니라 숨긴다. */
const POSTURE_EVENT_KINDS = new Set(["milestone", "posture_reminder"]);
/* 회차 본문이 아닌 줄 — 이용권 안내는 회원 카드에서 따로 보여준다. */
const NON_SESSION_KINDS = new Set(["membership", "first_lesson", "no_memory"]);
const NEXT_FOCUS_LABEL = /^(선생님 메모|다음 확인)\s*:\s*/;
const DATE_PREFIX = /^\[[^\]]*\]\s*/;
/* "전면 어깨 틀어짐: 3.3° → 0.9° (0° 기준에 가까워짐)" */
const METRIC_DETAIL = /^(.+?):\s*(\S+)\s*→\s*(\S+)\s*\((.+)\)$/;

const dateOnly = (value) => {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
};

const dayLabel = (value) => {
  const match = dateOnly(value).match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
};

const stripDatePrefix = (value) => String(value ?? "").replace(DATE_PREFIX, "").trim();

const sessionDatesOf = (line) => [...new Set((line?.sourceRefs || [])
  .filter((source) => source?.type === "session" && source?.date)
  .map((source) => dateOnly(source.date))
  .filter(Boolean))];

const isPostureLine = (line) => POSTURE_EVENT_KINDS.has(line?.kind)
  || (line?.sourceRefs || []).some((source) => source?.type === "assessment");

const isPostureMemory = (entry) => entry?.source === "posture_analysis"
  || (entry?.sourceRefs || [])[0]?.type === "assessment";

/** 마일스톤 문장에서 각도 변화만 떼어낸다. 촬영 이벤트뿐이면 빈 배열. */
export function postureMetricRows(text) {
  return String(text ?? "").split(" · ")
    .map((segment) => segment.trim().match(METRIC_DETAIL))
    .filter(Boolean)
    .map(([, label, before, after, summary]) => ({
      label: label.trim(),
      before: before.trim(),
      after: after.trim(),
      summary: summary.trim(),
    }));
}

function voiceSection(briefing) {
  const sessions = briefing?.sessions || [];
  const latestDate = dateOnly(sessions.at(-1)?.date);
  if (!latestDate) return null;
  const lines = briefing?.lines || [];
  const body = lines
    .filter((line) => !isPostureLine(line) && line?.kind !== "next_focus" && !NON_SESSION_KINDS.has(line?.kind))
    /* 여러 회차를 묶은 줄(반복 기록·달라진 기록)은 직전 1회 원칙에서 제외한다 */
    .filter((line) => { const dates = sessionDatesOf(line); return dates.length === 1 && dates[0] === latestDate; })
    .map((line) => ({ kind: line.kind, text: stripDatePrefix(line.text) }))
    .filter((line) => line.text)
    .slice(0, VOICE_BODY_MAX_LINES);
  const focusLine = lines.find((line) => line?.kind === "next_focus" && !isPostureLine(line));
  const nextFocus = focusLine ? stripDatePrefix(focusLine.text).replace(NEXT_FOCUS_LABEL, "").trim() : "";
  if (!body.length && !nextFocus) return null;
  return {
    kind: LESSON_SHEET_BRIEFING_KIND.VOICE,
    title: "지난 수업 이어서 보기",
    dateBadge: `${dayLabel(latestDate)} 수업`,
    lines: body,
    nextFocus: nextFocus || "",
    metrics: [],
  };
}

function postureSection(briefing) {
  const latest = (briefing?.memories || [])
    .filter(isBriefingMemory)
    .filter(isPostureMemory)
    .map((entry) => ({ entry, metrics: postureMetricRows(entry.text) }))
    .filter((item) => item.metrics.length)
    .sort((a, b) => String(b.entry.lastSeenAt || "").localeCompare(String(a.entry.lastSeenAt || "")))[0];
  if (!latest) return null;
  return {
    kind: LESSON_SHEET_BRIEFING_KIND.POSTURE,
    title: "지난 체형분석 변화",
    dateBadge: "",
    lines: [],
    nextFocus: "",
    metrics: latest.metrics,
  };
}

/**
 * 음성 수업기록이 있으면 직전 1회 요약, 없으면 체형분석 각도 변화,
 * 둘 다 없으면 null(섹션을 그리지 않는다).
 */
export function selectLessonSheetBriefing(briefing) {
  if (!briefing) return null;
  return voiceSection(briefing) || postureSection(briefing) || null;
}
