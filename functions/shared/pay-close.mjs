/**
 * 서버 급여 확정의 계산 (2026-11-22 외부 검토 2차: "급여 확정값을 브라우저가 결정" → 서버가 원자료로 다시 계산).
 *
 * 화면(payroll-repository.js 의 summarizeOrganizationPay)과 **같은 규칙**으로 강사별 수업료를 다시 센다:
 *   - 원장 항목 중 차감 · 보정만, 그 센터 것만, 그 달(한국 시각) 안의 것만
 *   - 금액 = −delta × unitPrice (차감 +단가, 보정 −단가)
 *   - 심사용 회원 항목은 뺀다, 계정을 바꾼 강사는 지금 uid 로 합친다
 *   - 그룹 급여 = 풀방 횟수 × 풀방 단가 + 빈방 횟수 × 25,000
 * 같은지는 tests/payroll/pay-close.test.js 가 두 계산을 같은 원장에 돌려 본다. 순수 함수다.
 */
import { extrasByInstructor } from "./extra-pay.mjs";
import { adjustmentsOf, payStatementOf, statementSnapshot, taxTypeOf } from "./pay-statement.mjs";

const text = (value) => String(value ?? "").trim();
const KST_OFFSET_MS = 9 * 3600000;
export const PAYROLL_LEDGER_TYPES = Object.freeze(["deduct", "correction"]);
export const GROUP_EMPTY_ROOM_RATE = 25000;

/** "2026-11" → 한국 시각 11월 1일 0시 ~ 12월 1일 0시 (서버는 UTC 로 돈다 -- 기기 시간대와 상관없이). */
export function kstMonthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(text(month));
  if (!match) throw new Error("Invalid month");
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  return { start: new Date(Date.UTC(year, index, 1) - KST_OFFSET_MS), end: new Date(Date.UTC(year, index + 1, 1) - KST_OFFSET_MS) };
}

const millisOf = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
};

/**
 * 강사별 수업료 (원장 + 그룹).
 * @param {{ organizationId: string, month: string, entries: any[], groupRows?: any[], excludedClientIds?: Set<string>, canonicalInstructorId?: (id: unknown) => string }} input
 * @returns {Map<string, number>}
 */
export function lessonTotalsByInstructor({ organizationId, month, entries, groupRows = [], excludedClientIds = new Set(), canonicalInstructorId = (id) => text(id) }) {
  const { start, end } = kstMonthRange(month);
  const totals = new Map();
  const add = (id, amount) => totals.set(id, (totals.get(id) || 0) + amount);
  for (const entry of entries || []) {
    if (!PAYROLL_LEDGER_TYPES.includes(text(entry?.type)) || text(entry?.organizationId) !== text(organizationId)) continue;
    const at = millisOf(entry.occurredAt);
    if (!Number.isFinite(at) || at < start.getTime() || at >= end.getTime()) continue;
    if (excludedClientIds.has(text(entry.clientId))) continue;
    add(text(canonicalInstructorId(entry.instructorId)), -(Number(entry.delta) || 0) * (Number(entry.unitPrice) || 0));
  }
  for (const row of groupRows || []) {
    const count = (Number(row.fullCount) || 0) + (Number(row.emptyCount) || 0);
    if (!count) continue;
    add(text(canonicalInstructorId(row.instructorId)), (Number(row.fullCount) || 0) * (Number(row.fullRate) || 0) + (Number(row.emptyCount) || 0) * GROUP_EMPTY_ROOM_RATE);
  }
  return totals;
}

/**
 * 확정 대조 기록 (외부 검토: "급여 대상 차감 건수 · 금액과 명세에 반영된 금액의 대조를 남기라"). lessonTotalsByInstructor 와 같은 거르기.
 * @param {{ organizationId: string, month: string, entries: any[], groupRows?: any[], excludedClientIds?: Set<string> }} input
 */
export function lessonSourceSummary({ organizationId, month, entries, groupRows = [], excludedClientIds = new Set() }) {
  const { start, end } = kstMonthRange(month);
  const out = { deducts: 0, corrections: 0, ledgerAmount: 0, excludedDemo: 0, groupRows: 0, groupAmount: 0 };
  for (const entry of entries || []) {
    if (!PAYROLL_LEDGER_TYPES.includes(text(entry?.type)) || text(entry?.organizationId) !== text(organizationId)) continue;
    const at = millisOf(entry.occurredAt);
    if (!Number.isFinite(at) || at < start.getTime() || at >= end.getTime()) continue;
    if (excludedClientIds.has(text(entry.clientId))) { out.excludedDemo += 1; continue; }
    if (text(entry.type) === "deduct") out.deducts += 1; else out.corrections += 1;
    out.ledgerAmount += -(Number(entry.delta) || 0) * (Number(entry.unitPrice) || 0);
  }
  for (const row of groupRows || []) {
    const count = (Number(row.fullCount) || 0) + (Number(row.emptyCount) || 0);
    if (!count) continue;
    out.groupRows += 1;
    out.groupAmount += (Number(row.fullCount) || 0) * (Number(row.fullRate) || 0) + (Number(row.emptyCount) || 0) * GROUP_EMPTY_ROOM_RATE;
  }
  return out;
}

/**
 * 확정 명세 전부. 줄 = 수업료가 있는 강사 + 수업료 외가 있는 강사 + 조정이 있는 강사.
 * @param {{ lessons: Map<string, number>, salesMonths?: any[], fcMonths?: any[], adjustments?: any[], tax?: any, canonicalInstructorId?: (id: unknown) => string }} input
 */
export function buildPayClose({ lessons, salesMonths = [], fcMonths = [], adjustments = [], tax = null, canonicalInstructorId = (id) => text(id) }) {
  const extras = extrasByInstructor({ salesMonths, fcMonths, canonicalInstructorId });
  const ids = new Set([
    ...lessons.keys(), ...extras.keys(),
    ...(adjustments || []).filter((item) => !item?.canceledAt).map((item) => text(canonicalInstructorId(item.instructorId))),
  ].filter(Boolean));
  const statements = [...ids].sort().map((instructorId) => {
    const statement = payStatementOf({
      lessons: lessons.get(instructorId) || 0,
      extrasConfirmed: extras.get(instructorId)?.confirmedTotal || 0,
      adjustments: adjustmentsOf(adjustments, instructorId, canonicalInstructorId),
      taxType: taxTypeOf(tax, instructorId),
    });
    return { instructorId, snapshot: statementSnapshot(statement) };
  });
  const totals = statements.reduce((sum, item) => ({
    gross: sum.gross + item.snapshot.gross, tax: sum.tax + item.snapshot.incomeTax + item.snapshot.localTax, net: sum.net + item.snapshot.net, instructors: sum.instructors + 1,
  }), { gross: 0, tax: 0, net: 0, instructors: 0 });
  return { statements, totals, waiting: [...extras.values()].reduce((sum, extra) => sum + extra.waiting, 0) };
}
