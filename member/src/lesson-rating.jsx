/**
 * 수업 후 별점 평가 카드 (2026-11-09 대표 요청 · 대표가 보낸 화면).
 *
 * 홈 맨 위에 한 장. 기간(RATING_WINDOW_DAYS) 안의 가장 최근 출석 수업 하나를 묻는다.
 *
 * 열리면 서버에 "이 수업을 평가받는가" 를 먼저 묻는다 (쓰지 않는다). 꺼져 있거나(스위치 ·
 * 시범 강사 밖) 받지 않는 수업이면 **아무것도 그리지 않는다** -- 회원은 이 기능이 있는지도
 * 모른다. 이미 보냈으면 역시 그리지 않는다.
 *
 * 항목 · 문구는 functions/shared/lesson-rating.mjs 한 곳에서 온다. 서버 호출은 넘겨받는다
 * (api) -- 테스트가 가짜를 넘긴다.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";
import { RATING_COPY, RATING_ITEMS, SCORE_RANGE } from "../../functions/shared/lesson-rating.mjs";
import { ratingFailure } from "./rating-copy.js";
import { MEMBER_FEATURE, MEMBER_STAGE, recordDiagnostic } from "./diagnostics.js";

const text = (value) => String(value ?? "").trim();
const STARS = Array.from({ length: SCORE_RANGE.max - SCORE_RANGE.min + 1 }, (_, index) => SCORE_RANGE.min + index);

function Star({ filled }) {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.8l2.8 5.7 6.3.9-4.6 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2-4.6-4.4 6.3-.9z"
        fill="currentColor" fillOpacity={filled ? 1 : 0} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * @param {{
 *   lesson: { lessonId: string }, place: { organizationId: string, clientId: string },
 *   api: (input: any) => Promise<any>,
 *   onSeen: (lessonId: string, options?: { keep?: boolean }) => void,
 *   initialPhase?: string, initialScores?: Record<string, number>,
 * }} props
 * onSeen: 보냈거나 "다음에" 를 눌렀거나 받지 않는 수업일 때 -- 다시 묻지 않게 기기에 적는다.
 * 보낸 직후에는 keep:true -- "고마워요" 를 이번 화면에 남긴다.
 */
export function LessonRatingCard({ lesson, place, api, onSeen, initialPhase = "loading", initialScores = {} }) {
  const lessonId = text(lesson?.lessonId);
  const request = { organizationId: text(place?.organizationId), clientId: text(place?.clientId), lessonId };
  /* phase: loading · hidden · ready · sending · done */
  const [phase, setPhase] = useState(initialPhase);
  const [scores, setScores] = useState(initialScores);
  const [failure, setFailure] = useState(null);
  const sending = useRef(false);

  const loadStatus = useCallback(async () => {
    if (!lessonId) { setPhase("hidden"); return; }
    setPhase("loading");
    try {
      const result = await api({ action: "status", ...request });
      if (result?.enabled && !result?.rated) { setPhase("ready"); return; }
      setPhase("hidden");
      /* 꺼짐은 적지 않는다 -- 나중에 켜면 기간 안의 수업은 다시 물어야 한다. */
      if (result?.rated || (result?.reason && !["feature_off", "lesson_not_started", "lesson_not_attended"].includes(result.reason))) onSeen?.(lessonId);
    } catch (error) {
      const view = ratingFailure(error);
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_RATING, stage: MEMBER_STAGE.RATING_STATUS,
        errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: view.code,
      });
      /* 상태를 못 읽었으면 묻지 않는다 -- 평가는 회원이 도와주는 일이라 오류를 띄울 자리가 아니다.
         다음에 열 때 다시 묻는다 (기기에 적지 않음). */
      setPhase("hidden");
    }
  }, [lessonId, request.organizationId, request.clientId]);

  useEffect(() => { if (initialPhase === "loading") loadStatus(); }, [loadStatus, initialPhase]);

  const complete = RATING_ITEMS.every((item) => Number.isInteger(scores[item.id]));

  const submit = async () => {
    if (sending.current || !complete) return;
    sending.current = true;
    setPhase("sending");
    setFailure(null);
    try {
      const result = await api({ action: "submit", ...request, scores });
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_RATING, stage: MEMBER_STAGE.DONE,
        message: text(result?.outcome), correlationId: text(result?.ratingId),
      });
      setPhase("done");
      onSeen?.(lessonId, { keep: true });
    } catch (error) {
      const view = ratingFailure(error);
      recordDiagnostic({
        feature: MEMBER_FEATURE.LESSON_RATING, stage: MEMBER_STAGE.RATING_SUBMIT,
        errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: view.code,
      });
      if (view.hide) {
        setPhase("hidden");
        onSeen?.(lessonId);
      } else {
        /* 고른 별은 그대로 둔다 (§5) -- [보내기] 를 다시 누르면 된다. */
        setFailure(view);
        setPhase("ready");
      }
    } finally {
      sending.current = false;
    }
  };

  const later = () => {
    setPhase("hidden");
    onSeen?.(lessonId);
  };

  if (phase === "loading" || phase === "hidden") return null;

  if (phase === "done") {
    return (
      <section className="card ratecard app-motion-feedback" role="status" data-lesson-rating="done">
        <p className="ratecap">{RATING_COPY.CAPTION}</p>
        <p className="ratetitle">{RATING_COPY.THANKS}</p>
        <p className="muted" style={{ fontSize: TYPE.caption }}>{RATING_COPY.THANKS_NOTE}</p>
      </section>
    );
  }

  return (
    <section className="card ratecard" aria-label={RATING_COPY.TITLE} data-lesson-rating="ready">
      <div className="ratehead">
        <p className="ratecap">{RATING_COPY.CAPTION}</p>
        <span className="ratesec">{RATING_COPY.SECONDS}</span>
      </div>
      <p className="ratetitle">{RATING_COPY.TITLE}</p>
      <p className="muted rateprivacy" style={{ fontSize: TYPE.caption }}>{RATING_COPY.PRIVACY}</p>

      {RATING_ITEMS.map((item, index) => (
        <fieldset key={item.id} className="rateitem">
          <legend className="rateq">{`${"①②③④⑤⑥⑦⑧⑨"[index] || `${index + 1}.`} ${item.question}`}</legend>
          {item.id === "body" ? <p className="rating-context">몸 컨디션을 알려주세요. 수업 만족도와 나누어 참고해요.</p> : null}
          <div className="stars" role="radiogroup" aria-label={item.question}>
            {STARS.map((value) => (
              <button key={value} type="button" role="radio" aria-checked={scores[item.id] === value}
                aria-label={`${value}점`} disabled={phase === "sending"}
                className={`star${Number(scores[item.id]) >= value ? " on" : ""}`}
                onClick={() => setScores((current) => ({ ...current, [item.id]: value }))}>
                <Star filled={Number(scores[item.id]) >= value} />
                <span className={`starnum num${scores[item.id] === value ? " picked" : ""}`}>{value}</span>
              </button>
            ))}
          </div>
          <p className="muted ratescale" style={{ fontSize: TYPE.caption }}>
            {`${SCORE_RANGE.min} = ${item.low} · ${SCORE_RANGE.max} = ${item.high}`}
          </p>
        </fieldset>
      ))}

      {failure ? <p className="blocked">{failure.message}</p> : null}
      <button type="button" className="btn primary mt" disabled={!complete || phase === "sending"} onClick={submit}>
        {phase === "sending" ? "보내는 중…" : RATING_COPY.SUBMIT}
      </button>
      <button type="button" className="btn mt" disabled={phase === "sending"} onClick={later}>{RATING_COPY.LATER}</button>
    </section>
  );
}
