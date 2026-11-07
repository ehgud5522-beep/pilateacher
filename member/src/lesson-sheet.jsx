/**
 * 예정 수업 상세 + 수업 취소 (2026-11-07, 5차 1단계).
 *
 * 열리면 서버에 "이 수업을 취소할 수 있는가" 를 묻는다 (쓰지 않는다). 서버가 꺼져
 * 있다고 답하면(스위치 · 시범 강사 밖) **취소 영역을 아예 그리지 않는다** -- 회원은
 * 이 기능이 있는지도 모른다. 켜져 있으면 마감 시각 · 남은 횟수 · 버튼.
 *
 * 누르면 한 번 더 묻고, 확인하면 취소한다. 진행 중에는 버튼을 잠근다 -- 그래도 두 번
 * 가면 서버가 한 번만 처리한다 (이미 취소함 = 성공).
 *
 * 서버 호출은 넘겨받는다 (api) -- 테스트가 가짜를 넘긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";
import {
  CANCEL_DONE_TITLE, blockedMessage, cancelDoneNote, cancelFailure, deadlineLabel, remainingLabel,
} from "./cancel-copy.js";
import { lessonName } from "./pass-label.js";
import { MEMBER_FEATURE, MEMBER_STAGE, recordDiagnostic } from "./diagnostics.js";

const text = (value) => String(value ?? "").trim();

function whenLabel(value) {
  const at = value instanceof Date ? value : new Date(value || "");
  if (!Number.isFinite(at.getTime())) return "";
  const dow = ["일", "월", "화", "수", "목", "금", "토"][at.getDay()];
  return `${at.getMonth() + 1}월 ${at.getDate()}일(${dow}) ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * @param {{
 *   lesson: any, place: { organizationId: string, clientId: string }, offline?: boolean,
 *   api: (input: { action: string, organizationId: string, clientId: string, lessonId: string }) => Promise<any>,
 *   onClose: () => void, onCancelled: (lessonId: string) => void,
 * }} props
 */
export function LessonSheet({ lesson, place, offline = false, api, onClose, onCancelled }) {
  const lessonId = text(lesson?.lessonId);
  const request = { organizationId: text(place?.organizationId), clientId: text(place?.clientId), lessonId };
  /* phase: loading · off · ready · confirm · sending · done · failed */
  const [phase, setPhase] = useState(offline ? "off" : "loading");
  const [status, setStatus] = useState(null);
  const [failure, setFailure] = useState(null);
  const [done, setDone] = useState(null);
  const sending = useRef(false);

  const loadStatus = useCallback(async () => {
    if (offline || !lessonId) { setPhase("off"); return; }
    setPhase("loading");
    try {
      const result = await api({ action: "status", ...request });
      setStatus(result);
      setPhase(result?.enabled ? "ready" : "off");
    } catch (error) {
      const view = cancelFailure(error);
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_CANCEL, stage: MEMBER_STAGE.CANCEL_STATUS,
        errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown",
        message: view.code,
      });
      setFailure(view);
      setPhase("failed");
    }
  }, [offline, lessonId, request.organizationId, request.clientId]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const confirmCancel = async () => {
    if (sending.current) return;
    sending.current = true;
    setPhase("sending");
    try {
      const result = await api({ action: "cancel", ...request });
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_CANCEL, stage: MEMBER_STAGE.DONE,
        /* 강사 알림 결과도 함께 -- 완료 화면이 강사 알림을 말하지 않은 이유를 여기서 본다. */
        message: [text(result?.outcome), text(result?.teacherNotice) || "no_notice",
          text(result?.teacherNoticeCode), `inbox_${text(result?.teacherInbox) || "none"}`,
          text(result?.teacherInboxCode)].filter(Boolean).join(":"),
        correlationId: text(result?.recordId),
      });
      setDone(result);
      setPhase("done");
      onCancelled?.(lessonId);
    } catch (error) {
      const view = cancelFailure(error, status?.instructorName);
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_CANCEL, stage: MEMBER_STAGE.CANCEL_CALL,
        errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: view.code,
      });
      setFailure(view);
      /* 막힌 이유가 정해졌으면 버튼을 그 이유로 끈다 -- 그 사이 마감이 지났을 수 있다. */
      if (!view.retry && view.kind !== "unknown") {
        setStatus((previous) => ({ ...(previous || {}), canCancel: false, reason: view.code, ...(view.code === "no_remaining" ? { remaining: 0 } : {}) }));
        setPhase("ready");
      } else {
        setPhase("failed");
      }
    } finally {
      sending.current = false;
    }
  };

  const blocked = status && !status.canCancel ? blockedMessage(status.reason, status.instructorName) : "";
  const tags = [text(lesson?.instructorName) ? `${text(lesson.instructorName)} 강사` : "", text(lesson?.locationName)].filter(Boolean);

  return (
    <div className="sheetwrap" role="dialog" aria-modal="true" aria-label="수업 상세">
      <div className="sheet">
        <div className="sheethead">
          <p className="cap">예정 수업</p>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="name">{lessonName(lesson)}</p>
        <p className="num" style={{ fontSize: TYPE.body }}>{whenLabel(lesson?.startsAt)}</p>
        {tags.length ? <p className="muted" style={{ fontSize: TYPE.caption }}>{tags.join(" · ")}</p> : null}

        {phase === "loading" ? <p className="muted mt" style={{ fontSize: TYPE.caption }}>취소 가능 여부를 확인하고 있어요…</p> : null}

        {["ready", "confirm", "sending"].includes(phase) && status ? (
          <div className="cancelbox">
            <p style={{ fontSize: TYPE.caption }}>취소 마감 <b className="num">{deadlineLabel(status.deadline)}</b></p>
            {remainingLabel(status) ? <p className="muted" style={{ fontSize: TYPE.caption }}>{remainingLabel(status)}</p> : null}
            {phase === "ready" ? (
              <>
                <button type="button" className="btn mt" disabled={!status.canCancel} onClick={() => { setFailure(null); setPhase("confirm"); }}>
                  수업 취소
                </button>
                {blocked ? <p className="blocked">{blocked}</p> : null}
                {failure && !blocked ? <p className="blocked">{failure.message}</p> : null}
              </>
            ) : (
              <>
                <p className="mt" style={{ fontSize: TYPE.body }}>이 수업을 취소할까요?</p>
                <p className="muted" style={{ fontSize: TYPE.caption }}>취소하면 남은 취소 횟수가 1회 줄어요. 회원권 횟수는 그대로예요.</p>
                <button type="button" className="btn primary mt" disabled={phase === "sending"} onClick={confirmCancel}>
                  {phase === "sending" ? "취소하는 중…" : "취소하기"}
                </button>
                <button type="button" className="btn mt" disabled={phase === "sending"} onClick={() => setPhase("ready")}>돌아가기</button>
              </>
            )}
          </div>
        ) : null}

        {phase === "done" ? (
          <div className="cancelbox canceldone" role="status">
            <svg className="donecheck" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeWidth="3" />
              <path d="M12.5 20.5l5 5 10-11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="donetitle">{CANCEL_DONE_TITLE}</p>
            <p className="muted" style={{ fontSize: TYPE.caption }}>{cancelDoneNote(done)}</p>
            {remainingLabel({ remaining: done?.remaining, period: status?.period }) ? (
              <p className="muted" style={{ fontSize: TYPE.caption }}>{remainingLabel({ remaining: done.remaining, period: status?.period })}</p>
            ) : null}
            <button type="button" className="btn mt" onClick={onClose}>닫기</button>
          </div>
        ) : null}

        {phase === "failed" && failure ? (
          <div className="cancelbox">
            <p className="blocked">{failure.message}</p>
            <button type="button" className="btn mt" onClick={status ? () => setPhase("ready") : loadStatus}>
              {status ? "돌아가기" : "다시 시도"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
