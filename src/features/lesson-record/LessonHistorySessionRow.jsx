import {
  formatMemberLessonHeader, lessonSessionRepresentative,
} from "./member-detail-selectors.js";
import { invokeLessonSessionAction } from "./session-actions.js";

const VIEW_FIELDS = [
  ["today", "오늘 수업"],
  ["change", "변화"],
  ["reaction", "회원 반응"],
  ["next", "다음 확인"],
];

function FieldRows({ session, pastLesson = false }) {
  return <div className="min-w-0 space-y-1.5" data-lesson-record-fields>{VIEW_FIELDS.filter(([key]) => session[key] && session[key] !== "기록 없음").map(([key, label]) => <div key={key} className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-2"><span className="text-caption font-bold" style={{ color: "var(--sub)" }}>{pastLesson && key === "today" ? "수업 내용" : label}</span><span className="min-w-0 break-words text-xs leading-relaxed" style={{ color: "var(--ink2)" }}>{session[key]}</span></div>)}</div>;
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
    /* 수업이 0건인 회원 상세에 이 카드가 실제 기록과 똑같은 모양으로 서 있어,
       기록이 하나 있는 것처럼 보였다. 회원 목록에서 이미 쓰는 "예시" 배지를 그대로
       달고 테두리를 점선으로 둬서, 카드를 읽기 전에 예시임이 보이게 한다.
       카드 자체는 남긴다 -- 처음 쓰는 강사에게 결과 모양을 보여주는 역할이다. */
    return <div className="min-w-0 rounded-lg p-2.5" data-lesson-history-session-row data-variant="preview" style={{ backgroundColor: "var(--canvas)", border: "1px dashed var(--faint)" }}><div className="flex min-w-0 items-center gap-2"><span className="shrink-0 rounded-full px-2 py-0.5 text-caption font-bold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)", border: "1px solid var(--ring)" }}>예시</span><span className="min-w-0 flex-1 truncate text-xs font-extrabold" style={{ color: "var(--ink)" }}>{formatMemberLessonHeader(session, sessions)}</span>{session.source === "ai" && <span className="shrink-0 text-caption font-bold" style={{ color: "var(--brand)" }}>AI 요약</span>}</div><div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}><FieldRows session={session} /></div></div>;
  }

  const detailsProps = expanded === undefined ? {} : { open: Boolean(expanded) };
  return <div className="flex min-w-0 items-start gap-2 rounded-lg p-2.5" data-lesson-history-session-row data-lesson-session-key={session.key} data-variant="interactive" style={{ backgroundColor: "var(--canvas)" }}><details className="min-w-0 flex-1" {...detailsProps} onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}><summary className="min-w-0 cursor-pointer list-none"><span className="flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-extrabold" style={{ color: "var(--ink)" }}>{formatMemberLessonHeader(session, sessions)}</span><span className="shrink-0 text-caption font-bold" style={{ color: status.key === "confirmed" ? "var(--sub)" : "var(--warn)" }}>{status.label}</span></span><span className="mt-1 block truncate text-xs" style={{ color: "var(--ink2)" }}>{representative.display}</span>{session.next && representative.field !== "next" && <span className="mt-1 block truncate text-caption" style={{ color: "var(--sub)" }}>다음 · {session.next}</span>}{session.warning && <span className="mt-1 block text-caption" style={{ color: "var(--sub)" }}>{session.warning}</span>}</summary>{representative.field !== "empty" && <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--line)" }}><FieldRows session={session} pastLesson />{session.sourceDateHint && <p className="mt-2 text-caption tabular-nums" style={{ color: "var(--sub)" }}>원문 날짜 {session.sourceDateHint}</p>}</div>}</details>{["attendance", "record"].includes(status.key) ? <button type="button" data-session-action={status.key} onClick={() => invokeLessonSessionAction(onOpenSheet, session)} className="relative z-[1] h-8 shrink-0 rounded-lg px-2 text-caption font-extrabold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>{status.action}</button> : session.confirmationState !== "confirmed" && session.records?.length > 0 ? <button type="button" data-session-action="confirm" disabled={disabled} onClick={() => invokeLessonSessionAction(onConfirm, session)} className="relative z-[1] h-8 shrink-0 rounded-lg px-2 text-caption font-extrabold" style={{ backgroundColor: "var(--tint)", color: "var(--brand)" }}>수업 기록 확인</button> : null}</div>;
}
