/**
 * 급여의 "수업료 외" 줄 (2026-11-21 대표: "급여 집계에 잘 포함돼서 나오는지, 강사가 이해하기 쉬워야 하고 한눈에 잘 보여야 함").
 *
 * 매출 인센(salesMonths) · FC 복지 수업료(fcLessonMonths)를 급여 화면이 같은 모양으로 읽는다. 순수 함수다.
 *   - **확정된 것만 합계에 든다.** 숫자는 서버가 확정할 때 남긴 snapshot 그대로 -- 다시 계산하지 않는다.
 *   - 확정 전이면 금액 없이 "확정 전" 줄로만 보인다 (합계에 안 듦). 0원으로 보이면 강사는 못 받는 줄로 읽는다.
 *   - 문서가 없으면 줄도 없다 (매출 인센을 쓰지 않는 강사 화면이 비지 않게).
 * 급여 달 = 수업이 일어난 달, 매출 인센 달 = 돈을 받은 달. 둘 다 YYYY-MM 이라 같은 달끼리 묶는다.
 */

const text = (value) => String(value ?? "").trim();
const int = (value) => Math.round(Number(value) || 0);
const won = (value) => `${int(value).toLocaleString("ko-KR")}원`;

export const EXTRA_STATE = Object.freeze({ CONFIRMED: "confirmed", WAITING: "waiting" });

function salesLines(monthDoc) {
  if (!monthDoc) return [];
  const status = text(monthDoc.status);
  if (status === "confirmed" && monthDoc.snapshot) {
    const snapshot = monthDoc.snapshot;
    const bracket = int(snapshot.bracketAmount);
    const ot = int(snapshot.otBonus);
    const lines = [{
      code: "sales_personal", label: "개인 매출 인센", amount: bracket + ot, state: EXTRA_STATE.CONFIRMED,
      note: `매출 ${won(snapshot.total)} · 구간 ${won(bracket)}${ot ? ` · OT 10% ${won(ot)}` : ""}`,
    }];
    if (int(snapshot.groupBase) || int(snapshot.groupBonus)) {
      lines.push({ code: "sales_group", label: "그룹 인센", amount: int(snapshot.groupBonus), state: EXTRA_STATE.CONFIRMED, note: `그룹 매출 ${won(snapshot.groupBase)}` });
    }
    if (int(snapshot.clawbackTotal)) {
      lines.push({ code: "sales_clawback", label: "지난 달 환불 환수", amount: -Math.abs(int(snapshot.clawbackTotal)), state: EXTRA_STATE.CONFIRMED, note: "지난 달에 받은 인센에서 돌려받는 몫" });
    }
    return lines;
  }
  const note = status === "submitted" ? "제출함 · FC · 대표 확정 전" : status === "reopened" ? "확정을 되돌림 · 다시 확정 전" : "작성 중 · 아직 제출 안 함";
  return [{ code: "sales_waiting", label: "매출 인센", amount: 0, state: EXTRA_STATE.WAITING, note }];
}

function fcLines(monthDoc) {
  if (!monthDoc) return [];
  const status = text(monthDoc.status);
  if (status === "confirmed" && monthDoc.snapshot) {
    const snapshot = monthDoc.snapshot;
    return [{ code: "fc_lessons", label: "FC 복지 수업료", amount: int(snapshot.amount), state: EXTRA_STATE.CONFIRMED, note: `진행 ${int(snapshot.done)}회 · 캔슬 ${int(snapshot.cancel)}회` }];
  }
  const done = int(monthDoc.done);
  const cancel = int(monthDoc.cancel);
  if (!done && !cancel) return [];
  return [{ code: "fc_waiting", label: "FC 복지 수업료", amount: 0, state: EXTRA_STATE.WAITING, note: `진행 ${done}회 · 캔슬 ${cancel}회 · 확정 전` }];
}

/**
 * 강사 한 명 · 한 달.
 * @param {{ salesMonth?: any, fcMonth?: any }} input
 */
export function extraPayOf({ salesMonth = null, fcMonth = null } = {}) {
  const lines = [...salesLines(salesMonth), ...fcLines(fcMonth)];
  const confirmed = lines.filter((line) => line.state === EXTRA_STATE.CONFIRMED);
  return {
    lines,
    confirmedTotal: confirmed.reduce((sum, line) => sum + line.amount, 0),
    waiting: lines.length - confirmed.length,
    has: lines.length > 0,
  };
}

/**
 * 센터 한 달 → 강사별. 계정을 바꾼 강사는 한 사람으로 (canonicalInstructorId, 급여 집계와 같은 함수).
 * @param {{ salesMonths?: any[], fcMonths?: any[], canonicalInstructorId?: (id: unknown) => string }} input
 * @returns {Map<string, ReturnType<typeof extraPayOf>>}
 */
export function extrasByInstructor({ salesMonths = [], fcMonths = [], canonicalInstructorId = (id) => text(id) } = {}) {
  const keyOf = (doc) => text(canonicalInstructorId(text(doc?.instructorId))) || text(doc?.instructorId);
  /** @type {Map<string, { salesMonth: any, fcMonth: any }>} */
  const docs = new Map();
  const slot = (key) => { if (!docs.has(key)) docs.set(key, { salesMonth: null, fcMonth: null }); return docs.get(key); };
  for (const doc of salesMonths || []) if (keyOf(doc)) slot(keyOf(doc)).salesMonth = doc;
  for (const doc of fcMonths || []) if (keyOf(doc)) slot(keyOf(doc)).fcMonth = doc;
  const result = new Map();
  for (const [key, value] of docs) {
    const extra = extraPayOf(value);
    if (extra.has) result.set(key, extra);
  }
  return result;
}

/** 여러 강사의 확정 합 · 확정 전 수. */
export function extrasTotal(map) {
  let confirmedTotal = 0;
  let waiting = 0;
  for (const extra of (map || new Map()).values()) { confirmedTotal += extra.confirmedTotal; waiting += extra.waiting; }
  return { confirmedTotal, waiting };
}
