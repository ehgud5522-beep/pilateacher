/**
 * 화면 넷 — 홈 · 회원권 · 수업 · 더보기.
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

import { useMemo, useState } from "react";
import { TYPE } from "../../src/features/ui/type-scale.js";

/**
 * 의견을 받는 곳. 링크 하나다.
 *
 * 앱 안에 입력 폼을 두지 않는다 -- 폼을 두면 저장할 곳, 읽을 사람, 지울 규칙이
 * 따라오고, 그 셋이 정해지기 전에 회원의 글부터 쌓인다. 오픈채팅은 이미 익명을
 * 지원하고 대표가 이미 쓰는 자리다.
 *
 * 링크에 회원 정보를 붙이지 않는다. 이름도 번호도 회원권도 붙이지 않는다 --
 * 익명으로 보낼 수 있다고 적어 두고 주소로 누구인지 흘리면 그것은 거짓말이다.
 */
export const FEEDBACK_KAKAO_URL = "https://open.kakao.com/o/sBfqlBTh";

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
  /* 누적 횟수는 더보기 탭 맨 위 한 줄이 말한다. 홈에도 두면 같은 숫자가 두 번
     나오고, 홈의 주인공은 남은 횟수여야 한다. */
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
              {/* 강사가 이 수업에 대해 회원에게 남긴 말. 수업기록 원문이 아니라
                  회원을 향해 따로 적은 문장이고, 없으면 줄 자체가 없다 --
                  "메시지 없음" 을 그리면 빈 줄이 기록처럼 쌓인다. */}
              {text(row.memberNote) ? <p className="note">{text(row.memberNote)}</p> : null}
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

/* ── 더보기 ──────────────────────────────────────────────────────────── */

/**
 * 달력과 빈도, 그리고 의견 보내기.
 *
 * ── 왜 이정표를 걷어냈나 ──
 * 10·30·50·100 이라는 사다리는 **끝이 있었다.** 100회를 넘긴 회원은 다 채운
 * 화면을 보게 되고, 그것은 가장 오래 온 사람에게 "끝났다" 고 말하는 화면이다.
 * 끝없이 늘리는 것으로 고쳐 봤지만, 애초에 회원이 알고 싶은 것은 누적이
 * 아니라 **요즘 얼마나 나오고 있는가** 였다.
 *
 * ── 달력이 말하는 것 ──
 * 사람은 "지난달보다 줄었다" 를 문장보다 모양으로 먼저 안다. 그래서 막대를
 * 둔다. 아무도 혼내지 않는데 본인이 안다.
 *
 * 그리고 끊겼을 때 **0 을 보여주지 않는다.** "이번 주에 한 번 나오면 다시
 * 이어져요" 라고 적는다 -- 혼내면 앱을 안 열고, 할 일을 말해야 온다.
 *
 * ── 서버는 건드리지 않았다 ──
 * 날짜는 이미 투영의 수업 이력에 있다. 여기 있는 것은 전부 그 배열을 세는
 * 순수 계산이고, 그래서 경계값을 테스트로 고정할 수 있다.
 */

/**
 * 투영이 싣고 오는 수업 이력의 최대 건수.
 *
 * 서버의 HISTORY_LIMIT 과 같은 값이어야 한다
 * (functions/src/member-view-triggers.js). 이 숫자가 어긋나면 달력이 "기록
 * 없음" 을 말해야 할 자리에서 조용히 빈 달을 그린다 -- 안 나온 것과 기록이
 * 없는 것은 다르다. 테스트가 두 값을 견준다.
 */
export const HISTORY_KEPT = 100;

/** 달력에서 한 주의 시작은 일요일이다. 한국 달력이 그렇다. */
const WEEK_START = 0;
const DAY = 86400000;

/** 그날 수업이 있었는가를 가리는 이력의 종류. 발급·취소는 수업이 아니다. */
const ATTENDED_TYPE = "deduct";

/** 자정으로 맞춘 날짜. 시각이 섞이면 같은 날이 다른 날이 된다. */
const atMidnight = (value) => {
  const at = toDate(value);
  return at ? new Date(at.getFullYear(), at.getMonth(), at.getDate()) : null;
};

const sameDay = (left, right) => (
  left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate()
);

/**
 * 수업한 날들. 오래된 것부터.
 *
 * 되돌린 차감(correction)은 빼지 못한다 -- 투영의 이력에 lessonId 가 없어
 * 어느 차감을 되돌린 것인지 짝지을 수 없다. 내부 id 를 회원에게 내보내는 것이
 * 더 나쁘다고 보고 그대로 두었다. 되돌린 사실은 수업 탭이 한 줄로 말한다.
 */
export function attendedDates(history) {
  return (Array.isArray(history) ? history : [])
    .filter((row) => text(row?.type) === ATTENDED_TYPE)
    .map((row) => atMidnight(row?.occurredAt))
    .filter(Boolean)
    .sort((left, right) => left - right);
}

/**
 * 한 달 달력의 칸들. 앞쪽 빈 칸까지 포함한다.
 *
 * @returns {Array<{ key: string, day: number, blank: boolean, attended: boolean, today: boolean }>}
 */
export function monthCells(year, month, dates, now = new Date()) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < lead; index += 1) {
    cells.push({ key: `blank-${index}`, day: 0, blank: true, attended: false, today: false });
  }
  for (let day = 1; day <= days; day += 1) {
    const at = new Date(year, month, day);
    cells.push({
      key: `${year}-${month}-${day}`,
      day,
      blank: false,
      attended: dates.some((date) => sameDay(date, at)),
      today: sameDay(at, now),
    });
  }
  return cells;
}

/** 그 달에 몇 번. */
export const countInMonth = (dates, year, month) => dates.filter(
  (date) => date.getFullYear() === year && date.getMonth() === month,
).length;

/**
 * 최근 몇 달의 횟수. 오래된 것이 앞이다.
 *
 * 빈도가 줄고 있으면 여기서 먼저 보인다 -- 사람은 "지난달보다 줄었다" 를
 * 문장보다 모양으로 먼저 안다.
 */
export function monthlyCounts(dates, now = new Date(), months = 6) {
  const rows = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const at = new Date(now.getFullYear(), now.getMonth() - back, 1);
    rows.push({
      year: at.getFullYear(),
      month: at.getMonth(),
      label: `${at.getMonth() + 1}월`,
      count: countInMonth(dates, at.getFullYear(), at.getMonth()),
    });
  }
  return rows;
}

/** 그 날짜가 속한 주의 일요일. */
function weekStart(at) {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  start.setDate(start.getDate() - ((start.getDay() - WEEK_START + 7) % 7));
  return start;
}

/**
 * 몇 주째 쉬지 않고 나왔는가.
 *
 * 이번 주가 아직 비어 있어도 지난주까지로 센다 -- 수요일에 열어 본 사람에게
 * "0주" 라고 말할 이유가 없다. 다만 지난주도 비었으면 그때는 0 이고, 화면은
 * 며칠 지났는지를 대신 말한다.
 */
export function weekStreak(dates, now = new Date()) {
  if (!dates.length) return 0;
  const weeks = new Set(dates.map((date) => weekStart(date).getTime()));
  const thisWeek = weekStart(now).getTime();
  let cursor = weeks.has(thisWeek) ? thisWeek : thisWeek - 7 * DAY;
  if (!weeks.has(cursor)) return 0;
  let count = 0;
  while (weeks.has(cursor)) {
    count += 1;
    cursor -= 7 * DAY;
  }
  return count;
}

/** 마지막 수업으로부터 며칠. 수업이 없으면 null. */
export function daysSinceLast(dates, now = new Date()) {
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - last) / DAY));
}

/**
 * 며칠부터 "쉬었다" 고 말할 것인가.
 *
 * 2주다. 그 아래는 그냥 이 사람의 주기일 수 있다 -- 일주일에 한 번 오는
 * 회원에게 8일 만에 "쉬고 있다" 고 하면 틀린 말이다.
 */
export const AWAY_DAYS = 14;

/**
 * 달력 아래 한 줄. 무엇을 말할지는 상태가 정한다.
 *
 * @returns {{ tone: "steady" | "away" | "none", line: string, hint: string }}
 */
export function rhythmNote(dates, now = new Date()) {
  const away = daysSinceLast(dates, now);
  if (away === null) return { tone: "none", line: "", hint: "" };
  if (away >= AWAY_DAYS) {
    return {
      tone: "away",
      line: `마지막 수업에서 ${away}일 지났어요`,
      /* 끊긴 주 수를 0 으로 보여주지 않는다. 혼내면 앱을 안 열고, 할 일을
         말해야 온다. */
      hint: "이번 주에 한 번 나오면 다시 이어져요",
    };
  }
  const streak = weekStreak(dates, now);
  if (streak >= 2) return { tone: "steady", line: `${streak}주째 쉬지 않고 나오고 있어요`, hint: "" };
  return { tone: "none", line: "", hint: "" };
}

/**
 * 이 달보다 더 과거로 갈 수 있는가, 그리고 그 끝에서 뭐라고 말할 것인가.
 *
 * 기록이 없는 달과 안 나온 달은 다르다. 투영이 최근 100건만 싣고 오므로,
 * 상한에 닿아 있으면 가장 오래된 기록보다 앞은 **모르는 구간**이다. 빈
 * 달력을 그려 두면 회원은 그때 안 나온 것으로 읽는다.
 */
export function historyEdge(dates, history) {
  const capped = (Array.isArray(history) ? history : []).length >= HISTORY_KEPT;
  const oldest = dates[0] || null;
  return { oldest, capped };
}

const MONTH_LABEL = (year, month) => `${year}년 ${month + 1}월`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * @param {{ view: any, now?: Date, monthsBack?: number }} props
 *   monthsBack  처음 보여 줄 달. 0 이 이번 달이다. 화면은 늘 0 으로 열고,
 *               테스트가 과거 달을 그려 보는 데 쓴다 -- "기록은 여기까지"
 *               처럼 끝에서만 나오는 문구는 거기까지 가 있어야 확인된다.
 */
export function More({ view, now = new Date(), monthsBack = 0 }) {
  const [back, setBack] = useState(monthsBack);
  const history = Array.isArray(view?.history) ? view.history : [];
  const dates = useMemo(() => attendedDates(history), [history]);
  const shown = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const cells = useMemo(() => monthCells(year, month, dates, now), [year, month, dates, now]);
  const { oldest, capped } = historyEdge(dates, history);
  const edge = capped && oldest
    && year === oldest.getFullYear() && month === oldest.getMonth();
  /* 가장 오래된 기록보다 더 앞은 볼 것이 없다. 기록이 아예 없으면 이번 달에
     머문다 -- 빈 달을 넘기게 두면 안 나온 것처럼 읽힌다. */
  const earliest = oldest || now;
  const canGoBack = new Date(year, month, 1) > new Date(earliest.getFullYear(), earliest.getMonth(), 1);

  const thisCount = countInMonth(dates, year, month);
  const prev = new Date(year, month - 1, 1);
  const prevCount = countInMonth(dates, prev.getFullYear(), prev.getMonth());
  const note = rhythmNote(dates, now);
  const months = useMemo(() => monthlyCounts(dates, now), [dates, now]);
  const top = Math.max(1, ...months.map((row) => row.count));
  const used = count(view?.journey?.usedTotal);

  return (
    <div className="stack">
      {/* 앱에 옮기기 전의 수업도 회원이 한 수업이다. 날짜가 없어 달력에는
          그리지 못하므로 한 줄로만 남긴다. */}
      {used > 0 ? (
        <p className="total">지금까지 <b className="num">{used}번</b> 함께했어요</p>
      ) : null}

      <Card>
        <div className="calhead">
          <p className="mon serif num">{MONTH_LABEL(year, month)}</p>
          <div className="arrows">
            <button type="button" aria-label="이전 달" disabled={!canGoBack}
              onClick={() => setBack((value) => value + 1)}>‹</button>
            <button type="button" aria-label="다음 달" disabled={back === 0}
              onClick={() => setBack((value) => Math.max(0, value - 1))}>›</button>
          </div>
        </div>
        <div className="dow">{DOW.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="grid">
          {cells.map((cell) => (
            <div key={cell.key}
              className={`day${cell.blank ? " out" : ""}${cell.attended ? " on" : ""}${cell.today ? " today" : ""}`}>
              {cell.attended ? <i /> : null}
              <b>{cell.blank ? "" : cell.day}</b>
            </div>
          ))}
        </div>
        {edge ? (
          <p className="edge">이 앱에 남은 기록은 여기까지예요</p>
        ) : null}
      </Card>

      <div className="rhythm">
        <span className="big serif num">{thisCount}<span>번</span></span>
        <span className="prev num">지난달 {prevCount}번</span>
      </div>

      {note.line ? (
        <div className="since">
          <p className={`a num${note.tone === "away" ? " quiet" : ""}`}>{note.line}</p>
          {note.hint ? <p className="b">{note.hint}</p> : null}
        </div>
      ) : null}

      <Card className="barwrap">
        <p className="cap">최근 여섯 달</p>
        <div className="bars">
          {months.map((row, index) => (
            <div key={`${row.year}-${row.month}`}
              className={`bar${row.count ? " on" : ""}${index === months.length - 1 ? " last" : ""}`}>
              <u style={{ height: `${Math.max(6, Math.round((row.count / top) * 52))}px` }} />
              <em>{row.label}</em>
            </div>
          ))}
        </div>
      </Card>

      {/* 격려 3 : 지식 1. 넷 중 하나만 지식이다. */}
      <Card className="know">
        <p className="cap">알아 두면 좋아요</p>
        <p>{note.tone === "away"
          ? "2~3주 쉬면 심폐 지구력부터 먼저 떨어집니다. 근력은 더 오래 남고, 둘 다 주 한두 번만 이어가도 지키기 쉬워요."
          : "같은 횟수라도 몰아서 하는 것보다 나눠서 할 때 몸이 더 잘 기억합니다."}</p>
      </Card>

      {/* 이 탭에서 회원이 할 수 있는 단 하나의 행동이라 카드 한 장을 준다.
          맨 아래인 것도 뜻이 있다 -- 달력을 다 보고 내려온 사람이 마지막에
          만나는 자리가 말이 나오는 자리다. */}
      <Card className="say">
        <p className="cap">의견 보내기</p>
        <p>수업이 어땠는지, 불편한 것은 없는지 알려 주세요. 칭찬도 건의도 좋고, 익명으로도 보낼 수 있어요.</p>
        <a className="btn" href={FEEDBACK_KAKAO_URL} target="_blank" rel="noopener noreferrer">
          카카오톡으로 보내기 <span aria-hidden="true">→</span>
        </a>
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
