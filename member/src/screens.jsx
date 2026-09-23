/**
 * 화면 넷 — 홈 · 회원권 · 수업 · 여정.
 *
 * 넷 다 **투영 문서 하나**를 그린다. 질의도, 다른 컬렉션도 없다 (member-data.js).
 *
 * ── 문구 ──
 * 격려 3 : 지식 1. 재등록을 권하지 않는다 -- 판매는 센터가 한다. 잔여가 적으면
 * 사실만 말한다. **가짜 데이터를 그리지 않는다**: 빈 상태는 빈 상태로 둔다.
 *
 * 내부 표현을 쓰지 않는다. "1차" 는 우리가 세는 방식이고 회원은 그렇게 세지
 * 않는다 -- "3번째 회원권" 으로 푼다. 분수도 쓰지 않는다: "0/1회" 는 읽는
 * 사람에게 남은 것을 말해 주지 않는다.
 */

import { JOURNEY_PRIOR_NOTE, hasJourney } from "../../functions/shared/pass-journey.mjs";
import { TYPE } from "../../src/features/ui/type-scale.js";

const text = (value) => String(value ?? "").trim();
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);

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

const dayLabel = (value) => {
  const at = toDate(value);
  return at ? `${at.getMonth() + 1}월 ${at.getDate()}일` : "";
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekdayLabel = (value) => {
  const at = toDate(value);
  return at ? WEEKDAYS[at.getDay()] : "";
};

/** 오늘로부터 며칠 남았나. 지났으면 음수. */
export function daysUntil(value, now = new Date()) {
  const at = toDate(value);
  if (!at) return null;
  return Math.ceil((at.getTime() - now.getTime()) / 86400000);
}

/**
 * 회원권 한 장을 뭐라고 부를 것인가.
 *
 * 계약할 때 들은 이름이 먼저다 (`displayName`). 투영이 상품 문서에서 가져오고,
 * 이관분은 productId 자체가 이름이다 -- 그 판단은 서버가 한다
 * (functions/src/member-view.js 의 passDisplayName).
 *
 * 이름이 없으면 회차와 듀엣 여부로 부른다. 상품 문서가 지워졌거나 아주 옛
 * 회원권이 그렇고, 그때 빈 칸을 두면 회원은 무슨 회원권인지 알 수 없다.
 */
export function passName(pass) {
  const given = text(pass?.displayName);
  if (given) return given;
  const total = count(pass?.totalSessions) + count(pass?.serviceSessions);
  const kind = pass?.isDuet ? "듀엣 회원권" : "회원권";
  return total ? `${total}회 ${kind}` : kind;
}

/** 차수를 사람 말로. */
export const roundLabel = (round) => (count(round) > 1 ? `${count(round)}번째 회원권` : "첫 회원권");

/** 지금 쓸 수 있는 회원권인가. 화면이 "사용 중" 과 "지난" 을 이것으로 가른다. */
export function isUsable(pass, now = new Date()) {
  if (text(pass?.status) !== "active") return false;
  if (count(pass?.remainingCount) <= 0) return false;
  const expiresAt = toDate(pass?.expiresAt);
  return !expiresAt || expiresAt.getTime() >= now.getTime();
}

const Card = ({ children, tone, className = "" }) => (
  <section className={`card${tone ? ` ${tone}` : ""}${className ? ` ${className}` : ""}`}>
    {children}
  </section>
);

/** 남은 비율 링. 전체 중 얼마가 남았는지를 숫자 옆에 얇게. */
function Ring({ remaining, total }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const shown = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  return (
    <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--ring)" strokeWidth="2" />
      <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--rose)" strokeWidth="2"
        strokeLinecap="round" strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)} transform="rotate(-90 60 60)" />
    </svg>
  );
}

/* ── 홈 ──────────────────────────────────────────────────────────────── */

export function Home({ view, now = new Date() }) {
  const remaining = count(view?.remainingTotal);
  const left = daysUntil(view?.nextExpiresAt, now);
  const ended = text(view?.clientStatus) === "ended";
  const passes = Array.isArray(view?.passes) ? view.passes : [];
  const using = passes.filter((pass) => isUsable(pass, now));
  const front = using[0] || passes[0] || null;
  const total = front ? count(front.totalSessions) + count(front.serviceSessions) : 0;
  const used = count(view?.journey?.usedTotal);
  const history = Array.isArray(view?.history) ? view.history : [];

  /* 임박은 말하되 재등록은 권하지 않는다. 사실만 놓으면 회원이 스스로 센터에
     묻는다 -- 앱이 파는 자리가 되면 열어 보는 이유가 달라진다. */
  const note = ended
    ? "이용이 종료된 회원권이에요. 지난 기록은 그대로 보실 수 있어요."
    : remaining === 0 ? "남은 횟수가 없어요. 센터에 문의해 주세요."
      : left !== null && left <= 14 ? `만료까지 ${left}일 남았어요.`
        : remaining <= 3 ? "곧 마지막 회차예요." : "";

  return (
    <div className="stack">
      <header className="greet">
        <p className="hello serif">{text(view?.name)}님, 오늘도 반가워요</p>
        {view?.locationName ? <p className="place">{view.locationName}</p> : null}
      </header>

      <section className="membership">
        {total > 0 ? <Ring remaining={remaining} total={total} /> : null}
        <p className="cap">남은 횟수</p>
        <p className="big serif num">{remaining}<span>회</span></p>
        {front ? <p className="name">{passName(front)}</p> : null}
        {view?.nextExpiresAt ? <p className="until num">{dateLabel(view.nextExpiresAt)}까지</p> : null}
      </section>

      <Card>
        <p className="muted" style={{ fontSize: TYPE.caption, letterSpacing: ".06em" }}>최근 수업</p>
        {history.length ? (
          <div className="rowcard mt">
            <span className="serif" style={{ fontSize: TYPE.title }}>{dayLabel(history[0].occurredAt)}</span>
            <span className="muted" style={{ fontSize: TYPE.caption }}>{text(history[0].instructorName)}</span>
          </div>
        ) : (
          <p className="muted mt" style={{ fontSize: TYPE.body }}>첫 수업을 기다리고 있어요</p>
        )}
      </Card>

      {/* 화면 아래 반이 비지 않게. 지어낸 값이 아니라 투영의 여정이다.
          0번은 그리지 않는다 -- 막 시작한 사람에게 "0번 함께했어요" 는
          격려가 아니라 셈이다. */}
      {used > 0 ? (
        <Card className="together">
          <p className="muted" style={{ fontSize: TYPE.caption, letterSpacing: ".06em" }}>지금까지</p>
          <p className="big serif"><em className="num">{used}번</em> 함께했어요</p>
        </Card>
      ) : null}

      {note ? (
        <Card tone="quietcard">
          <p className="note" style={{ fontSize: TYPE.caption }}>{note}</p>
        </Card>
      ) : null}
    </div>
  );
}

/* ── 회원권 ──────────────────────────────────────────────────────────── */

export function Passes({ view, now = new Date() }) {
  const passes = Array.isArray(view?.passes) ? view.passes : [];
  const using = passes.filter((pass) => isUsable(pass, now));
  /* "대기(미리 구매)" 는 두지 않는다. 이 데이터에 그런 상태가 없다 --
     회원권은 발급되는 순간부터 쓸 수 있다. 없는 칸을 그려 두면 아무도 보지
     못하고, 언젠가 보이면 그때는 틀린 화면이다. */
  const past = passes.filter((pass) => !isUsable(pass, now));

  if (passes.length === 0) {
    return (
      <div className="stack">
        <h1 className="title serif">회원권</h1>
        <Card>
          <p style={{ fontSize: TYPE.body }}>지금 쓸 수 있는 회원권이 없어요.</p>
          <p className="muted mt" style={{ fontSize: TYPE.caption }}>센터에 문의해 주세요.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1 className="title serif">회원권</h1>
      {[["사용 중", using, false], ["지난 회원권", past, true]].map(([label, group, dim]) => (
        group.length ? (
          <div key={label}>
            <p className="group">{label}</p>
            <div className="stack">
              {group.map((pass) => (
                <Card key={text(pass.passId)} tone={dim ? "quietcard" : ""} className="pass">
                  <div className="rowcard">
                    <p className="name">{passName(pass)}</p>
                    {dim ? null : (
                      <p className="rem serif num">{count(pass.remainingCount)}<span>회</span></p>
                    )}
                  </div>
                  <p className="meta">{roundLabel(pass.purchaseRound)}</p>
                  <p className="meta">
                    {count(pass.remainingCount) > 0
                      ? <>{count(pass.totalSessions) + count(pass.serviceSessions)}회 중 <b>{count(pass.remainingCount)}회</b> 남았어요</>
                      : `${count(pass.totalSessions) + count(pass.serviceSessions)}회를 모두 사용했어요`}
                  </p>
                  {pass.expiresAt ? <p className="meta num">{dateLabel(pass.expiresAt)}까지</p> : null}
                  {/* 각자 30회로 오해하면 계약 자체가 틀어진다. 반드시 적는다. */}
                  {pass.isDuet ? (
                    <p className="duet">
                      {pass.partnerName ? `${pass.partnerName}님과 ` : "두 분이 "}함께 쓰는 회원권이에요
                      <br /><em>수업 한 번에 1회 차감</em>
                    </p>
                  ) : null}
                </Card>
              ))}
            </div>
          </div>
        ) : null
      ))}
    </div>
  );
}

/* ── 수업 ────────────────────────────────────────────────────────────── */

const HISTORY_LABEL = {
  deduct: "수업",
  /* 잘못 차감했다 되돌린 사실은 회원의 것이다. 숨기면 회차가 늘어난 이유를
     아무도 설명하지 못한다. */
  correction: "차감 취소",
  transfer: "담당 강사 변경",
};

export function History({ view }) {
  const rows = Array.isArray(view?.history) ? view.history : [];
  const used = count(view?.journey?.usedTotal);

  if (rows.length === 0) {
    return (
      <div>
        <h1 className="title serif">수업</h1>
        <div className="empty">
          <p className="big serif">첫 수업을<br />기다리고 있어요</p>
          <p className="sub">수업이 끝나면 여기에<br />하나씩 쌓입니다</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="title serif">수업</h1>
      {used ? <p className="count num">모두 {used}번의 수업</p> : null}
      <ol className="timeline">
        {rows.map((row, index) => (
          <li key={`${text(row.occurredAt)}-${index}`}>
            <span className="dot" />
            <div className="body">
              <p className="when serif num">
                {dayLabel(row.occurredAt)}<em>{weekdayLabel(row.occurredAt)}</em>
              </p>
              <p className="who">
                {text(row.instructorName)}
                {text(row.type) !== "deduct" ? ` · ${HISTORY_LABEL[text(row.type)] || text(row.type)}` : ""}
              </p>
            </div>
            <p className="one num">{text(row.type) === "correction" ? "+1회" : "1회"}</p>
          </li>
        ))}
      </ol>
      {used > rows.length ? (
        <p className="more num">{used - rows.length}번의 수업이 더 있어요</p>
      ) : null}
    </div>
  );
}

/* ── 여정 ────────────────────────────────────────────────────────────── */

/** 함께한 횟수의 이정표. 회원이 스스로 세는 단위다. */
export const MILESTONES = Object.freeze([10, 30, 50, 100]);

export function Journey({ view }) {
  const journey = view?.journey || null;
  /* 모양은 buildPassJourney 가 정한다 (functions/shared/pass-journey.mjs).
     여기서 다시 세지 않는다 -- 두 곳에서 세면 회원 화면과 강사 화면이 다른
     숫자를 말하는 날이 온다. */
  const segments = Array.isArray(journey?.segments) ? journey.segments : [];
  if (!hasJourney(journey)) {
    return (
      <div>
        <h1 className="title serif">여정</h1>
        <div className="empty">
          <p className="big serif">여정은 수업이<br />쌓이면 보여 드릴게요</p>
        </div>
      </div>
    );
  }

  const used = count(journey.usedTotal);
  const next = MILESTONES.find((mark) => mark > used) || null;

  return (
    <div className="stack">
      <h1 className="title serif">여정</h1>
      <section className="sum">
        <p className="cap">지금까지</p>
        <p className="big serif num">{used}<span>번</span></p>
        <p className="cap">함께했어요</p>
      </section>

      <div className="marks">
        {MILESTONES.map((mark) => (
          <div key={mark} className={`mark${used >= mark ? " done" : ""}`}>
            <span className="bead" />
            <p className="num">{mark}회</p>
          </div>
        ))}
      </div>
      {next ? <p className="next num">{next}회까지 {next - used}번 남았어요</p> : null}

      <Card>
        <ul>
          {segments.map((segment, index) => (
            <li key={`${text(segment.kind)}-${text(segment.passId)}-${index}`}
              className="rowcard" style={{ paddingTop: index ? 10 : 0 }}>
              <span style={{ fontSize: TYPE.caption }}>
                {/* 앱에 옮기기 전의 수업도 회원이 한 수업이다. 빼면 "내가 더
                    했는데" 가 되고, 그 기준이 무엇인지도 함께 말해야 한다. */}
                {segment.kind === "prior" ? JOURNEY_PRIOR_NOTE : roundLabel(segment.round)}
              </span>
              <span className="muted num" style={{ fontSize: TYPE.caption }}>
                {segment.total}회 중 {segment.used}회
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* 격려 3 : 지식 1. 넷 중 하나만 지식이다. */}
      <Card className="know">
        <p className="cap">알아 두면 좋아요</p>
        <p>코어는 한 번에 크게 쓰는 것보다 매일 조금씩 쌓일 때 더 오래 남습니다.</p>
      </Card>
    </div>
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
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>잔여 횟수는 센터에 문의해 주세요.</p>
    </Card>
  );
}

/** 연결 결과 안내 (link-result.js 가 문구를 정한다). */
export function LinkNotice({ screen, onRetry }) {
  return (
    <Card tone="warn">
      <p className="serif" style={{ fontSize: TYPE.title }}>{screen.title}</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption, lineHeight: 1.7 }}>{screen.body}</p>
      {screen.retry && onRetry
        ? <button type="button" className="btn mt" onClick={onRetry}>다시 시도</button>
        : null}
    </Card>
  );
}
