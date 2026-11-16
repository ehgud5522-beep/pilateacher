/**
 * 수업 관리 시트 (2026-11-17 대표 개편 지시서). 화면이 말하는 것을 여기서 정한다 -- 그리기는 App.jsx.
 *
 * 기능은 그대로다. 바뀐 것은 순서와 기본값뿐:
 *  - 출석은 기본값이다. 아직 고르지 않은 사람(예약)은 [수업 확정] 을 누를 때 출석으로 적힌다.
 *  - 노쇼의 차감은 기본 1회 차감이다. 고르지 않았으면 [노쇼 처리] 를 누를 때 차감으로 적힌다.
 *  - 하단 버튼 하나가 지금 무엇이 일어날지 말한다 (잔여 N회 → N-1회).
 *
 * 누를 때 일어나는 일은 한 번에 하나씩이다 (nextConfirmStep). 출석을 적고, 차감을 적고, 그다음에
 * 확정한다 -- 확정은 저장된 일정을 읽으므로 앞의 두 가지가 저장된 뒤에야 부른다.
 */
import { kstDay, kstDaysBetween } from "../../../functions/shared/renewal-forecast.mjs";

export const LESSON_STAGE = Object.freeze({ PRE: "pre", POST: "post" });
export const ATTENDANCE = Object.freeze({ ATTEND: "done", NOSHOW: "noshow", CANCEL: "cancel", BOOKED: "booked" });

/** 만료가 이만큼 남으면 강조한다. 재등록 알림의 두 번째 칸(14일)과 같다. */
export const EXPIRY_SOON_DAYS = 14;
/** 잔여가 이만큼 이하이면 강조한다. */
export const LOW_REMAINING_COUNT = 3;

const text = (value) => String(value ?? "").trim();
const statusOf = (attendee) => text(attendee?.status) || ATTENDANCE.BOOKED;

/** 화면에 보이는 출석 상태. 아직 고르지 않았으면 출석(기본값). */
export function effectiveStatus(attendee) {
  const status = statusOf(attendee);
  return status === ATTENDANCE.BOOKED ? ATTENDANCE.ATTEND : status;
}

/** 노쇼의 차감 여부. 고르지 않았으면 차감(기본값). */
export const effectiveNoshowFee = (attendee) => (typeof attendee?.noshowFee === "boolean" ? attendee.noshowFee : true);

/** 확정하면 회차를 쓰는 사람인가 -- 출석, 노쇼 차감. lesson-settlement.js 의 deductsFor 와 같은 선. */
export function willDeduct(attendee) {
  const status = effectiveStatus(attendee);
  if (status === ATTENDANCE.ATTEND) return true;
  return status === ATTENDANCE.NOSHOW && effectiveNoshowFee(attendee);
}

/** 처음 열 때의 단계. 이미 무언가를 고른 수업은 수업 후로 연다. */
export function initialStage(attendees) {
  return (Array.isArray(attendees) ? attendees : []).some((attendee) => statusOf(attendee) !== ATTENDANCE.BOOKED)
    ? LESSON_STAGE.POST
    : LESSON_STAGE.PRE;
}

/**
 * [수업 확정] 을 눌렀을 때 다음에 할 일 하나.
 * @returns {{ type: "status", memberId: string } | { type: "fee", memberId: string } | { type: "finish" }}
 */
export function nextConfirmStep(attendees) {
  const list = Array.isArray(attendees) ? attendees : [];
  const booked = list.find((attendee) => statusOf(attendee) === ATTENDANCE.BOOKED);
  if (booked) return { type: "status", memberId: text(booked.memberId) };
  const unchosen = list.find((attendee) => statusOf(attendee) === ATTENDANCE.NOSHOW && typeof attendee.noshowFee !== "boolean");
  if (unchosen) return { type: "fee", memberId: text(unchosen.memberId) };
  return { type: "finish" };
}

/** 여러 사람의 상태를 한 단어로 -- 모두 같으면 그것, 섞였으면 출석(확정). */
export function overallStatus(attendees) {
  const statuses = [...new Set((Array.isArray(attendees) ? attendees : []).map(effectiveStatus))];
  return statuses.length === 1 ? statuses[0] : ATTENDANCE.ATTEND;
}

const remainingLine = (remaining, deducts) => {
  if (!Number.isInteger(remaining)) return "";
  if (!deducts) return `잔여 ${remaining}회 유지`;
  return `잔여 ${remaining}회 → ${Math.max(0, remaining - 1)}회`;
};

/**
 * 하단 고정 버튼.
 * @param {{
 *   stage: string, attendees: any[],
 *   remainingOf?: (memberId: string) => number | null,
 *   sharedPass?: boolean, busy?: boolean, failedBefore?: boolean,
 * }} input
 * @returns {{ label: string, hint: string, action: "advance" | "confirm" }}
 */
export function confirmBarView({ stage, attendees, remainingOf = () => null, sharedPass = false, busy = false, failedBefore = false }) {
  if (stage === LESSON_STAGE.PRE) return { label: "수업 끝 · 처리하기", hint: "수업이 끝나면 눌러 주세요", action: "advance" };
  const list = Array.isArray(attendees) ? attendees : [];
  const deducting = list.filter(willDeduct);
  const status = overallStatus(list);
  const many = list.length > 1;
  const deductLabel = deducting.length === 0 ? "차감 없음" : many && !sharedPass ? `${deducting.length}명 차감` : "1회 차감";
  const verb = status === ATTENDANCE.NOSHOW ? "노쇼 처리" : status === ATTENDANCE.CANCEL ? "취소 처리" : "수업 확정";
  const label = busy ? "처리 중" : failedBefore ? `다시 확정 · ${deductLabel}` : `${verb} · ${deductLabel}`;

  let hint;
  if (!many) {
    const only = list[0];
    hint = remainingLine(remainingOf(text(only?.memberId)), willDeduct(only));
  } else if (sharedPass) {
    hint = deducting.length ? "함께 쓰는 회원권에서 1회 차감" : "잔여 그대로 유지";
  } else {
    hint = deducting.length ? `${deducting.length}명 각 1회 차감` : "잔여 그대로 유지";
  }
  return { label, hint, action: "confirm" };
}

/** 확정 완료 화면의 제목. */
export function doneTitle(attendees) {
  const status = overallStatus(attendees);
  if (status === ATTENDANCE.NOSHOW) return "노쇼로 처리했어요";
  if (status === ATTENDANCE.CANCEL) return "취소로 처리했어요";
  return "수업이 확정됐어요";
}

/**
 * 만료일 한 칸. 날짜와 "N일 전" 을 **같은 값에서** 센다 -- 둘을 따로 세면 화면 한 줄 안에서 서로 다른
 * 날을 말한다. 날 수는 재등록 알림과 같은 함수(kstDaysBetween, 한국 날짜)다.
 * @returns {null | { date: string, label: string, days: number, soon: boolean, expired: boolean }}
 */
export function expiryView(expiresAt, now = new Date()) {
  const at = typeof expiresAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt)
    ? Date.parse(`${expiresAt}T00:00:00+09:00`)
    : expiresAt instanceof Date ? expiresAt.getTime()
      : typeof expiresAt?.toMillis === "function" ? expiresAt.toMillis()
        : typeof expiresAt?.seconds === "number" ? expiresAt.seconds * 1000
          : Date.parse(expiresAt || "");
  if (!Number.isFinite(at)) return null;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const date = kstDay(at);
  const days = kstDaysBetween(nowMs, at);
  const [, month, day] = date.split("-");
  return {
    date,
    label: `${month}.${day}`,
    days,
    soon: days >= 0 && days <= EXPIRY_SOON_DAYS,
    expired: days < 0,
  };
}

/** "만료 12.18" 뒤에 붙는 말. 임박하거나 지났을 때만. */
export function expirySuffix(view) {
  if (!view) return "";
  if (view.expired) return " · 만료됨";
  if (view.days === 0) return " · 오늘 만료";
  return view.soon ? ` · ${view.days}일 남음` : "";
}

export const remainingIsLow = (remaining) => Number.isInteger(remaining) && remaining <= LOW_REMAINING_COUNT;

/** 다음 주 같은 시간 버튼의 날짜 ("11.23 월 16:00"). */
export function nextWeekLabel(date, start, addDaysISO, dayOfWeek) {
  if (!text(date)) return "";
  const next = addDaysISO(date, 7);
  return `${next.slice(5).replace("-", ".")} ${dayOfWeek(next)} ${text(start)}`.trim();
}
