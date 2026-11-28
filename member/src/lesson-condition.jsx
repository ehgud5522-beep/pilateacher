/**
 * 수업 상세의 "오늘 내 몸 상태 전하기" (2026-11-28 대표). 판정은 functions/shared/lesson-condition.mjs.
 *
 * 열리면 서버에 지금 남긴 것과 동의 여부를 묻는다(status). 버튼으로 고르고 [선생님께 전하기].
 * 처음 한 번은 동의 문구를 보여 주고 체크해야 보낼 수 있다. 수업이 시작되면 고칠 수 없다.
 * 진단에는 부위 · 메모를 남기지 않는다 -- 결과 코드와 기분 종류만.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CONDITION_AREAS, CONDITION_CONSENT_TEXT, CONDITION_MEMO_MAX, CONDITION_MOOD, CONDITION_MOODS, conditionError,
} from "../../functions/shared/lesson-condition.mjs";
import { conditionFailure } from "./condition-copy.js";
import { MEMBER_FEATURE, MEMBER_STAGE, recordDiagnostic } from "./diagnostics.js";
import { Spinner } from "./spinner.jsx";

/* 보낸 뒤 완료 표시를 보여 주는 시간. 그 뒤 창이 부드럽게 닫힌다 (2026-11-28 대표). */
export const CONDITION_CLOSE_DELAY_MS = 1200;

const text = (value) => String(value ?? "").trim();

export function ConditionBox({ lessonId, place, api, offline = false, initial = undefined, onSent = null }) {
  const [phase, setPhase] = useState(initial ? "ready" : offline ? "off" : "loading");
  const [status, setStatus] = useState(initial || null);
  const [draft, setDraft] = useState(() => initial?.condition || { mood: "", areas: [], memo: "" });
  const [agree, setAgree] = useState(false);
  const [message, setMessage] = useState(null);
  const request = { organizationId: text(place?.organizationId), clientId: text(place?.clientId), lessonId: text(lessonId) };

  const load = useCallback(async () => {
    if (offline || !request.lessonId || !api) { setPhase("off"); return; }
    setPhase("loading");
    try {
      const result = await api({ action: "status", ...request });
      setStatus(result);
      if (result?.condition) setDraft(result.condition);
      setPhase("ready");
    } catch (error) {
      const view = conditionFailure(error);
      recordDiagnostic({ feature: MEMBER_FEATURE.LESSON_CONDITION, stage: MEMBER_STAGE.CONDITION_STATUS, errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: view.code });
      /* 남의 수업 · 없는 수업이면 칸을 그리지 않는다. 그 밖은 이유와 코드를 말한다. */
      if (view.kind === "permission") { setPhase("off"); return; }
      setMessage({ failed: true, text: view.message });
      setPhase("failed");
    }
  }, [offline, api, request.organizationId, request.clientId, request.lessonId]);
  useEffect(() => { if (!initial) load(); }, [load, initial]);

  if (phase === "off") return null;
  if (phase === "loading") return <div className="conditionbox"><Spinner label="몸 상태 칸을 준비하는 중" /></div>;
  /* 보냄: 체크가 그려지고 잠깐 뒤 창이 닫힌다. */
  if (phase === "sent") {
    return (
      <div className="conditionbox condition-sent" role="status" data-condition-sent>
        <svg className="condition-check" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="19" fill="none" stroke="currentColor" strokeWidth="3" />
          <path d="M13.5 22.5l6 6 11-12" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="condition-title">선생님께 전했어요</p>
        <p className="muted condition-sub">수업 전에 확인하실 거예요.</p>
      </div>
    );
  }
  if (phase === "failed") {
    return (
      <div className="conditionbox">
        <p className="blocked">{message?.text}</p>
        <button type="button" className="btn mt" onClick={load}>다시 시도</button>
      </div>
    );
  }

  const editable = status?.editable === true;
  const consented = status?.consented === true;
  const refused = conditionError(draft);
  const pickMood = (mood) => setDraft((value) => ({ ...value, mood, areas: mood === CONDITION_MOOD.DISCOMFORT ? value.areas : [] }));
  const toggleArea = (key) => setDraft((value) => ({ ...value, areas: value.areas.includes(key) ? value.areas.filter((item) => item !== key) : [...value.areas, key] }));
  const send = async () => {
    setPhase("sending");
    setMessage(null);
    try {
      const result = await api({ action: "save", ...request, condition: draft, consent: consented || agree });
      recordDiagnostic({ feature: MEMBER_FEATURE.LESSON_CONDITION, stage: MEMBER_STAGE.DONE, message: `${text(result?.mood)}:${result?.notified ? "notified" : "quiet"}` });
      setStatus((value) => ({ ...(value || {}), consented: true, condition: draft }));
      setMessage(null);
      setPhase("sent");
      if (typeof onSent === "function") globalThis.setTimeout(onSent, CONDITION_CLOSE_DELAY_MS);
    } catch (error) {
      const view = conditionFailure(error);
      recordDiagnostic({ feature: MEMBER_FEATURE.LESSON_CONDITION, stage: MEMBER_STAGE.CONDITION_SAVE, errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: view.code });
      setMessage({ failed: true, text: view.message });
      if (view.code === "lesson_started") setStatus((value) => ({ ...(value || {}), editable: false }));
      setPhase("ready");
    }
  };

  return (
    <div className="conditionbox" data-condition-box>
      <p className="condition-title">오늘 내 몸 상태 전하기</p>
      <p className="muted condition-sub">선생님이 수업 전에 미리 보고 준비해요.</p>
      <div className="condition-moods" role="radiogroup" aria-label="오늘 몸 상태">
        {CONDITION_MOODS.map((mood) => (
          <button key={mood.key} type="button" role="radio" aria-checked={draft.mood === mood.key} data-condition-mood={mood.key}
            className={draft.mood === mood.key ? "on" : ""} disabled={!editable || phase === "sending"} onClick={() => pickMood(mood.key)}>
            <span aria-hidden="true">{mood.emoji}</span> {mood.label}
          </button>
        ))}
      </div>
      {draft.mood === CONDITION_MOOD.DISCOMFORT ? (
        <div className="condition-areas" aria-label="불편한 곳">
          {CONDITION_AREAS.map((area) => (
            <button key={area.key} type="button" aria-pressed={draft.areas.includes(area.key)} data-condition-area={area.key}
              className={draft.areas.includes(area.key) ? "on" : ""} disabled={!editable || phase === "sending"} onClick={() => toggleArea(area.key)}>
              {area.label}
            </button>
          ))}
        </div>
      ) : null}
      {draft.mood ? (
        <input className="condition-memo" value={draft.memo} maxLength={CONDITION_MEMO_MAX} disabled={!editable || phase === "sending"}
          placeholder="더 알리고 싶은 것 (적지 않아도 돼요)" onChange={(event) => setDraft((value) => ({ ...value, memo: event.target.value }))} />
      ) : null}
      {!consented && editable ? (
        <label className="condition-consent" data-condition-consent>
          <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} />
          <span>{CONDITION_CONSENT_TEXT.map((line) => <span key={line} className="consent-line">{line}</span>)}<b>위 내용에 동의하고 전할게요</b></span>
        </label>
      ) : null}
      {editable ? (
        <button type="button" className="btn primary mt" data-condition-send disabled={phase === "sending" || Boolean(refused) || (!consented && !agree)} onClick={send}>
          {phase === "sending" ? <Spinner inline label="전하는 중" /> : status?.condition ? "고쳐서 다시 전하기" : "선생님께 전하기"}
        </button>
      ) : <p className="muted mt">수업이 시작돼서 더 고칠 수 없어요.</p>}
      {message ? <p className={message.failed ? "blocked" : "condition-done"} role="status">{message.text}</p> : null}
    </div>
  );
}
