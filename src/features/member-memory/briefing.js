import { MEMBER_MEMORY_CONFIG } from "./memory-config.js";
import { isBriefingMemory, memoryBodyLabel, memorySourceSessions, selectLastLessonMemoryRecord } from "./member-memory.js";

const clean = (value, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const shortDate = (value) => {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "날짜 미상";
};
const displayDate = (value) => {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${match[1]}.${match[2]}` : "";
};
const line = (kind, text, memoryIds = [], sourceRefs = []) => ({ kind, text, memoryIds, sourceRefs });
const isPostureDerivedMemory = (entry) => entry?.category === "posture"
  || entry?.source === "posture_analysis"
  || (entry?.sourceRefs || []).some((source) => source?.type === "assessment");

export function createMemberBriefing({ member, notes = member?.notes || [], existingMemory = member?.aiMemory || [], currentSessionId = null, schedule = [], config = MEMBER_MEMORY_CONFIG } = {}) {
  const sessions = memorySourceSessions(notes, { excludeSessionId: currentSessionId, schedule });
  const active = (existingMemory || []).flatMap((entry) => {
    if (!isBriefingMemory(entry) || isPostureDerivedMemory(entry)) return [];
    const sessionRefs = (entry.sourceRefs || []).filter((source) => source?.type === "session");
    if (!currentSessionId || !sessionRefs.some((source) => String(source.id) === String(currentSessionId))) return [entry];
    const sourceRefs = (entry.sourceRefs || []).filter((source) => !(source?.type === "session" && String(source.id) === String(currentSessionId)));
    if (!sourceRefs.some((source) => source?.type === "session")) return [];
    const latest = sourceRefs.filter((source) => source?.type === "session" && source?.date).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
    return [{ ...entry, sourceRefs, lastSeenAt: latest?.date || entry.lastSeenAt, sourceState: latest?.sourceState || entry.sourceState }];
  });
  const selected = [];
  const usedFacts = new Set();
  const sourceDateOf = (entry) => (entry?.sourceRefs || []).filter((source) => source?.type === "session" && source?.date)
    .map((source) => String(source.date).slice(0, 10)).sort().at(-1) || String(entry?.lastSeenAt || "").slice(0, 10);
  const add = ({ kind, fact, dedupeText = fact, date, sourceState = "confirmed", memoryIds = [], sourceRefs = [] }) => {
    const cleanedFact = clean(fact);
    const dateLabel = displayDate(date);
    const factKey = clean(dedupeText).toLocaleLowerCase("ko-KR").replace(/[\s.,!?;:'"`()\[\]{}·~_-]+/g, "");
    if (!cleanedFact || !dateLabel || usedFacts.has(factKey) || selected.length >= config.briefingMaxLines) return;
    usedFacts.add(factKey);
    const suffix = sourceState === "draft" ? " · 확인 전" : "";
    const prefix = `${dateLabel} · `;
    const available = Math.max(0, 60 - prefix.length - suffix.length);
    selected.push(line(kind, `${prefix}${cleanedFact.slice(0, available)}${suffix}`, memoryIds, sourceRefs));
  };
  const ranked = (entries) => [...entries].sort((a, b) => `${sourceDateOf(b)}|${b.origin === "instructor" ? 1 : 0}`.localeCompare(`${sourceDateOf(a)}|${a.origin === "instructor" ? 1 : 0}`));
  const addMemory = (type, kind, label) => {
    const entry = ranked(active.filter((item) => item.type === type))[0];
    if (entry) add({ kind, fact: `${label}: ${entry.text}`, dedupeText: entry.text, date: sourceDateOf(entry), sourceState: entry.sourceState, memoryIds: [entry.id], sourceRefs: entry.sourceRefs || [] });
  };

  addMemory("next_focus", "next_focus", "다음 확인");
  addMemory("observation", "observation", "계속 확인");
  addMemory("response", "response", "회원 반응");
  const latestSession = sessions.at(-1) || null;
  const lastLesson = selectLastLessonMemoryRecord(latestSession);
  if (latestSession && lastLesson) add({
    kind: "last_lesson",
    fact: `지난 수업: ${lastLesson.text}`,
    dedupeText: lastLesson.text,
    date: latestSession.date,
    sourceState: latestSession.sourceState,
    sourceRefs: [{ type: "session", id: latestSession.id, date: latestSession.date, field: latestSession.rawOnly ? "rawTranscript" : "didToday", sourceState: latestSession.sourceState }],
  });
  return {
    kind: selected.length ? "memory" : sessions.length ? "no_memory" : "first_lesson",
    lines: selected,
    memories: existingMemory || [],
    sessions,
    candidates: [],
    stats: { candidateCount: 0, mergedCount: 0, suppressedCount: 0, patternCount: active.filter((entry) => entry.seenCount >= config.patternSeenCount).length },
  };
}

export function memberMemorySummary(briefing) {
  const entries = briefing?.memories || [];
  const latestSession = briefing?.sessions?.at(-1) || null;
  const find = (predicate) => entries.filter(isBriefingMemory).filter((entry) => !isPostureDerivedMemory(entry)).filter(predicate).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))[0] || null;
  const repeated = find((entry) => entry.seenCount >= MEMBER_MEMORY_CONFIG.patternSeenCount && entry.status !== "conflict");
  const next = find((entry) => entry.type === "next_focus");
  const change = find((entry) => entry.status === "conflict" || entry.type === "response" || entry.type === "milestone");
  return {
    lastLesson: latestSession ? shortDate(latestSession.date) : "첫 수업",
    repeated: repeated ? `${memoryBodyLabel(repeated)} · ${repeated.seenCount}회` : "반복 기록 없음",
    nextCheck: next?.text || "다음 확인 없음",
    recentChange: change?.status === "conflict" ? "최근 기록이 달라졌습니다" : change?.text || "최근 변화 없음",
  };
}

const scheduleSourceDate = (entry) => (entry?.sourceRefs || [])
  .filter((source) => (source?.type === "session" || source?.type === "assessment") && source?.date)
  .map((source) => String(source.date).slice(0, 10))
  .sort()
  .at(-1) || String(entry?.lastSeenAt || "").slice(0, 10);

const scheduleDateLabel = (value) => {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}.${Number(match[2])}` : "";
};

/**
 * 일정 카드용 읽기 전용 셀렉터.
 * 다음 확인 > 최근 변화 > 반복 기록 순서로 활성 Memory 한 건만 선택한다.
 */
export function selectScheduleBriefing(briefing) {
  const active = (briefing?.memories || []).filter(isBriefingMemory).filter((entry) => !isPostureDerivedMemory(entry));
  const ranked = (entries) => [...entries].sort((a, b) => {
    const instructorOrder = Number(b?.origin === "instructor") - Number(a?.origin === "instructor");
    return instructorOrder || String(b?.lastSeenAt || "").localeCompare(String(a?.lastSeenAt || ""));
  });
  const nextCheck = ranked(active.filter((entry) => entry.type === "next_focus"))[0] || null;
  const recentChange = ranked(active.filter((entry) => entry.status === "conflict" || entry.type === "response" || entry.type === "milestone"))[0] || null;
  const repeated = ranked(active.filter((entry) => entry.status !== "conflict" && entry.type !== "next_focus" && entry.seenCount >= MEMBER_MEMORY_CONFIG.patternSeenCount))[0] || null;
  const selected = nextCheck || recentChange || repeated;
  if (!selected) return null;

  const kind = selected === nextCheck ? "next_check" : selected === recentChange ? "recent_change" : "repeated";
  const text = kind === "next_check"
    ? `다음 확인: ${clean(selected.text)}`
    : kind === "repeated"
      ? `${memoryBodyLabel(selected)} 관련 기록 ${selected.seenCount}회`
      : clean(selected.text);
  if (!text) return null;
  const sourceDate = scheduleSourceDate(selected);
  const dateLabel = scheduleDateLabel(sourceDate);
  if (!dateLabel) return null;
  const confirmationLabel = selected.sourceState === "draft" ? " · 확인 전" : "";
  const datedText = `${dateLabel} · ${text}${confirmationLabel}`;
  return {
    kind,
    text: datedText,
    displayText: datedText,
    dateLabel,
    sourceDate,
    memoryId: selected.id,
    sourceRefs: selected.sourceRefs || [],
  };
}
