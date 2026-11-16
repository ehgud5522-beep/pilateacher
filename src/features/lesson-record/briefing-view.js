/**
 * 수업 전 브리핑 세 덩어리 (설계 문서 3단계, 2026-11-16 대표 승인). 순수 함수 -- 화면은 LessonBriefing.jsx.
 *
 *  꼭 기억할 것  = AI 요약(2단계)의 "꼭 기억할 것" + 회원의 통증 · 주의사항(회원 상세에 강사가 적은 것)
 *  지난 수업     = **지금 연 수업보다 앞선** 마지막 기록의 칸 그대로 (AI 아님) -- 한 것 · 반응 · 다음에 확인할 것
 *  최근 흐름     = AI 요약의 "최근 흐름" · "계속 확인 중" + 몇 회차 · 마지막 수업 뒤 며칠
 *
 * 빈 덩어리는 숨기지 않고 "기록 없음" 이다 -- 비어 있다는 것도 강사에게 정보다.
 *
 * 고친 버그 둘 (지금 시트):
 *  1. 같은 문장이 두 번: "다음 수업 준비" 가 기록의 다음 확인이 없으면 회원 반응 기억으로 채워졌다 -- 바로 위의
 *     "반응" 과 같은 문장. 이제 "다음에 확인할 것" 은 기록의 다음 확인만 쓰고, 한 화면에 같은 문장은 한 번만.
 *  2. "지난 수업" 이 미래 수업일 수 있었다: 지금 연 수업이 아닌 **가장 최근** 기록을 골랐다 -- 지난 주 수업을
 *     열면 어제 기록이 "지난 수업" 으로 섰다. 이제 연 수업보다 앞선 기록만.
 */

const text = (value) => String(value ?? "").trim();
const keyOf = (value) => text(value).toLocaleLowerCase("ko-KR").replace(/[\s.,!?;:'"`()[\]{}·~_\-…]+/g, "");
const dayMs = (iso) => {
  const match = text(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
};

const memberIdsOf = (lesson) => [...new Set([
  lesson?.memberId,
  ...(Array.isArray(lesson?.memberIds) ? lesson.memberIds : []),
  ...(Array.isArray(lesson?.attendees) ? lesson.attendees.map((item) => item?.memberId) : []),
].map(text).filter(Boolean))];
const attendedBy = (lesson, memberId) => {
  const attendee = (Array.isArray(lesson?.attendees) ? lesson.attendees : []).find((item) => text(item?.memberId) === memberId);
  return text(attendee?.status || lesson?.status) === "done";
};

/** a 가 b 보다 앞선 수업인가 (날짜, 같은 날이면 시작 시각). */
const before = (aDate, aStart, bDate, bStart) => {
  const left = text(aDate);
  const right = text(bDate);
  if (!left || !right) return false;
  if (left !== right) return left < right;
  return text(aStart) !== "" && text(bStart) !== "" && text(aStart) < text(bStart);
};

/** 지금 연 수업보다 앞선 마지막 기록 (sessions 는 최신 순, selectMemberLessonSessions). */
export function previousSessionBefore(sessions, lesson) {
  const id = text(lesson?.id);
  return (Array.isArray(sessions) ? sessions : []).find((session) => text(session?.key) !== id
    && before(session?.date, session?.startTime, lesson?.date, lesson?.start)) || null;
}

/** 몇 회차 · 마지막 출석 뒤 며칠. 일정에서 센다 (출석한 수업만). */
export function lessonProgress({ memberId, lesson, schedule = [] }) {
  const id = text(memberId);
  const attended = (Array.isArray(schedule) ? schedule : [])
    .filter((item) => item && text(item.id) !== text(lesson?.id) && memberIdsOf(item).includes(id) && attendedBy(item, id))
    .filter((item) => before(item.date, item.start, lesson?.date, lesson?.start))
    .sort((a, b) => `${text(a.date)}|${text(a.start)}`.localeCompare(`${text(b.date)}|${text(b.start)}`));
  const last = attended.at(-1) || null;
  const gap = last ? Math.round((dayMs(lesson?.date) - dayMs(last.date)) / 86400000) : NaN;
  return {
    sessionNumber: attended.length + 1,
    lastAttendedDate: last ? text(last.date) : "",
    daysSinceLast: Number.isFinite(gap) && gap >= 0 ? gap : null,
  };
}

const summaryItems = (summary, block) => (Array.isArray(summary?.summary?.[block]) ? summary.summary[block] : [])
  .map((item) => ({ text: text(item?.text), sources: (Array.isArray(item?.sources) ? item.sources : []).map((source) => ({ recordId: text(source?.recordId), date: text(source?.date) })).filter((source) => source.date) }))
  .filter((item) => item.text);

/**
 * @param {{ member: any, lesson: any, sessions: any[], schedule?: any[], summary?: any }} input
 *   summary = memberSummaries 문서 (없으면 null). 갱신에 실패했어도 앞 요약(summary.summary)은 쓴다.
 */
export function selectLessonBriefing({ member, lesson, sessions, schedule = [], summary = null }) {
  const seen = new Set();
  const once = (value) => {
    const key = keyOf(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  /* 지난 수업이 먼저 자리를 잡는다 -- 기록 그대로가 요약보다 정확하다. 요약에 같은 문장이 있으면 요약 쪽을 뺀다. */
  const previous = previousSessionBefore(sessions, lesson);
  const lastRows = previous
    ? [["today", "한 것", previous.today], ["reaction", "반응", previous.reaction], ["next", "다음에 확인할 것", previous.next]]
      .map(([key, label, value]) => ({ key, label, text: text(value) === "기록 없음" ? "" : text(value) }))
      .filter((row) => row.text && once(row.text))
    : [];

  const cautions = (Array.isArray(member?.focus) ? member.focus : text(member?.focus) ? [member.focus] : [])
    .map((value) => ({ text: text(value), sources: [], origin: "caution" }))
    .filter((item) => item.text);
  const mustRemember = [...cautions, ...summaryItems(summary, "mustRemember").map((item) => ({ ...item, origin: "summary" }))]
    .filter((item) => once(item.text));
  const trend = summaryItems(summary, "recentTrend").filter((item) => once(item.text));
  const openQuestions = summaryItems(summary, "openQuestions").filter((item) => once(item.text));

  return {
    mustRemember: { items: mustRemember },
    lastLesson: previous ? { date: text(previous.date), type: text(previous.type), key: text(previous.key), rows: lastRows } : null,
    recentTrend: { items: trend, openQuestions, ...lessonProgress({ memberId: member?.id, lesson, schedule }) },
    summaryState: summary?.summary ? (summary.status === "failed" ? "stale" : "ready") : "none",
    summaryStatusCode: text(summary?.statusCode),
  };
}

/** 근거 날짜의 기록 (문장을 누르면 연다). 같은 날 기록이 여럿이면 전부. */
export function sessionsOnDate(sessions, date) {
  return (Array.isArray(sessions) ? sessions : []).filter((session) => text(session?.date) === text(date));
}
