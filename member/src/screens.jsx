/**
 * 화면 넷 — 홈 · 회원권 · 수업 이력 · 여정.
 *
 * 넷 다 **투영 문서 하나**를 그린다. 질의도, 다른 컬렉션도 없다 (member-data.js).
 *
 * ── 문구 ──
 * 격려 3 : 지식 1. 재등록을 권하지 않는다 -- 판매는 센터가 한다. 잔여가 적으면
 * 사실만 말한다. 그리고 **가짜 데이터를 그리지 않는다**: 빈 상태는 빈 상태로
 * 둔다. 예시 회원권을 그려 두면 회원은 그것을 자기 것으로 읽는다.
 */

import { JOURNEY_PRIOR_NOTE, hasJourney } from "../../functions/shared/pass-journey.mjs";
import { TYPE } from "../../src/features/ui/type-scale.js";

const text = (value) => String(value ?? "").trim();

/** Firestore Timestamp · Date · 문자열을 하나로. */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return Number.isFinite(converted?.getTime?.()) ? converted : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export const dateLabel = (value) => {
  const at = toDate(value);
  return at ? `${at.getFullYear()}. ${at.getMonth() + 1}. ${at.getDate()}.` : "";
};

const shortDate = (value) => {
  const at = toDate(value);
  return at ? `${at.getMonth() + 1}/${at.getDate()}` : "";
};

/** 오늘로부터 며칠 남았나. 지났으면 음수. */
export function daysUntil(value, now = new Date()) {
  const at = toDate(value);
  if (!at) return null;
  return Math.ceil((at.getTime() - now.getTime()) / 86400000);
}

const Card = ({ children, tone }) => (
  <section className={`card${tone ? ` card-${tone}` : ""}`}>{children}</section>
);

/* ── 홈 ──────────────────────────────────────────────────────────────── */

export function Home({ view, now = new Date() }) {
  const remaining = Number(view?.remainingTotal) || 0;
  const left = daysUntil(view?.nextExpiresAt, now);
  const ending = text(view?.clientStatus) === "ended";

  /* 임박은 말하되 재등록은 권하지 않는다. 사실만 놓으면 회원이 스스로 센터에
     묻는다 -- 앱이 파는 자리가 되면 열어 보는 이유가 달라진다. */
  const note = ending
    ? "이용이 종료된 회원권이에요. 지난 기록은 그대로 보실 수 있어요."
    : remaining === 0 ? "남은 횟수가 없어요. 센터에 문의해 주세요."
      : left !== null && left <= 14 ? `만료까지 ${left}일 남았어요.`
        : remaining <= 3 ? "곧 마지막 회차예요." : "";

  return (
    <div className="stack">
      <Card>
        <p className="muted" style={{ fontSize: TYPE.caption }}>
          {text(view?.name)}님{view?.locationName ? ` · ${view.locationName}` : ""}
        </p>
        <p className="hero" style={{ fontSize: TYPE.hero }}>
          {remaining}<span style={{ fontSize: TYPE.title }}>회</span>
        </p>
        <p className="muted" style={{ fontSize: TYPE.caption }}>남은 횟수</p>
        {view?.nextExpiresAt ? (
          <p className="muted mt" style={{ fontSize: TYPE.caption }}>
            {dateLabel(view.nextExpiresAt)}까지
          </p>
        ) : null}
        {note ? <p className="note mt" style={{ fontSize: TYPE.caption }}>{note}</p> : null}
      </Card>
    </div>
  );
}

/* ── 회원권 ──────────────────────────────────────────────────────────── */

export function Passes({ view }) {
  const passes = Array.isArray(view?.passes) ? view.passes : [];
  if (passes.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: TYPE.body }}>지금 쓸 수 있는 회원권이 없어요.</p>
        <p className="muted mt" style={{ fontSize: TYPE.caption }}>
          센터에 문의해 주세요.
        </p>
      </Card>
    );
  }
  return (
    <div className="stack">
      {passes.map((pass) => {
        const total = (Number(pass.totalSessions) || 0) + (Number(pass.serviceSessions) || 0);
        return (
          <Card key={text(pass.passId)}>
            <div className="row">
              <p style={{ fontSize: TYPE.body, fontWeight: 700 }}>
                {pass.purchaseRound ? `${pass.purchaseRound}차 ` : ""}{total}회권
              </p>
              <p className="num" style={{ fontSize: TYPE.title, fontWeight: 700 }}>
                {Number(pass.remainingCount) || 0}회
              </p>
            </div>
            <p className="muted mt" style={{ fontSize: TYPE.caption }}>
              {pass.expiresAt ? `${dateLabel(pass.expiresAt)}까지` : "만료일 없음"}
            </p>
            {/* 각자 30회로 오해하면 계약 자체가 틀어진다. 반드시 적는다. */}
            {pass.isDuet ? (
              <p className="note mt" style={{ fontSize: TYPE.caption }}>
                {pass.partnerName ? `${pass.partnerName}님과 ` : "두 분이 "}
                함께 쓰는 회원권이에요 · 수업 한 번에 1회 차감
              </p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

/* ── 수업 이력 ───────────────────────────────────────────────────────── */

const HISTORY_LABEL = {
  deduct: "수업",
  /* 잘못 차감했다 되돌린 사실은 회원의 것이다. 숨기면 회차가 늘어난 이유를
     아무도 설명하지 못한다. */
  correction: "차감 취소",
  transfer: "담당 강사 변경",
};

export function History({ view }) {
  const rows = Array.isArray(view?.history) ? view.history : [];
  if (rows.length === 0) {
    return (
      <Card>
        <p style={{ fontSize: TYPE.body }}>첫 수업을 기다리고 있어요.</p>
        <p className="muted mt" style={{ fontSize: TYPE.caption }}>
          수업이 끝나면 여기에 하나씩 쌓입니다.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <ul className="list">
        {rows.map((row, index) => (
          <li key={`${text(row.occurredAt)}-${index}`} className="row">
            <span style={{ fontSize: TYPE.body }}>
              {HISTORY_LABEL[text(row.type)] || text(row.type)}
              {row.instructorName ? ` · ${row.instructorName}` : ""}
            </span>
            <span className="muted num" style={{ fontSize: TYPE.caption }}>
              {shortDate(row.occurredAt)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── 여정 ────────────────────────────────────────────────────────────── */

export function Journey({ view }) {
  const journey = view?.journey || null;
  /* 모양은 buildPassJourney 가 정한다 (functions/shared/pass-journey.mjs).
     여기서 다시 세지 않는다 -- 두 곳에서 세면 회원 화면과 강사 화면이 다른
     숫자를 말하는 날이 온다. */
  const segments = Array.isArray(journey?.segments) ? journey.segments : [];
  if (!hasJourney(journey)) {
    return (
      <Card>
        <p style={{ fontSize: TYPE.body }}>여정은 수업이 쌓이면 보여 드릴게요.</p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="muted" style={{ fontSize: TYPE.caption }}>지금까지</p>
      <p className="mt" style={{ fontSize: TYPE.display, fontWeight: 700 }}>
        {Number(journey.usedTotal) || 0}회
      </p>
      <ul className="list mt">
        {segments.map((segment, index) => (
          <li key={`${text(segment.kind)}-${text(segment.passId)}-${index}`} className="row">
            <span style={{ fontSize: TYPE.caption }}>
              {/* 앱에 옮기기 전의 수업도 회원이 한 수업이다. 빼면 "내가 더
                  했는데" 가 되고, 그 기준이 무엇인지도 함께 말해야 한다. */}
              {segment.kind === "prior" ? JOURNEY_PRIOR_NOTE : `${segment.round}차`}
            </span>
            <span className="muted num" style={{ fontSize: TYPE.caption }}>
              {segment.used}/{segment.total}회
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── 상태 화면 ───────────────────────────────────────────────────────── */

export function Loading() {
  return <Card><p className="muted" style={{ fontSize: TYPE.body }}>잠시만요…</p></Card>;
}

/** 못 읽은 것. 코드를 함께 보여준다 -- 센터가 물어볼 수 있어야 한다. */
export function LoadFailed({ code, onRetry }) {
  return (
    <Card tone="warn">
      <p style={{ fontSize: TYPE.body }}>지금 불러오지 못했어요.</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        잠시 뒤 다시 열어 주세요. (코드 {text(code) || "unknown"})
      </p>
      {onRetry ? <button type="button" className="btn mt" onClick={onRetry}>다시 시도</button> : null}
    </Card>
  );
}

/**
 * 연결은 됐는데 투영이 아직 없다.
 *
 * 연결 직후 트리거가 도는 몇 초가 여기다. "조회 실패" 로 말하면 정상 상태를
 * 고장으로 말하는 것이 된다.
 */
export function Preparing({ onRetry }) {
  return (
    <Card>
      <p style={{ fontSize: TYPE.body }}>회원권 정보를 준비하고 있어요.</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>조금 뒤 다시 열어 주세요.</p>
      {onRetry ? <button type="button" className="btn mt" onClick={onRetry}>새로고침</button> : null}
    </Card>
  );
}

/** 이관이 아직 안 된 지점. 숫자를 지어내지 않는다. */
export function NotMigrated() {
  return (
    <Card>
      <p style={{ fontSize: TYPE.body }}>아직 이 지점은 준비 중이에요.</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        잔여 횟수는 센터에 문의해 주세요.
      </p>
    </Card>
  );
}

/** 연결 결과 안내 (link-result.js 가 문구를 정한다). */
export function LinkNotice({ screen, onRetry }) {
  return (
    <Card tone="warn">
      <p style={{ fontSize: TYPE.body, fontWeight: 700 }}>{screen.title}</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>{screen.body}</p>
      {screen.retry && onRetry
        ? <button type="button" className="btn mt" onClick={onRetry}>다시 시도</button>
        : null}
    </Card>
  );
}
