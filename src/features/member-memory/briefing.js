import { MEMBER_MEMORY_CONFIG } from "./memory-config.js";
import { buildMemberMemory, confirmedSessions, isBriefingMemory, memoryBodyLabel } from "./member-memory.js";

const clean = (value, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const shortDate = (value) => {
  const match = String(value || "").match(/^\d{4}-(\d{2})-(\d{2})/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "날짜 미상";
};
const sourceDates = (entry) => [...new Set((entry?.sourceRefs || []).filter((source) => source.type === "session").map((source) => shortDate(source.date)).filter(Boolean))];
const line = (kind, text, memoryIds = [], sourceRefs = []) => ({ kind, text, memoryIds, sourceRefs });

function rawFallback(sessions, config) {
  const raw = [...sessions].reverse().find((session) => session.rawOnly);
  if (!raw) return null;
  const transcript = clean(raw.record.rawTranscript || raw.note?.lessonRecord?.rawTranscript || raw.note?.transcript, config.rawPreviewLength);
  return transcript ? line("raw", `[${shortDate(raw.date)}] 원문: ${transcript}`, [], [{ type: "session", id: raw.id, date: raw.date }]) : null;
}

function conflictLines(memories) {
  const groups = new Map();
  memories.filter((entry) => entry.status === "conflict").forEach((entry) => {
    const key = entry.normalizedKey;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  });
  return [...groups.values()].flatMap((entries) => {
    const positive = entries.find((entry) => entry.bodyKey?.quality === "positive");
    const negative = entries.find((entry) => entry.bodyKey?.quality === "negative");
    if (!positive || !negative) return [];
    const dates = [...new Set([...sourceDates(negative), ...sourceDates(positive)])];
    return [line("conflict", `[${dates.join("·")}] 최근 기록이 달라졌습니다: ${negative.text} / ${positive.text}`, entries.map((entry) => entry.id), entries.flatMap((entry) => entry.sourceRefs || []))];
  });
}

export function createMemberBriefing({ member, notes = member?.notes || [], existingMemory = member?.aiMemory || [], currentSessionId = null, now = new Date().toISOString(), config = MEMBER_MEMORY_CONFIG } = {}) {
  const built = buildMemberMemory({ memberId: member?.id, notes, existingMemory, now, excludeSessionId: currentSessionId, config });
  const sessions = confirmedSessions(notes, { excludeSessionId: currentSessionId });
  const active = built.memories.filter(isBriefingMemory);
  if (!sessions.length) return { kind: "first_lesson", lines: [line("first_lesson", "첫 수업")], ...built };
  if (!active.length) {
    const raw = rawFallback(sessions, config);
    return { kind: raw ? "raw_only" : "no_memory", lines: [raw || line("no_memory", "이전 수업의 확정된 핵심 기록이 없습니다.")], ...built };
  }

  const selected = [];
  const used = new Set();
  const add = (value) => {
    if (!value || selected.length >= config.briefingMaxLines) return;
    const key = value.memoryIds?.slice().sort().join("|") || value.text;
    if (used.has(key)) return;
    used.add(key);
    selected.push(value);
  };
  const ranked = (entries) => [...entries].sort((a, b) => `${b.lastSeenAt}|${b.origin === "instructor" ? 1 : 0}`.localeCompare(`${a.lastSeenAt}|${a.origin === "instructor" ? 1 : 0}`));

  ranked(active.filter((entry) => entry.type === "next_focus")).forEach((entry) => add(line("next_focus", `[${shortDate(entry.lastSeenAt)}] ${entry.origin === "instructor" ? "선생님 메모" : "다음 확인"}: ${entry.text}`, [entry.id], entry.sourceRefs)));
  conflictLines(active).forEach(add);
  ranked(active.filter((entry) => entry.status !== "conflict" && entry.type !== "next_focus" && entry.seenCount >= config.patternSeenCount)).forEach((entry) => {
    const dates = sourceDates(entry);
    add(line("pattern", `[${dates.join("·")}] ${memoryBodyLabel(entry)} 관련 기록 ${entry.seenCount}회`, [entry.id], entry.sourceRefs));
  });
  const latestDate = sessions.at(-1)?.date || "";
  ranked(active.filter((entry) => entry.status !== "conflict" && entry.type !== "next_focus" && entry.lastSeenAt === latestDate)).forEach((entry) => add(line(entry.type, `[${shortDate(entry.lastSeenAt)}] ${entry.text}`, [entry.id], entry.sourceRefs)));

  const remaining = Number(member?.regular || 0) + Number(member?.service || 0);
  if (remaining <= 3) add(line("membership", `[이용권] 잔여 ${Math.max(0, remaining)}회`));
  const endDate = String(member?.contractEnd || "").slice(0, 10);
  const daysLeft = endDate ? Math.ceil((new Date(`${endDate}T00:00:00`).getTime() - new Date(String(now).slice(0, 10) + "T00:00:00").getTime()) / 86400000) : null;
  if (daysLeft !== null && daysLeft <= 14) add(line("membership", `[이용권] ${daysLeft < 0 ? `${Math.abs(daysLeft)}일 만료 경과` : `${daysLeft}일 후 만료`}`));
  return { kind: "memory", lines: selected.slice(0, config.briefingMaxLines), ...built };
}

export function memberMemorySummary(briefing) {
  const entries = briefing?.memories || [];
  const latestSession = briefing?.sessions?.at(-1) || null;
  const find = (predicate) => entries.filter(isBriefingMemory).filter(predicate).sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")))[0] || null;
  const repeated = find((entry) => entry.seenCount >= MEMBER_MEMORY_CONFIG.patternSeenCount && entry.status !== "conflict");
  const next = find((entry) => entry.type === "next_focus");
  const change = find((entry) => entry.status === "conflict" || entry.type === "response");
  return {
    lastLesson: latestSession ? shortDate(latestSession.date) : "첫 수업",
    repeated: repeated ? `${memoryBodyLabel(repeated)} · ${repeated.seenCount}회` : "반복 기록 없음",
    nextCheck: next?.text || "다음 확인 없음",
    recentChange: change?.status === "conflict" ? "최근 기록이 달라졌습니다" : change?.text || "최근 변화 없음",
  };
}
