import { BODY_VIEWS } from "./contracts.js";

const text = (value, max = 4000) => String(value ?? "").trim().slice(0, max);
const list = (value, max = 20) => Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, max) : [];

export function buildBodyAnalysisInput({ member, records, teacherNote = "" }) {
  const normalizedRecords = (records || []).filter((record) => record?.view).map((record) => ({
    ...record,
    view: record.view === "side" ? "leftSide" : record.view,
  }));
  const byView = new Map(normalizedRecords.map((record) => [record.view, record]));
  return {
    schemaVersion: 1,
    memberId: text(member?.id, 160),
    goals: list(Array.isArray(member?.goal) ? member.goal : [member?.goal]),
    precautions: list(member?.focus),
    teacherNote: text(teacherNote),
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
  return { schemaVersion: 1, memberId: text(memberId, 160), lessonId: text(lessonId, 160), transcript: text(transcript, 20000), language: "ko-KR" };
}

export function buildSequenceInput({ member, schedule, photos }) {
  const notes = (member?.notes || []).slice().sort((a, b) => String(b?.date || "").localeCompare(String(a?.date || ""))).slice(0, 10);
  const lessons = (schedule || []).filter((lesson) => (lesson?.attendees || []).some((attendee) => attendee?.memberId === member?.id)).slice().sort((a, b) => `${b?.date || ""} ${b?.start || ""}`.localeCompare(`${a?.date || ""} ${a?.start || ""}`)).slice(0, 10);
  const confirmedBody = (photos?.poses || []).find((record) => record?.aiAnalysis?.status === "confirmed")?.aiAnalysis || null;
  return {
    schemaVersion: 1,
    memberId: text(member?.id, 160),
    goals: list(Array.isArray(member?.goal) ? member.goal : [member?.goal]),
    precautions: list(member?.focus),
    bodyAssessment: confirmedBody ? confirmedBody.output : null,
    recentLessons: lessons.map((lesson) => ({ lessonId: text(lesson?.id, 160), date: text(lesson?.date, 20), type: text(lesson?.type, 80), status: text((lesson?.attendees || []).find((attendee) => attendee?.memberId === member?.id)?.status, 80) })),
    recentNotes: notes.map((note) => ({ lessonId: text(note?.sid, 160), date: text(note?.date, 20), body: text(note?.body, 2000), teacherSummary: text(note?.teacherSummary, 2000) })),
  };
}

export const buildReportInput = ({ reportType, memberId, source }) => ({ schemaVersion: 1, reportType: text(reportType, 80), memberId: text(memberId, 160), source });

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
