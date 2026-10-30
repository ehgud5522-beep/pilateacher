/**
 * 화면 셋 — 홈 · 수업기록 · 마이페이지 (2026-10-30 개편, 예약 탭은 다음 단계).
 *
 * 셋 다 **투영 문서 하나**를 그린다. 질의도, 다른 컬렉션도 없다 (member-data.js).
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
import {
  DELETED_ITEMS, DELETE_STEP, KEPT_ITEMS, deleteFailureMessage,
} from "./delete-account.js";
import { diagnosticsText } from "./diagnostics.js";
/* 회원권 카드의 숫자는 강사 앱과 한 곳에서 나온다. 같은 회원권이 두 화면에서
   다른 숫자가 되는 것을 막는 것이 이 import 의 목적이다. */
import { isUsablePass, remainingSplit } from "../../src/features/membership/pass-cards.js";
/* 수강권 이름은 상품명이 아니라 수업 유형과 횟수로 짓는다 (pass-label.js). */
import { lessonName, passTitle, serviceLabel } from "./pass-label.js";
import { homeSummary } from "./home-summary.js";

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
 * 지금 쓸 수 있는 회원권인가. 화면이 "사용 중" 과 "지난" 을 이것으로 가른다.
 *
 * 강사 앱과 **같은 판정을 쓴다**. 두 화면이 같은 회원권을 두고 한쪽은 "사용 중",
 * 다른 쪽은 "지난" 이라고 말하면 회원은 어느 쪽을 믿어야 할지 알 수 없고, 그것을
 * 물어볼 곳은 강사뿐이다.
 */
export const isUsable = isUsablePass;

const Card = ({ children, tone, className = "" }) => (
  <section className={`card${tone ? ` ${tone}` : ""}${className ? ` ${className}` : ""}`}>
    {children}
  </section>
);

/* ── 달력 계산 ───────────────────────────────────────────────────────────

   날짜는 투영의 수업 이력에 이미 있다. 여기 있는 것은 그 배열을 세는 순수
   계산이고, 그래서 경계값을 테스트로 고정할 수 있다. */

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

/** 그날 수업이 있었는가를 가리는 이력의 종류. 발급·취소는 수업이 아니다. */
const ATTENDED_TYPE = "deduct";

/** 자정으로 맞춘 날짜. 시각이 섞이면 같은 날이 다른 날이 된다. */
const atMidnight = (value) => {
  const at = toDate(value);
  return at ? new Date(at.getFullYear(), at.getMonth(), at.getDate()) : null;
};

export const sameDay = (left, right) => Boolean(left && right)
  && left.getFullYear() === right.getFullYear()
  && left.getMonth() === right.getMonth()
  && left.getDate() === right.getDate();

/**
 * 수업한 날들. 오래된 것부터.
 *
 * 되돌린 차감(correction)은 빼지 못한다 -- 투영의 이력에 lessonId 가 없어
 * 어느 차감을 되돌린 것인지 짝지을 수 없다. 내부 id 를 회원에게 내보내는 것이
 * 더 나쁘다고 보고 그대로 두었다. 되돌린 사실은 수업기록 탭이 한 줄로 말한다.
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
 * @returns {Array<{ key: string, day: number, date: Date | null, blank: boolean, attended: boolean, today: boolean }>}
 */
export function monthCells(year, month, dates, now = new Date(), plannedDates = []) {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - WEEK_START + 7) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < lead; index += 1) {
    cells.push({ key: `blank-${index}`, day: 0, date: null, blank: true, attended: false, planned: false, today: false });
  }
  for (let day = 1; day <= days; day += 1) {
    const at = new Date(year, month, day);
    cells.push({
      key: `${year}-${month}-${day}`,
      day,
      date: at,
      blank: false,
      attended: dates.some((date) => sameDay(date, at)),
      planned: plannedDates.some((date) => sameDay(date, at)),
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
 * 기록이 없는 달과 안 나온 달은 다르다. 투영이 최근 100건만 싣고 오므로,
 * 상한에 닿아 있으면 가장 오래된 기록보다 앞은 **모르는 구간**이다. 빈
 * 달력을 그려 두면 회원은 그때 안 나온 것으로 읽는다.
 */
export function historyEdge(dates, history) {
  const capped = (Array.isArray(history) ? history : []).length >= HISTORY_KEPT;
  const oldest = dates[0] || null;
  return { oldest, capped };
}

/** 그날 받은 수업(차감 이력). 이른 시각부터. */
export function lessonsOn(history, day) {
  return (Array.isArray(history) ? history : [])
    .filter((row) => text(row?.type) === ATTENDED_TYPE && sameDay(toDate(row?.occurredAt), day))
    .sort((left, right) => toDate(left.occurredAt) - toDate(right.occurredAt));
}

/** 예정 수업이 있는 날들 (2026-10-30, 강사 일정이 센터 서버로 온다). */
export function plannedDates(schedule) {
  return (Array.isArray(schedule) ? schedule : [])
    .map((lesson) => atMidnight(lesson?.startsAt))
    .filter(Boolean);
}

/**
 * 그날의 수업 -- 예정과 받은 것을 한 줄로, 이른 시각부터.
 *
 * 예정 수업은 강사가 일정을 등록 · 수정 · 취소하면 곧바로 회원 데이터에 들어온다
 * (functions/src/member-view.js 의 schedule). 확정하면 예정에서 빠지고 받은
 * 수업(이력)으로 들어오므로 한 수업이 두 번 서지 않는다. 취소된 수업은 목록에서
 * 사라진다 -- "취소됨" 을 따로 그리지 않는다.
 */
export function dayLessons(view, day) {
  const planned = (Array.isArray(view?.schedule) ? view.schedule : [])
    .filter((lesson) => sameDay(toDate(lesson?.startsAt), day))
    .map((lesson) => ({ ...lesson, when: lesson.startsAt, planned: true }));
  const done = lessonsOn(view?.history, day).map((row) => ({ ...row, when: row.occurredAt, planned: false }));
  return [...planned, ...done].sort((left, right) => toDate(left.when) - toDate(right.when));
}

/** 회원 데이터에 예정 수업이 실려 오는가. 옛 문서(서버가 다시 만들기 전)에는 없다. */
export const knowsSchedule = (view) => Array.isArray(view?.schedule);

/** "19:00". 시각을 모르는 옛 기록(자정)은 빈 문자열 -- 지어낸 시각을 쓰지 않는다. */
export function timeLabel(value) {
  const at = toDate(value);
  if (!at || (at.getHours() === 0 && at.getMinutes() === 0)) return "";
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * 남은 횟수 칩. "남은 8회 · 서비스 2회" -- 서비스가 0 이면 뒤를 뺀다.
 *
 * 쓸 수 있는 회원권 전부의 합이다. 정규와 서비스는 강사 앱과 같은 계산으로
 * 가른다(remainingSplit) -- 서비스가 먼저 쓰이므로 회원권이 처음 가진 서비스
 * 횟수와는 다를 수 있다.
 */
export function remainingChip(passes, now = new Date()) {
  const usable = (Array.isArray(passes) ? passes : []).filter((pass) => isUsable(pass, now));
  let regular = 0;
  let service = 0;
  for (const pass of usable) {
    const split = remainingSplit(pass);
    regular += count(split.regular);
    service += count(split.service);
  }
  return service ? `남은 ${regular}회 · 서비스 ${service}회` : `남은 ${regular}회`;
}

const MONTH_LABEL = (year, month) => `${year}년 ${month + 1}월`;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/* 수업 아이콘. 아이콘 묶음을 들이지 않는다 -- 쓰는 것이 몇 개뿐이다. */
const LessonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="5" r="2" />
    <path d="M5 21l4-7 3 2 3-2 4 7M9 14l-2-4h10l-2 4" />
  </svg>
);

/** 수업 한 건 카드. 시각 · 수업 이름 · 강사 · 지점. 그룹 표기는 없다. */
function LessonCard({ row, location, onOpen }) {
  const when = row.when || row.occurredAt;
  const time = timeLabel(when);
  return (
    <button type="button" className={`lesson${row.planned ? " planned" : ""}`} onClick={onOpen}>
      <span className="time num">{time || dayLabel(when)}</span>
      <span className="icon"><LessonIcon /></span>
      <span className="what">
        <b>{lessonName(row)}</b>
        <span className="tags">
          {text(row.instructorName) ? <i>{text(row.instructorName)} 강사</i> : null}
          {text(row.locationName || location) ? <i>{text(row.locationName || location)}</i> : null}
        </span>
      </span>
      {onOpen ? <span className="chev" aria-hidden="true">›</span> : null}
    </button>
  );
}

/** 수업기록 한 줄. 날짜 · 강사, 그리고 강사가 남긴 한마디가 있을 때만 말풍선. */
function RecordItem({ row }) {
  const type = text(row.type);
  return (
    <li>
      <span className="dot" />
      <div className="body">
        <p className="when num">
          {dayLabel(row.occurredAt)}<em>({weekdayLabel(row.occurredAt)})</em>
        </p>
        <p className="who">
          {type === "deduct" ? lessonName(row) : HISTORY_LABEL[type] || type}
          {text(row.instructorName) ? ` · ${text(row.instructorName)} 강사` : ""}
        </p>
        {/* 강사가 회원에게 남긴 한마디. 수업기록 원문이 아니라 회원을 향해 따로
            적은 문장이고, 없으면 줄 자체가 없다 -- "메시지 없음" 을 그리면 빈
            줄이 기록처럼 쌓인다. */}
        {text(row.memberNote) ? <p className="note">{text(row.memberNote)}</p> : null}
      </div>
    </li>
  );
}

const HISTORY_LABEL = {
  deduct: "수업",
  /* 잘못 차감했다 되돌린 사실은 회원의 것이다. 숨기면 회차가 늘어난 이유를
     아무도 설명하지 못한다. */
  correction: "차감 취소",
  transfer: "담당 강사 변경",
};

/* ── 홈 ──────────────────────────────────────────────────────────────── */

/**
 * 홈. 위에서부터 달력 → 그날 수업 → 남은 횟수 → 최근 수업 기록.
 *
 * 날짜를 누르면 그날의 수업이 아래 칸에 선다. 처음에는 오늘이다.
 *
 * @param {{ view: any, now?: Date, monthsBack?: number, onOpenRecords?: () => void }} props
 *   monthsBack  처음 보여 줄 달. 0 이 이번 달이다. 화면은 늘 0 으로 열고,
 *               테스트가 과거 달을 그려 보는 데 쓴다.
 */
export function Home({ view, now = new Date(), monthsBack = 0, onOpenRecords }) {
  const history = Array.isArray(view?.history) ? view.history : [];
  const dates = useMemo(() => attendedDates(history), [history]);
  const planned = useMemo(() => plannedDates(view?.schedule), [view?.schedule]);
  /* 예정 수업이 있는 달까지는 앞으로 넘길 수 있다. back 이 음수면 앞달이다. */
  const lastPlanned = planned.length ? planned.reduce((a, b) => (a > b ? a : b)) : null;
  const ahead = lastPlanned
    ? Math.max(0, (lastPlanned.getFullYear() - now.getFullYear()) * 12 + lastPlanned.getMonth() - now.getMonth())
    : 0;
  const [back, setBack] = useState(monthsBack);
  const [picked, setPicked] = useState(null);
  const shown = new Date(now.getFullYear(), now.getMonth() - back, 1);
  const year = shown.getFullYear();
  const month = shown.getMonth();
  const cells = useMemo(() => monthCells(year, month, dates, now, planned), [year, month, dates, now, planned]);
  const { oldest, capped } = historyEdge(dates, history);
  const edge = capped && oldest && year === oldest.getFullYear() && month === oldest.getMonth();
  /* 가장 오래된 기록보다 더 앞은 볼 것이 없다. 기록이 아예 없으면 이번 달에
     머문다 -- 빈 달을 넘기게 두면 안 나온 것처럼 읽힌다. */
  const earliest = oldest || now;
  const canGoBack = new Date(year, month, 1) > new Date(earliest.getFullYear(), earliest.getMonth(), 1);

  const selected = picked || atMidnight(now);
  const isToday = sameDay(selected, now);
  const lessonsThatDay = dayLessons(view, selected);

  const summary = homeSummary(view, isUsable, now);
  const left = daysUntil(summary.expiresAt, now);
  const ended = text(view?.clientStatus) === "ended";
  /* 임박은 말하되 재등록은 권하지 않는다. 사실만 놓으면 회원이 스스로 센터에
     묻는다 -- 앱이 파는 자리가 되면 열어 보는 이유가 달라진다. */
  const notice = ended
    ? "이용이 종료된 회원권이에요. 지난 기록은 그대로 보실 수 있어요."
    : summary.remaining === 0 ? "남은 횟수가 없어요. 센터에 문의해 주세요."
      : left !== null && left <= 14 ? `만료까지 ${left}일 남았어요.`
        : summary.remaining <= 3 ? "곧 마지막 회차예요." : "";

  const recent = history.filter((row) => text(row?.type) === ATTENDED_TYPE).slice(0, 2);

  return (
    <div className="stack">
      <header className="greet">
        <p className="hello">{text(view?.name)}님 <span aria-hidden="true">👋</span></p>
        {view?.locationName ? <p className="place">{view.locationName}</p> : null}
      </header>

      <Card className="cal">
        <div className="calhead">
          <p className="mon num">{MONTH_LABEL(year, month)}</p>
          <div className="arrows">
            <button type="button" aria-label="이전 달" disabled={!canGoBack}
              onClick={() => setBack((value) => value + 1)}>‹</button>
            <button type="button" aria-label="다음 달" disabled={back <= -ahead}
              onClick={() => setBack((value) => Math.max(-ahead, value - 1))}>›</button>
          </div>
        </div>
        <div className="dow">{DOW.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="grid">
          {cells.map((cell) => (cell.blank ? <span key={cell.key} className="day out" /> : (
            <button key={cell.key} type="button"
              aria-label={`${month + 1}월 ${cell.day}일${cell.attended ? " · 수업 있음" : cell.planned ? " · 수업 예정" : ""}`}
              aria-pressed={sameDay(cell.date, selected)}
              className={`day${cell.attended ? " on" : ""}${cell.planned ? " plan" : ""}${cell.today ? " today" : ""}${sameDay(cell.date, selected) ? " picked" : ""}`}
              onClick={() => setPicked(cell.date)}>
              <b>{cell.day}</b>
              {cell.attended || cell.planned ? <i /> : null}
            </button>
          )))}
        </div>
        {edge ? <p className="edge">이 앱에 남은 기록은 여기까지예요</p> : null}
        <p className="tally num">이번 달 {countInMonth(dates, year, month)}번</p>
      </Card>

      <section>
        <div className="sechead">
          <p>{isToday ? "오늘 수업" : `${selected.getMonth() + 1}월 ${selected.getDate()}일 수업`}</p>
          {onOpenRecords ? <button type="button" onClick={onOpenRecords}>전체보기 ›</button> : null}
        </div>
        {lessonsThatDay.length ? (
          <div className="stack tight">
            {lessonsThatDay.map((row, index) => (
              <LessonCard key={`${text(row.when)}-${index}`} row={row}
                location={view?.locationName} onOpen={row.planned ? undefined : onOpenRecords} />
            ))}
          </div>
        ) : (
          <Card className="quietcard">
            <p className="muted" style={{ fontSize: TYPE.caption }}>
              {/* 예정 수업을 아는 문서에서만 "없어요" 라고 한다. 옛 문서(서버가 다시
                  만들기 전)에서 그렇게 말하면 모르는 것을 단정하게 된다. */}
              {knowsSchedule(view)
                ? (isToday ? "오늘은 예정된 수업이 없어요." : "이날은 수업이 없어요.")
                : (isToday ? "오늘 받은 수업은 끝나면 여기에 보여요." : "이날은 수업 기록이 없어요.")}
            </p>
          </Card>
        )}
      </section>

      <Card className="left">
        <div className="lefthead">
          <p className="cap">내 회원권</p>
          {summary.expiresAt ? <p className="until num">{dateLabel(summary.expiresAt)}까지</p> : null}
        </div>
        {summary.front ? (
          <p className="name">
            {passTitle(summary.front)}{summary.others ? <span className="muted"> 외 {summary.others}장</span> : null}
          </p>
        ) : null}
        <p className="chipline"><span className="chip on num">{remainingChip(view?.passes, now)}</span></p>
        {notice ? <p className="muted mt" style={{ fontSize: TYPE.caption }}>{notice}</p> : null}
      </Card>

      <section>
        <div className="sechead">
          <p>최근 수업 기록</p>
          {onOpenRecords ? <button type="button" onClick={onOpenRecords}>더보기 ›</button> : null}
        </div>
        {recent.length ? (
          <ol className="timeline">
            {recent.map((row, index) => <RecordItem key={`${text(row.occurredAt)}-${index}`} row={row} />)}
          </ol>
        ) : (
          <Card className="quietcard">
            <p className="muted" style={{ fontSize: TYPE.body }}>첫 수업을 기다리고 있어요</p>
          </Card>
        )}
      </section>
    </div>
  );
}

/* ── 수업기록 ────────────────────────────────────────────────────────── */

export function Records({ view }) {
  const rows = Array.isArray(view?.history) ? view.history : [];
  const used = count(view?.journey?.usedTotal);

  if (rows.length === 0) {
    return (
      <div>
        <h1 className="title">수업기록</h1>
        <div className="empty">
          <p className="big">첫 수업을<br />기다리고 있어요</p>
          <p className="sub">수업이 끝나면 여기에<br />하나씩 쌓입니다</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="title">수업기록</h1>
      {/* 앱에 옮기기 전의 수업도 회원이 한 수업이다. 날짜가 없어 줄로는 그리지
          못하므로 숫자로만 남긴다. */}
      {used ? <p className="count num">지금까지 <b>{used}번</b> 함께했어요</p> : null}
      <ol className="timeline">
        {rows.map((row, index) => <RecordItem key={`${text(row.occurredAt)}-${index}`} row={row} />)}
      </ol>
      {used > rows.length ? (
        <p className="more num">{used - rows.length}번의 수업이 더 있어요</p>
      ) : null}
    </div>
  );
}

/* ── 마이페이지 ──────────────────────────────────────────────────────── */

/**
 * 회원권 목록 · 의견 보내기 · 로그아웃 · 계정 삭제.
 *
 * 계정 삭제가 맨 아래인 것은 뜻이 있다 -- 되돌릴 수 없는 버튼은 지나가다 누를
 * 자리에 두지 않는다.
 */
export function MyPage({ view, now = new Date(), onSignOut, onDeleteAccount }) {
  const passes = Array.isArray(view?.passes) ? view.passes : [];
  const using = passes.filter((pass) => isUsable(pass, now));
  const past = passes.filter((pass) => !isUsable(pass, now));

  return (
    <div className="stack">
      <h1 className="title">마이페이지</h1>
      <Card className="me">
        <p className="name">{text(view?.name)}님</p>
        {view?.locationName ? <p className="muted mt" style={{ fontSize: TYPE.caption }}>{view.locationName}</p> : null}
      </Card>

      {passes.length === 0 ? (
        <Card>
          <p style={{ fontSize: TYPE.body }}>지금 쓸 수 있는 회원권이 없어요.</p>
          <p className="muted mt" style={{ fontSize: TYPE.caption }}>센터에 문의해 주세요.</p>
        </Card>
      ) : [["사용 중", using, false], ["지난 회원권", past, true]].map(([label, group, dim]) => (
        group.length ? (
          <div key={label}>
            <p className="group">{label}</p>
            <div className="stack">
              {group.map((pass) => <PassCard key={text(pass.passId)} pass={pass} dim={dim} />)}
            </div>
          </div>
        ) : null
      ))}

      {/* 의견 보내기. 회원이 센터에 말을 거는 자리라 카드 한 장을 준다. */}
      <Card className="say">
        <p className="cap">의견 보내기</p>
        <p>수업이 어땠는지, 불편한 것은 없는지 알려 주세요. 칭찬도 건의도 좋고, 익명으로도 보낼 수 있어요.</p>
        <a className="btn" href={FEEDBACK_KAKAO_URL} target="_blank" rel="noopener noreferrer">
          카카오톡으로 보내기 <span aria-hidden="true">→</span>
        </a>
      </Card>

      {onSignOut ? <button type="button" className="btn" onClick={onSignOut}>로그아웃</button> : null}
      {onDeleteAccount ? <DeleteAccount onDelete={onDeleteAccount} /> : null}
    </div>
  );
}

function PassCard({ pass, dim }) {
  return (
    <Card tone={dim ? "quietcard" : ""} className="pass">
      <div className="rowcard">
        <p className="name">{passTitle(pass)}</p>
        {dim ? null : (
          <p className="rem num">{count(pass.remainingCount)}<span>회</span></p>
        )}
      </div>
      {/* 서비스는 산 횟수에 더하지 않고 따로 적는다. 0회면 줄이 없다. */}
      {serviceLabel(pass) ? <p className="meta">{serviceLabel(pass)}</p> : null}
      <p className="meta">
        {count(pass.remainingCount) > 0
          ? <><b>{count(pass.remainingCount)}회</b> 남았어요</>
          : "모두 사용했어요"}
      </p>
      {/* 서비스 회차는 먼저 쓰인다. 몇 회가 서비스인지 말하지 않으면 회원은
          정규가 줄어든 줄로 읽고, 재등록 때 숫자가 안 맞는다고 느낀다. 숫자는
          강사 앱과 한 곳에서 나온다. */}
      {remainingSplit(pass).service > 0 ? (
        <p className="meta">그중 서비스 {remainingSplit(pass).service}회</p>
      ) : null}
      {pass.expiresAt ? <p className="meta num">{dateLabel(pass.expiresAt)}까지</p> : null}
      {/* 각자 30회로 오해하면 계약 자체가 틀어진다. 반드시 적는다. */}
      {pass.isDuet ? (
        <p className="duet">
          {pass.partnerName ? `${pass.partnerName}님과 ` : "두 분이 "}함께 쓰는 회원권이에요
          <br /><em>수업 한 번에 1회 차감</em>
        </p>
      ) : null}
    </Card>
  );
}

/**
 * 계정 삭제. 되돌릴 수 없는 버튼이라 **두 번 만난다.**
 *
 * 첫 번째는 목록을 펴는 것뿐이고, 거기서 무엇이 사라지고 무엇이 남는지 읽은
 * 뒤에야 지우는 버튼이 나온다. 목록은 delete-account.js 에 있다 -- 서버가
 * 실제로 하는 일과 나란히 읽히도록.
 */
/**
 * 계정 삭제 안내 -- `/delete-account` 로 들어왔을 때 로그인 화면 위에 선다.
 *
 * 스토어 심사자와 앱을 지운 회원이 읽는 자리다. 로그인 없이도 어떻게
 * 지우는지, 무엇이 사라지고 무엇이 남는지를 말한다. 목록은 실제 삭제 확인
 * 화면과 같은 것을 쓴다 (delete-account.js) -- 두 곳의 말이 갈라지면 안 된다.
 */
export function DeleteAccountGuide({ appName }) {
  return (
    <Card className="danger">
      <p className="cap">{text(appName) || "회원 앱"} 계정 삭제</p>
      <ol className="bullets mt" style={{ fontSize: TYPE.caption }}>
        <li>아래에서 센터에 등록된 휴대폰 번호로 로그인해요.</li>
        <li>로그인하면 마이페이지가 열려요. 맨 아래 "계정 삭제" 를 눌러요.</li>
        <li>"네, 지울게요" 를 누르면 바로 지워져요.</li>
      </ol>

      <p className="mt" style={{ fontSize: TYPE.caption }}>사라지는 것</p>
      <ul className="bullets">{DELETED_ITEMS.map((item) => <li key={item}>{item}</li>)}</ul>

      <p className="mt" style={{ fontSize: TYPE.caption }}>그대로 남는 것</p>
      <ul className="bullets">{KEPT_ITEMS.map((item) => <li key={item}>{item}</li>)}</ul>

      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        앱을 이미 지웠어도 이 페이지에서 지울 수 있어요. 로그인이 안 되면 센터에 말씀해 주세요.
      </p>
    </Card>
  );
}

export function DeleteAccount({ onDelete }) {
  const [step, setStep] = useState(DELETE_STEP.IDLE);
  const [failure, setFailure] = useState("");

  const run = async () => {
    setStep(DELETE_STEP.WORKING);
    setFailure("");
    try {
      await onDelete();
      /* 화면을 되돌리지 않는다. 부르는 쪽이 로그아웃하고 처음 화면으로
         보낸다 -- 여기서 "완료" 를 그리면 지워진 계정의 화면이 잠깐 남는다. */
    } catch (error) {
      setFailure(text(error?.code) || "unknown");
      setStep(DELETE_STEP.FAILED);
    }
  };

  if (step === DELETE_STEP.IDLE) {
    return (
      <Card className="danger">
        <p className="cap">계정 삭제</p>
        <p className="muted" style={{ fontSize: TYPE.caption }}>
          앱 계정을 지웁니다. 센터에 등록된 회원 정보와 남은 회원권은 그대로 있어요.
        </p>
        <button type="button" className="btn mt"
          onClick={() => setStep(DELETE_STEP.CONFIRM)}>계정 삭제</button>
      </Card>
    );
  }

  const working = step === DELETE_STEP.WORKING;
  return (
    <Card tone="warn" className="danger">
      <p className="cap">정말 지울까요?</p>

      <p className="mt" style={{ fontSize: TYPE.caption }}>사라지는 것</p>
      <ul className="bullets">{DELETED_ITEMS.map((item) => <li key={item}>{item}</li>)}</ul>

      <p className="mt" style={{ fontSize: TYPE.caption }}>그대로 남는 것</p>
      <ul className="bullets">{KEPT_ITEMS.map((item) => <li key={item}>{item}</li>)}</ul>

      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        다시 쓰려면 같은 번호로 처음부터 로그인하면 돼요.
      </p>

      {failure ? (
        <p className="note mt" style={{ fontSize: TYPE.caption }}>{deleteFailureMessage(failure)}</p>
      ) : null}

      <button type="button" className="btn danger mt" disabled={working} onClick={run}>
        {working ? "지우는 중…" : "네, 지울게요"}
      </button>
      <button type="button" className="btn mt" disabled={working}
        onClick={() => { setStep(DELETE_STEP.IDLE); setFailure(""); }}>그만두기</button>
    </Card>
  );
}


/* ── 상태 화면 ───────────────────────────────────────────────────────── */

/**
 * 연결이 늦다. **무한 스피너를 두지 않는다.**
 *
 * 기다리는 화면은 "곧 된다" 고 말하는데, 영영 안 될 수도 있다는 것을 아무도
 * 말해 주지 않으면 회원은 앱이 고장 난 줄도 모르고 들고 있는다 -- 실제로
 * TestFlight 빌드가 그렇게 멈췄다.
 */
export function SlowConnection({ onRetry, seconds }) {
  return (
    <Card tone="warn">
      <p style={{ fontSize: TYPE.body }}>연결이 늦어요.</p>
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        {count(seconds) ? `${count(seconds)}초째 기다리고 있어요. ` : ""}
        네트워크를 확인하고 다시 시도해 주세요.
      </p>
      {onRetry ? <button type="button" className="btn mt" onClick={onRetry}>다시 시도</button> : null}
      <p className="muted mt" style={{ fontSize: TYPE.caption }}>
        계속 이러면 맨 아래 버전을 다섯 번 눌러 기록을 센터에 보내 주세요.
      </p>
    </Card>
  );
}

/**
 * 진단 기록. 화면 맨 아래 버전 글자를 다섯 번 누르면 나온다.
 *
 * 대표가 Mac 없이 원인을 볼 수 있는 유일한 자리다. **회원 이름·번호·uid 는
 * 들어 있지 않다** (diagnostics.js).
 */
export function Diagnostics({ entries, onClose, onClear }) {
  const rows = Array.isArray(entries) ? entries : [];
  return (
    <Card className="diag">
      <div className="diaghead">
        <p className="cap">진단 기록</p>
        <button type="button" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p className="muted" style={{ fontSize: TYPE.caption }}>
        최근 {rows.length}건. 이름·번호는 들어 있지 않아요. 길게 눌러 복사한 뒤 센터에 보내 주세요.
      </p>
      {/* 읽기 전용 textarea 다. 길게 눌러 전체 선택이 되는 것이 요점이고,
          공유 시트를 붙이면 플러그인이 하나 늘어난다 -- 막혔을 때 보는
          화면에 새 실패 지점을 더하지 않는다. */}
      <textarea className="diagbox mt" readOnly rows={12} value={diagnosticsText(rows)} />
      {onClear ? <button type="button" className="btn mt" onClick={onClear}>기록 지우기</button> : null}
    </Card>
  );
}

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
