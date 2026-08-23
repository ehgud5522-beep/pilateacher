import { BODY_VIEWS } from "./contracts.js";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?82[-. ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g;
const SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9_-]{8,}|OPENAI_API_KEY|data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi;
const OMIT_KEYS = new Set(["회원", "memberName", "이름", "성명", "회원명", "강사명", "phone", "email", "photo", "image", "blob", "src", "token", "secret", "password", "apiKey", "authorization"]);

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (value, max = 4000, memberName = "") => {
  let result = String(value ?? "").trim();
  const exactName = String(memberName || "").trim();
  if (exactName.length >= 2) result = result.replace(new RegExp(escapeRegExp(exactName), "g"), "[회원]");
  return result.replace(EMAIL, "[이메일]").replace(PHONE, "[전화번호]").replace(SECRET, "[비밀정보]").slice(0, max);
};
const list = (value, max = 20, memberName = "") => Array.isArray(value) ? value.map((item) => text(item, 500, memberName)).filter(Boolean).slice(0, max) : [];

const safeSource = (value, memberName = "", depth = 0) => {
  if (depth > 6) return null;
  if (typeof value === "string") return text(value, 2000, memberName);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => safeSource(item, memberName, depth + 1));
  if (!value || typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 40).flatMap(([key, item]) => {
    if (OMIT_KEYS.has(key) || /(photo|image|blob|base64|token|secret|password|api.?key)/i.test(key)) return [];
    const safeKey = key === "name" ? "label" : key;
    return [[safeKey, safeSource(item, memberName, depth + 1)]];
  }));
};

const REPORT_FIELDS = Object.freeze({
  renewal_consultation: ["goal", "remainingLessons", "expiryDays", "attendance", "bodyComposition", "performance"],
  member_progress_message: ["목표", "비교구간", "체성분", "수행능력", "출석률", "운동페이스", "잔여횟수", "좋아진점", "관리필요"],
  instructor_coaching_note: ["목표", "비교구간", "체성분", "수행능력", "출석률", "운동페이스", "잔여횟수", "좋아진점", "관리필요"],
  member_body_assessment_card: ["bodyAnalysis", "teacherNote"],
});

export function buildBodyAnalysisInput({ member, records, teacherNote = "" }) {
  const memberName = String(member?.name || "").trim();
  const normalizedRecords = (records || []).filter((record) => record?.view).map((record) => ({
    ...record,
    view: record.view === "side" ? "leftSide" : record.view,
  }));
  const byView = new Map(normalizedRecords.map((record) => [record.view, record]));
  return {
    schemaVersion: 1,
    memberId: text(member?.id, 160),
    goals: list(Array.isArray(member?.goal) ? member.goal : [member?.goal], 20, memberName),
    precautions: list(member?.focus, 20, memberName),
    teacherNote: text(teacherNote, 4000, memberName),
    views: BODY_VIEWS.map((view) => {
      const record = byView.get(view);
      return {
        view,
        assessmentId: text(record?.assessmentId, 160),
        pose: record?.pts || {},
        measurements: (record?.metrics || []).map((metric) => ({ key: text(metric?.key, 100), value: Number(metric?.value), unit: text(metric?.unit, 20), direction: text(metric?.dir, 80) })),
        confidence: record?.confidence || null,
        analysisSource: text(record?.analysisSource, 80),
        editedJoints: list(record?.editedJoints, 100),
      };
    }),
  };
}

export function buildVoiceSummaryInput({ transcript, memberId, lessonId }) {
  return { schemaVersion: 1, memberId: text(memberId, 160), lessonId: text(lessonId, 160), transcript: text(transcript, 12000), language: "ko-KR" };
}

export function buildLessonRecordInput({ rawTranscript, termMap, memberId, lessonId }) {
  const mapped = Array.isArray(termMap?.mapped) ? termMap.mapped.slice(0, 80).map((item) => ({
    raw: text(item?.raw, 100), canonical: text(item?.canonical, 100), category: text(item?.category, 80), bodyKey: text(item?.bodyKey, 120),
  })) : [];
  const uncertain = Array.isArray(termMap?.uncertain) ? termMap.uncertain.slice(0, 40).map((item) => ({
    raw: text(item?.raw, 100), candidate: text(item?.canonical, 100), category: text(item?.category, 80), bodyKey: text(item?.bodyKey, 120),
  })) : [];
  return {
    schemaVersion: 1,
    memberId: text(memberId, 160),
    lessonId: text(lessonId, 160),
    rawTranscript: text(rawTranscript, 12000),
    language: "ko-KR",
    termMap: { version: 1, mapped, uncertain },
  };
}

export function buildSequenceInput({ member, schedule, photos }) {
  const memberName = String(member?.name || "").trim();
  const notes = (member?.notes || []).slice().sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || ""))).slice(0, 10);
  const lessons = (schedule || []).filter((lesson) => (lesson?.attendees || []).some((attendee) => attendee?.memberId === member?.id)).slice().sort((a, b) => `${b?.date || ""} ${b?.start || ""}`.localeCompare(`${a?.date || ""} ${a?.start || ""}`)).slice(0, 10);
  const confirmedBody = (photos?.poses || []).find((record) => record?.aiAnalysis?.status === "confirmed")?.aiAnalysis || null;
  return {
    schemaVersion: 1,
    memberId: text(member?.id, 160),
    goals: list(Array.isArray(member?.goal) ? member.goal : [member?.goal], 20, memberName),
    precautions: list(member?.focus, 20, memberName),
    bodyAssessment: confirmedBody ? safeSource(confirmedBody.output, memberName) : null,
    recentLessons: lessons.map((lesson) => ({ lessonId: text(lesson?.id, 160), date: text(lesson?.date, 20), type: text(lesson?.type, 80), status: text((lesson?.attendees || []).find((attendee) => attendee?.memberId === member?.id)?.status, 80) })),
    recentNotes: notes.map((note) => ({ lessonId: text(note?.sid, 160), date: text(note?.date, 20), body: text(note?.body, 2000, memberName), teacherSummary: text(note?.teacherSummary, 2000, memberName) })),
  };
}

export const buildReportInput = ({ reportType, memberId, source, memberName = "" }) => {
  const normalizedType = text(reportType, 80);
  const allowed = REPORT_FIELDS[normalizedType] || [];
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const filtered = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(raw, key)).map((key) => [key, raw[key]]));
  return { schemaVersion: 1, reportType: normalizedType, memberId: text(memberId, 160), source: safeSource(filtered, memberName) };
};

const lines = (label, values) => (values || []).length ? `${label}: ${(values || []).join(" · ")}` : "";

export function formatVoiceSummary(output) {
  if (!output) return "";
  return [
    lines("오늘 운동", output.todayExercises),
    output.memberCondition ? `회원 상태: ${output.memberCondition}` : "",
    lines("통증", output.pain),
    lines("개선", output.improvements),
    lines("다음 목표", output.nextGoals),
    lines("숙제", output.homework),
    lines("주의사항", output.precautions),
  ].filter(Boolean).join("\n");
}

export function formatSequenceRecommendation(output) {
  if (!output) return "";
  return [
    output.title,
    ...(output.exercises || []).map((exercise, index) => `${index + 1}. ${exercise.name}${exercise.dosage ? ` · ${exercise.dosage}` : ""}${exercise.purpose ? ` — ${exercise.purpose}` : ""}`),
    lines("추천 근거", output.rationale),
    lines("주의사항", output.precautions),
  ].filter(Boolean).join("\n");
}

export function formatAIReport(output) {
  if (!output) return "";
  return [output.title, output.summary, lines("핵심 변화", output.highlights), lines("다음 제안", output.recommendations), lines("주의사항", output.precautions), output.disclosure].filter(Boolean).join("\n");
}
