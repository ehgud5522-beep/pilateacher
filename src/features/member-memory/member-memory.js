import { mapPilatesTerms, PILATES_TERMS } from "../lesson-record/term-mapper.js";
import { isCompleteStructuredPhrase } from "../lesson-record/record-schema.js";
import { LESSON_RECORD_PROVENANCE_SOURCE, lessonRecordProvenanceSource } from "../lesson-record/failure-diagnostics.js";
import { MEMBER_MEMORY_CONFIG } from "./memory-config.js";

const MEMORY_FIELDS = Object.freeze([
  ["nextFocus", "next_focus"],
  ["observations", "observation"],
  ["responses", "response"],
]);
const ACTIVE_STATUSES = new Set(["active", "conflict"]);
const NEGATIVE_WORDS = /(불편|통증|아프|어려|제한|불안정|뻣뻣|부족|저하|감소|무너|긴장|약화|힘들)/;
const POSITIVE_WORDS = /(불편\s*(없|없었)|통증\s*(없|없었)|좋아|개선|안정감|안정적|편안|잘\s*(됨|됐|되었)|증가|회복)/;
const SIDE_WORDS = Object.freeze([
  ["right", /(오른쪽|우측|오른편)/],
  ["left", /(왼쪽|좌측|왼편)/],
  ["bilateral", /(양쪽|양측|좌우)/],
]);

const clean = (value, max = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const normalizedText = (value) => clean(value).toLocaleLowerCase("ko-KR").replace(/[\s.,!?;:'"`()\[\]{}·~_-]+/g, "");
const dateOnly = (value) => {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
};
const dayNumber = (value) => {
  const date = dateOnly(value);
  return date ? Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 86400000) : null;
};
const unique = (values) => [...new Set(values.filter(Boolean))].sort();
const hash = (value) => {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
};

const termLabelByKey = new Map(PILATES_TERMS.map((term) => [term.bodyKey, term.canonical]));

function qualityOf(text, mapped) {
  const source = clean(text);
  if (POSITIVE_WORDS.test(source)) return "positive";
  if (NEGATIVE_WORDS.test(source)) return "negative";
  const qualities = mapped.filter((item) => item.bodyKey?.startsWith("quality.")).map((item) => item.bodyKey);
  return qualities[0] || "neutral";
}

function sideOf(text) {
  return SIDE_WORDS.find(([, pattern]) => pattern.test(text))?.[0] || "unspecified";
}

export function bodyKeyFromText(text) {
  const mapping = mapPilatesTerms(text);
  const exact = mapping.mapped || [];
  const region = unique(exact.filter((item) => item.category === "anatomy").map((item) => item.bodyKey)).join("+") || "general";
  const movementOrContext = unique(exact.filter((item) => ["equipment", "exercise", "movement"].includes(item.category) || (item.category === "concept" && !item.bodyKey?.startsWith("quality."))).map((item) => item.bodyKey)).join("+") || "general";
  return {
    region,
    side: sideOf(clean(text)),
    movementOrContext,
    quality: qualityOf(text, exact),
  };
}

export const normalizedBodyKey = (bodyKey) => [bodyKey?.region || "general", bodyKey?.side || "unspecified", bodyKey?.movementOrContext || "general"].join("|");

function memoryMergeKey({ type, bodyKey }) {
  return `${type}|${normalizedBodyKey(bodyKey)}|${bodyKey?.quality || "neutral"}`;
}

function sourceId(note) {
  return clean(note?.sid || note?.id, 160);
}

function confirmedRecordOf(note) {
  const record = note?.lessonRecord;
  if (!record || record.stage !== "confirmed_record") return null;
  return record.confirmedRecord || null;
}

export function confirmedSessions(notes, { excludeSessionId = null } = {}) {
  return (notes || []).flatMap((note) => {
    const record = confirmedRecordOf(note);
    const id = sourceId(note);
    if (!record || !id || id === excludeSessionId) return [];
    const provenanceSource = lessonRecordProvenanceSource(note.lessonRecord);
    return [{
      id,
      date: dateOnly(note.date || note.confirmedAt || note.lessonRecord?.confirmedAt || note.recordedAt),
      note,
      record,
      provenanceSource,
      rawOnly: !Array.isArray(record.observations) && Boolean(clean(record.rawTranscript || note.lessonRecord?.rawTranscript || note.transcript)),
    }];
  }).sort((a, b) => `${a.date}|${a.id}`.localeCompare(`${b.date}|${b.id}`));
}

const recordValues = (record, field) => (Array.isArray(record?.[field]) ? record[field] : [])
  .map((item) => ({ text: clean(typeof item === "string" ? item : item?.text), origin: item?.origin }))
  .filter((item) => item.text && isCompleteStructuredPhrase(item.text));

export function selectLastLessonMemoryRecord(session) {
  if (!session?.record) return null;
  const didToday = recordValues(session.record, "didToday");
  const provenanceSource = session.provenanceSource || lessonRecordProvenanceSource(session.note?.lessonRecord);
  if (didToday.length) {
    return {
      text: didToday.map((item) => item.text).join(" · "),
      origin: didToday.some((item) => item.origin === "ai") ? "ai" : "instructor",
      provenanceSource,
      sourceLabel: provenanceSource === LESSON_RECORD_PROVENANCE_SOURCE.OPENAI ? "[AI]" : "선생님 기록",
    };
  }
  const instructorEdited = session.note?.lessonRecord?.instructorBodyOrigin === "instructor";
  const recordSentence = provenanceSource === LESSON_RECORD_PROVENANCE_SOURCE.OPENAI || instructorEdited
    ? clean(session.note?.teacherSummary || session.note?.body, 12000)
    : "";
  if (recordSentence && isCompleteStructuredPhrase(recordSentence)) {
    return {
      text: recordSentence,
      origin: instructorEdited ? "instructor" : provenanceSource === LESSON_RECORD_PROVENANCE_SOURCE.OPENAI ? "ai" : "instructor",
      provenanceSource,
      sourceLabel: instructorEdited || provenanceSource === LESSON_RECORD_PROVENANCE_SOURCE.FALLBACK_RAW ? "선생님 기록" : "[AI]",
    };
  }
  const rawTranscript = clean(session.record.rawTranscript || session.note?.lessonRecord?.rawTranscript || session.note?.transcript, 12000);
  return rawTranscript ? {
    text: rawTranscript,
    origin: "instructor",
    provenanceSource: LESSON_RECORD_PROVENANCE_SOURCE.FALLBACK_RAW,
    sourceLabel: "선생님 기록",
  } : null;
}

function itemOf(value) {
  const text = clean(typeof value === "string" ? value : value?.text);
  if (!text) return null;
  const origin = ["ai", "instructor", "raw"].includes(value?.origin) ? value.origin : "ai";
  return { text, origin };
}

export function memoryCandidatesFromSession(memberId, session) {
  if (!memberId || !session?.id || !session?.record || session.rawOnly) return [];
  const candidates = [];
  const inSession = new Set();
  MEMORY_FIELDS.forEach(([field, type]) => {
    (session.record[field] || []).forEach((value) => {
      const item = itemOf(value);
      if (!item || item.text === "특이사항 없음") return;
      const bodyKey = bodyKeyFromText(item.text);
      const mergeKey = memoryMergeKey({ type, bodyKey });
      if (inSession.has(mergeKey)) return;
      inSession.add(mergeKey);
      const normalizedKey = normalizedBodyKey(bodyKey);
      const sourceRef = { type: "session", id: session.id, date: session.date, field, text: item.text, provenanceSource: session.provenanceSource };
      candidates.push({
        id: `memory_${hash(`${memberId}|${mergeKey}`)}`,
        memberId,
        type,
        text: item.text,
        bodyKey,
        normalizedKey,
        origin: item.origin,
        provenanceSource: session.provenanceSource,
        status: "active",
        sourceRefs: [sourceRef],
        firstSeenAt: session.date,
        lastSeenAt: session.date,
        seenCount: 1,
        confidence: mapPilatesTerms(item.text).mapped.length ? 1 : 0.8,
      });
    });
  });
  return candidates;
}

function mergeCandidate(current, candidate) {
  const seenSource = current.sourceRefs.some((source) => source.type === "session" && source.id === candidate.sourceRefs[0].id);
  const sourceRefs = seenSource ? current.sourceRefs : [...current.sourceRefs, ...candidate.sourceRefs];
  const instructorProtected = current.origin === "instructor" && candidate.origin !== "instructor";
  return {
    ...current,
    text: instructorProtected ? current.text : candidate.text,
    bodyKey: instructorProtected ? current.bodyKey : candidate.bodyKey,
    normalizedKey: instructorProtected ? current.normalizedKey : candidate.normalizedKey,
    origin: current.origin === "instructor" || candidate.origin === "instructor" ? "instructor" : candidate.origin,
    sourceRefs,
    firstSeenAt: [current.firstSeenAt, candidate.firstSeenAt].filter(Boolean).sort()[0] || "",
    lastSeenAt: [current.lastSeenAt, candidate.lastSeenAt].filter(Boolean).sort().at(-1) || "",
    seenCount: sourceRefs.filter((source) => source.type === "session").length,
    confidence: Math.min(current.confidence, candidate.confidence),
  };
}

function staleStatus(entry, sessions, now, config) {
  const lastDay = dayNumber(entry.lastSeenAt);
  const nowDay = dayNumber(now);
  const laterSessions = sessions.filter((session) => session.date && session.date > entry.lastSeenAt).length;
  if (laterSessions >= config.staleAfterSessions || (lastDay !== null && nowDay !== null && nowDay - lastDay >= config.staleAfterDays)) return "stale";
  return "active";
}

export function buildMemberMemory({ memberId, notes = [], existingMemory = [], now = new Date().toISOString(), excludeSessionId = null, config = MEMBER_MEMORY_CONFIG } = {}) {
  const sessions = confirmedSessions(notes, { excludeSessionId });
  const sessionIds = new Set(sessions.map((session) => session.id));
  const candidates = sessions.flatMap((session) => memoryCandidatesFromSession(memberId, session));
  const rejected = (existingMemory || []).filter((entry) => entry?.status === "rejected");
  const resolved = (existingMemory || []).filter((entry) => entry?.status === "resolved");
  const protectedInstructor = (existingMemory || []).filter((entry) => entry?.origin === "instructor"
    && !["rejected", "resolved"].includes(entry?.status)
    && Array.isArray(entry.sourceRefs) && entry.sourceRefs.length > 0
    && entry.sourceRefs.every((source) => source.type === "assessment" || (source.type === "session" && sessionIds.has(source.id))));
  const rejectedKeys = new Set(rejected.map((entry) => memoryMergeKey(entry)));
  const resolvedByKey = new Map(resolved.map((entry) => [memoryMergeKey(entry), entry]));
  const merged = new Map();
  protectedInstructor.forEach((entry) => merged.set(memoryMergeKey(entry), { ...entry, sourceRefs: [...(entry.sourceRefs || [])] }));
  let suppressedCount = 0;
  let mergedCount = 0;

  candidates.forEach((candidate) => {
    const key = memoryMergeKey(candidate);
    if (rejectedKeys.has(key)) { suppressedCount += 1; return; }
    const current = merged.get(key);
    if (current) { merged.set(key, mergeCandidate(current, candidate)); mergedCount += 1; }
    else merged.set(key, { ...candidate, ...(resolvedByKey.has(key) ? { supersedesId: resolvedByKey.get(key).id } : {}) });
  });

  const live = [...merged.values()].map((entry) => ({ ...entry, status: staleStatus(entry, sessions, now, config) }));
  const conflictGroups = new Map();
  live.filter((entry) => entry.status === "active" && entry.type !== "next_focus").forEach((entry) => {
    const key = entry.normalizedKey;
    const list = conflictGroups.get(key) || [];
    list.push(entry);
    conflictGroups.set(key, list);
  });
  const conflictIds = new Set();
  conflictGroups.forEach((entries) => {
    const qualities = new Set(entries.map((entry) => entry.bodyKey.quality));
    if (qualities.has("positive") && qualities.has("negative")) entries.forEach((entry) => conflictIds.add(entry.id));
  });
  const memories = live.map((entry) => conflictIds.has(entry.id) ? { ...entry, status: "conflict" } : entry)
    .concat(rejected, resolved)
    .sort((a, b) => `${b.lastSeenAt || ""}|${b.id || ""}`.localeCompare(`${a.lastSeenAt || ""}|${a.id || ""}`));
  return {
    memories,
    sessions,
    candidates,
    stats: {
      candidateCount: candidates.length,
      mergedCount,
      suppressedCount,
      patternCount: memories.filter((entry) => ACTIVE_STATUSES.has(entry.status) && entry.seenCount >= config.patternSeenCount).length,
    },
  };
}

export function addPostureMilestone(existingMemory, {
  memberId = null,
  assessmentId = null,
  role = "unassigned",
  date = new Date().toISOString(),
  text = "",
  metricIds = [],
} = {}) {
  const safeMemberId = clean(memberId, 160);
  const safeAssessmentId = clean(assessmentId, 160);
  const milestoneDate = dateOnly(date);
  const milestoneText = clean(text);
  if (!safeMemberId || !safeAssessmentId || !milestoneDate || !milestoneText) return [...(existingMemory || [])];
  const safeRole = ["before", "after", "unassigned"].includes(role) ? role : "unassigned";
  const id = `posture_milestone_${hash(`${safeMemberId}|${safeAssessmentId}`)}`;
  const sourceRef = {
    type: "assessment",
    id: safeAssessmentId,
    date: milestoneDate,
    field: "posture_milestone",
    role: safeRole,
  };
  const milestone = {
    id,
    memberId: safeMemberId,
    type: "milestone",
    category: "posture",
    text: milestoneText,
    bodyKey: { region: "posture", side: "unspecified", movementOrContext: `assessment.${safeAssessmentId}`, quality: "neutral" },
    normalizedKey: `posture|unspecified|assessment.${safeAssessmentId}`,
    /* 기존 assessment 출처 보호 경로를 재사용하고, 화면 표시는 presentationOrigin으로 구분한다. */
    origin: "instructor",
    presentationOrigin: "ai",
    generatedBy: "posture_metric_template",
    source: "posture_analysis",
    milestoneRole: safeRole,
    metricIds: [...new Set((metricIds || []).map((value) => clean(value, 160)).filter(Boolean))].slice(0, 2),
    status: "active",
    sourceRefs: [sourceRef],
    firstSeenAt: milestoneDate,
    lastSeenAt: milestoneDate,
    seenCount: 1,
    confidence: 1,
  };
  return [milestone, ...(existingMemory || []).filter((entry) => entry?.id !== id)]
    .sort((a, b) => `${b?.lastSeenAt || ""}|${b?.id || ""}`.localeCompare(`${a?.lastSeenAt || ""}|${a?.id || ""}`));
}

export function rejectMemoryEntry(memories, memoryId, rejectedAt = new Date().toISOString()) {
  return (memories || []).map((entry) => entry.id === memoryId && entry.origin !== "instructor"
    ? { ...entry, status: "rejected", rejectedAt }
    : entry);
}

export function memoryBodyLabel(entry) {
  const keys = [entry?.bodyKey?.region, entry?.bodyKey?.movementOrContext]
    .flatMap((value) => String(value || "").split("+"))
    .filter((value) => value && value !== "general");
  return unique(keys.map((key) => termLabelByKey.get(key) || key))[0] || "회원 상태";
}

export const isBriefingMemory = (entry) => ACTIVE_STATUSES.has(entry?.status);
