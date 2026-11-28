/**
 * 2026-11-28 대표 요청 둘.
 *
 * 1. 공지 팝업 -- 센터가 띄운 글 한 장(이미지 · 제목 · 내용). [일주일 동안 안 보기] · [닫기].
 *    판정(띄울지 · 안 보기 기억)은 functions/shared/member-notice.mjs.
 * 2. 담당 강사에게 요청 -- [피드백 요청] · [비포애프터 요청] 작은 버튼. 서버가 담당 강사 알림함에 한 건.
 */
import { useRef, useState } from "react";
import { Spinner } from "./spinner.jsx";
import { REQUEST_LABEL, MEMBER_REQUEST_KIND, requestDone, requestFailure } from "./request-copy.js";
import { MEMBER_FEATURE, MEMBER_STAGE, recordDiagnostic } from "./diagnostics.js";

const text = (value) => String(value ?? "").trim();
const CLOSE_MS = 220;

/** 공지 팝업. 닫힐 때도 부드럽게 -- 사라지는 동안(data-closing) 그린 뒤 onClose. */
export function MemberNoticePopup({ notice, onClose, onSnooze }) {
  const [closing, setClosing] = useState(false);
  const leave = (after) => {
    if (closing) return;
    setClosing(true);
    globalThis.setTimeout(after, CLOSE_MS);
  };
  const title = text(notice?.title);
  const body = String(notice?.body ?? "").trim();
  const image = text(notice?.image);
  return (
    <div className="noticewrap" role="dialog" aria-modal="true" aria-label={title || "공지"} data-closing={closing || undefined}
      onClick={(event) => { if (event.target === event.currentTarget) leave(onClose); }}>
      <div className="noticecard" data-member-notice>
        {image ? <img className="notice-image" src={image} alt={title ? `${title} 이미지` : "공지 이미지"} /> : null}
        {title || body ? (
          <div className="notice-text">
            {title ? <p className="notice-title">{title}</p> : null}
            {body ? <p className="notice-body">{body}</p> : null}
          </div>
        ) : null}
        <div className="notice-actions">
          <button type="button" data-notice-snooze onClick={() => leave(onSnooze)}>일주일 동안 안 보기</button>
          <button type="button" data-notice-close className="close" onClick={() => leave(onClose)}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/** [피드백 요청] · [비포애프터 요청]. api 가 없으면(오프라인 사본) 그리지 않는다. */
export function MemberRequestRow({ place, api, beforeAfter = true }) {
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const sending = useRef(false);
  if (!api || !place?.organizationId || !place?.clientId) return null;
  const kinds = [MEMBER_REQUEST_KIND.FEEDBACK, ...(beforeAfter ? [MEMBER_REQUEST_KIND.BEFORE_AFTER] : [])];
  const send = async (kind) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(kind);
    try {
      const done = await api({ organizationId: place.organizationId, clientId: place.clientId, kind });
      recordDiagnostic({ feature: MEMBER_FEATURE.MEMBER_REQUEST, stage: MEMBER_STAGE.DONE, message: `${kind}:${text(done?.status)}` });
      setResult({ kind, ...requestDone(done) });
    } catch (error) {
      const view = requestFailure(error);
      recordDiagnostic({
        feature: MEMBER_FEATURE.MEMBER_REQUEST, stage: MEMBER_STAGE.REQUEST_CALL,
        errorDomain: "functions_callable", errorCode: text(error?.code) || "unknown", message: `${kind}:${view.code}`,
      });
      setResult({ kind, failed: true, ...view });
    } finally {
      sending.current = false;
      setBusy("");
    }
  };
  return (
    <section className="request-row" data-member-request>
      <p className="request-label">선생님께</p>
      <div className="request-buttons">
        {kinds.map((kind) => (
          <button key={kind} type="button" data-request-kind={kind} disabled={Boolean(busy)} onClick={() => send(kind)}>
            {busy === kind ? <Spinner inline size={16} label="보내는 중" /> : REQUEST_LABEL[kind]}
          </button>
        ))}
      </div>
      {result ? <p className={`request-result${result.failed ? " failed" : ""}`} role="status">{result.message}</p> : null}
    </section>
  );
}
