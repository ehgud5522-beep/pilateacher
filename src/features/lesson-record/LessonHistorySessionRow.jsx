import {
  formatMemberLessonHeader, lessonSessionRepresentative,
} from "./member-detail-selectors.js";

const VIEW_FIELDS = [
  ["today", "오늘 수업"],
  ["change", "변화"],
  ["reaction", "회원 반응"],
  ["next", "다음 확인"],
];

function FieldRows({ session, pastLesson = false }) {
  return <div className="min-w-0 space-y-1.5" data-lesson-record-fields>{VIEW_FIELDS.filter(([key]) => session[key] && session[key] !== "기록 없음").map(([key, label]) => <div key={key} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2"><span className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>{pastLesson && key === "today" ? "수업 내용" : label}</span><span className="min-w-0 break-words text-xs leading-relaxed" style={{ color: "var(--ink2)" }}>{session[key]}</span></div>)}</div>;
}

export default function LessonHistorySessionRow({
  session,
  sessions = [],
  status = { key: "confirmed", label: "확인 완료", action: "" },
  onConfirm,
  onOpenSheet,
  expanded,
  onToggle,
  variant = "interactive",
  disabled = false,
}) {
  if (!session) return null;
  const representative = lessonSessionRepresentative(session);

  if (variant === "preview") {
    return <div className="min-w-0 rounded-lg p-2.5" data-lesson-history-session-row data-variant="preview" style={{ backgroundColor: "var(--canvas)" }}><div className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-extrabold" style={{ color: "var(--ink)" }}>{formatMemberLessonHeader(session, sessions)}</span>{session.source === "ai" && <span className="shrink-0 text-[9px] font-bold" style={{ color: "var(--brand)" }}>AI 요약</span>}</div><div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}><FieldRows session={session} /></div></div>;
  }

  const detailsProps = expanded === undefined ? {} : { open: Boolean(expanded) };
  return <div className="flex min-w-0 items-start gap-2 rounded-lg p-2.5" data-lesson-history-session-row data-variant="interactive" style={{ backgroundColor: "var(--canvas)" }}><details className="min-w-0 flex-1" {...detailsProps} onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}><summary className="min-w-0 cursor-pointer list-none"><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-extrabold" style={{ color: "var(--ink)" }}>{formatMemberLessonHeader(session, sessions)}</span><span className="shrink-0 text-[9px] font-bold" style={{ color: status.key === "confirmed" ? "var(--sub)" : "var(--warn)" }}>{status.label}</span></span><span className="mt-1 block truncate text-xs" style={{ color: "var(--ink2)" }}>{representative.display}</span>{session.next && representative.field !== "next" && <span className="mt-1 block truncate text-[10px]" style={{ color: "var(--sub)" }}>다음 · {session.next}</span>}{session.warning && <span className="mt-1 block text-[9px]" style={{ color: "var(--sub)" }}>{session.warning}</span>}</summary>{representative.field !== "empty" && <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}><FieldRows session={session} pastLesson />{session.sourceDateHint && <p className="mt-2 text-[9px] tabular-nums" style={{ color: "var(--sub)" }}>원문 날짜 {session.sourceDateHint}</p>}</div>}</details>{status.key === "attendance" ? <button type="button" onClick={() => onOpenSheet?.(session)} className="h-8 shrink-0 rounded-lg px-2 text-[10px] font-extrabold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>출석 처리</button> : session.confirmationState !== "confirmed" && session.records?.length > 0 ? <button type="button" disabled={disabled} onClick={() => onConfirm?.(session)} className="h-8 shrink-0 rounded-lg px-2 text-[10px] font-extrabold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>확인</button> : null}</div>;
}
