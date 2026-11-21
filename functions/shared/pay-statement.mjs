/**
 * 강사 급여 명세 (2026-11-21 대표 승인): 수업료 + 수업료 외(확정된 매출 인센 · FC 수업료) + 대표 조정 = 세전 → 세금 → 실수령.
 *
 *   - 급여일: 일한 달의 **다음 달 15일** (대표: "확정 매달 급여는 15일에 나감").
 *   - 세금: 기본 3.3% (사업소득 원천징수). 소득세 3% 는 10원 미만 버림, 지방소득세는 소득세의 10% 를 10원 미만 버림
 *     (국세청 계산 방식). 강사별로 "공제 없음" 을 고를 수 있다 (4대보험 직원 등) -- payrollSettings/tax.noTaxIds.
 *   - 조정: 대표 · 총괄만 넣는 + / − 와 사유 (대표: "강사 급여가 3만 원 4만 원 차이 날 수도 있어서 대표급만 추가 · 빼기").
 *   - 급여 확정(payMonths/{달}.status == "closed") 뒤에는 그때 남긴 명세(payStatements)가 강사 화면의 숫자다.
 * 순수 함수다.
 */

const text = (value) => String(value ?? "").trim();
const int = (value) => Math.round(Number(value) || 0);
const floorTen = (value) => Math.floor(value / 10) * 10;

export const TAX_TYPE = Object.freeze({ FREELANCE: "3.3", NONE: "none" });
export const TAX_TYPE_LABELS = Object.freeze({ [TAX_TYPE.FREELANCE]: "3.3% (소득세 3% · 지방세 0.3%)", [TAX_TYPE.NONE]: "공제 없음 (4대보험 등은 따로)" });
/** 맨 아래 숫자의 이름. 공제 없음 직원은 이 숫자가 실수령이 아니다 -- 4대보험 · 소득세는 외부 급여에서 뗀다 (2026-11-22 검토 지적). */
export const NET_LABELS = Object.freeze({ [TAX_TYPE.FREELANCE]: "실수령 (세후)", [TAX_TYPE.NONE]: "지급액 (공제 전 · 공제는 따로)" });
export const PAY_ADJUSTMENT_MAX = 10000000;
export const PAY_ADJUSTMENT_REASON_MAX = 100;

/**
 * 세금. 세전이 0 이하면 0.
 * @param {number} gross
 * @param {string} [taxType]
 */
export function withholdingOf(gross, taxType = TAX_TYPE.FREELANCE) {
  const base = int(gross);
  if (taxType === TAX_TYPE.NONE || base <= 0) return { incomeTax: 0, localTax: 0, total: 0 };
  const incomeTax = floorTen(base * 0.03);
  const localTax = floorTen(incomeTax * 0.1);
  return { incomeTax, localTax, total: incomeTax + localTax };
}

/** 강사의 세금 종류. 설정에 "공제 없음" 으로 올라 있지 않으면 3.3%. */
export function taxTypeOf(settings, instructorId) {
  const ids = Array.isArray(settings?.noTaxIds) ? settings.noTaxIds.map(text) : [];
  return ids.includes(text(instructorId)) ? TAX_TYPE.NONE : TAX_TYPE.FREELANCE;
}

/** 취소한 조정인가. */
export const isCanceled = (adjustment) => Boolean(adjustment?.canceledAt || text(adjustment?.cancelReason));

/** 일한 달 → 급여일 (다음 달 15일). */
export function paydayOf(month) {
  const [year, monthNumber] = text(month).split("-").map(Number);
  if (!year || !monthNumber) return { date: "", label: "" };
  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  return { date: `${nextYear}-${String(nextMonth).padStart(2, "0")}-15`, label: `${nextMonth}월 15일` };
}

/** "11월분 · 12월 15일 지급". */
export function payPeriodLabel(month) {
  const monthNumber = Number(text(month).slice(5, 7));
  return monthNumber ? `${monthNumber}월분 · ${paydayOf(month).label} 지급` : "";
}

/** 그 강사 · 그 달의 조정만, 오래된 것부터. */
export function adjustmentsOf(adjustments, instructorId, canonicalInstructorId = (id) => text(id)) {
  const key = text(instructorId);
  const millis = (value) => (typeof value?.toMillis === "function" ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value) || 0);
  return (adjustments || [])
    .filter((item) => text(canonicalInstructorId(text(item?.instructorId))) === key || text(item?.instructorId) === key)
    .slice().sort((left, right) => millis(left.createdAt) - millis(right.createdAt));
}

/**
 * 명세 한 장.
 * @param {{ lessons: number, extrasConfirmed?: number, adjustments?: any[], taxType?: string }} input
 */
export function payStatementOf({ lessons, extrasConfirmed = 0, adjustments = [], taxType = TAX_TYPE.FREELANCE }) {
  /* 취소한 조정은 남겨 두되 더하지 않는다 (2026-11-22: 지우지 않고 취소 기록). */
  const adjustTotal = (adjustments || []).filter((item) => !isCanceled(item)).reduce((sum, item) => sum + int(item?.amount), 0);
  const gross = int(lessons) + int(extrasConfirmed) + adjustTotal;
  const tax = withholdingOf(gross, taxType);
  return { lessons: int(lessons), extras: int(extrasConfirmed), adjustTotal, adjustments: adjustments || [], gross, taxType, tax, net: gross - tax.total };
}

/** 확정 때 남기는 숫자 (규칙 payStatementOk 와 같은 모양). */
export function statementSnapshot(statement) {
  return {
    lessons: int(statement.lessons), extras: int(statement.extras), adjustTotal: int(statement.adjustTotal), gross: int(statement.gross),
    incomeTax: int(statement.tax?.incomeTax), localTax: int(statement.tax?.localTax), net: int(statement.net),
    taxType: statement.taxType === TAX_TYPE.NONE ? TAX_TYPE.NONE : TAX_TYPE.FREELANCE,
  };
}

/**
 * 확정된 달의 내 명세가 지금 회차의 것인가 -- 되돌린 뒤 다시 확정하면 회차가 오른다. 예전 회차 명세는 숫자의 근거가 아니다.
 * 회차가 없는 예전 확정(서버 확정 전)은 그대로 쓴다.
 */
export function statementOfRevision(statementDoc, payMonth) {
  if (!statementDoc) return null;
  const want = Number(payMonth?.revision || 0);
  if (!want) return statementDoc;
  return Number(statementDoc.revision || 0) === want ? statementDoc : null;
}

/** 남겨 둔 숫자 → 명세 모양 (화면이 같은 그릇으로 그린다). */
export function statementFromSnapshot(snapshot, adjustments = []) {
  const incomeTax = int(snapshot?.incomeTax);
  const localTax = int(snapshot?.localTax);
  return {
    lessons: int(snapshot?.lessons), extras: int(snapshot?.extras), adjustTotal: int(snapshot?.adjustTotal), adjustments,
    gross: int(snapshot?.gross), taxType: snapshot?.taxType === TAX_TYPE.NONE ? TAX_TYPE.NONE : TAX_TYPE.FREELANCE,
    tax: { incomeTax, localTax, total: incomeTax + localTax }, net: int(snapshot?.net),
  };
}

/** 급여 달 상태 → 칩. */
export function payMonthStatusView(payMonth) {
  const status = text(payMonth?.status);
  if (status === "paid") return { code: "paid", label: "지급 완료", tone: "good", locked: true };
  if (status === "closed") return { code: "closed", label: "급여 확정", tone: "good", locked: true };
  if (status === "reopened") return { code: "reopened", label: `확정 되돌림${text(payMonth?.reopenReason) ? ` · ${text(payMonth.reopenReason)}` : ""}`, tone: "warn", locked: false };
  return { code: "open", label: "집계 중", tone: "muted", locked: false };
}

/** 조정 입력 → 막을 것 (코드 함께). */
export function adjustmentErrors({ amount, reason }) {
  const problems = [];
  const value = int(amount);
  if (!value) problems.push({ code: "adjust_amount_required", text: "금액을 적어 주세요 (0원은 넣지 않아요)" });
  else if (Math.abs(value) > PAY_ADJUSTMENT_MAX) problems.push({ code: "adjust_amount_too_large", text: "한 번에 1,000만 원까지 조정할 수 있어요" });
  const why = text(reason);
  if (!why) problems.push({ code: "adjust_reason_required", text: "사유를 적어 주세요 -- 강사에게도 보여요" });
  else if (why.length > PAY_ADJUSTMENT_REASON_MAX) problems.push({ code: "adjust_reason_too_long", text: `사유는 ${PAY_ADJUSTMENT_REASON_MAX}자까지예요` });
  return problems;
}

/* 급여 명세 CSV (2026-11-22 외부 검토 2차: 화면 총액과 내보낸 지급 자료가 같아야 한다). 한 줄이 강사 한 명. */
const csvText = (value) => {
  const raw = String(value ?? "");
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};
/**
 * @param {{ month: string, status: string, revision?: number, rows: { name: string, statement: any }[] }} input
 */
export function payStatementCsv({ month, status, revision = 0, rows }) {
  const head = ["월", "지급일", "상태", "회차", "강사", "수업료", "수업료 외", "조정", "세전", "소득세", "지방세", "공제 합", "세금 종류", "실수령(공제 없음은 지급액)"];
  const lines = [head.join(",")];
  for (const { name, statement } of rows || []) {
    if (!statement) continue;
    lines.push([month, paydayOf(month).date, status, revision || "", name, statement.lessons, statement.extras, statement.adjustTotal, statement.gross,
      statement.tax.incomeTax, statement.tax.localTax, statement.tax.total, statement.taxType === TAX_TYPE.NONE ? "공제 없음" : "3.3%", statement.net].map(csvText).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}
