/**
 * 강사 개인매출 · 그룹 인센 화면 판정 (2026-11-21 대표 승인 2단계). 계산 · 대조는 functions/shared/sales-incentive.mjs --
 * 여기는 화면이 쓰는 줄 · 문구 · 코드만. 순수 함수다.
 *
 *   강사 화면 (내 매출 인센)   : 자기 장부만 본다. 앱이 이 달 내 담당 발급 · 세션업을 후보로 채워 두고, 강사는 넣기 · 구분 · OT · 반반만.
 *   FC · 대표 화면 (매출 인센) : 강사별로 두 장부를 맞춰 보고, 같으면 확정 (서버). FC 가 확정하면 대표님에게 알림이 간다.
 */
import {
  CONFIRM_NOTICE_HINT, PAIR, SALES_KIND, SALES_SIDE, cheerLine, entryProblems, isRefund, monthStatement, pairSalesEntries, suggestionsFor,
} from "../../../functions/shared/sales-incentive.mjs";

const text = (value) => String(value ?? "").trim();
const KST_MS = 9 * 3600000;

export { CONFIRM_NOTICE_HINT };

/** 화면이 고르는 구분 (순서 = 칩 순서). */
export const SALES_KIND_CHOICES = Object.freeze([
  SALES_KIND.OT, SALES_KIND.CONVERSION, SALES_KIND.SESSION_UP, SALES_KIND.REPURCHASE, SALES_KIND.GROUP, SALES_KIND.REFUND, SALES_KIND.GROUP_REFUND,
]);

const millisOf = (value) => {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return new Date(value).getTime();
};
/** 한국 날짜 "YYYY-MM-DD". */
export const kstDate = (value) => {
  const at = millisOf(value);
  return Number.isFinite(at) ? new Date(at + KST_MS).toISOString().slice(0, 10) : "";
};

/** 달 문서 → 상태 칩. */
export function monthStatusView(monthDoc) {
  const status = text(monthDoc?.status);
  if (status === "confirmed") return { code: "confirmed", label: "확정됨", tone: "good" };
  if (status === "reopened") return { code: "reopened", label: `되돌림${text(monthDoc?.reopenReason) ? ` · ${text(monthDoc.reopenReason)}` : ""}`, tone: "warn" };
  if (status === "submitted") return { code: "submitted", label: "제출함", tone: "muted" };
  return { code: "draft", label: "작성 중", tone: "muted" };
}

/** 서버가 남긴 마지막 대조(lastCheck) → 한 줄. 없으면 null. */
export function lastCheckLine(monthDoc) {
  const check = monthDoc?.lastCheck;
  if (!check || text(monthDoc?.status) === "confirmed") return null;
  const parts = [];
  if (check.differs) parts.push(`다름 ${check.differs}건`);
  if (check.instructorOnly) parts.push(`강사만 넣음 ${check.instructorOnly}건`);
  if (check.officeOnly) parts.push(`FC · 대표만 넣음 ${check.officeOnly}건`);
  if (!parts.length) return null;
  return { code: "sides_differ", text: `두 장부가 달라 아직 확정되지 않았어요 · ${parts.join(" · ")}`, entryIds: new Set([...(check.instructorEntryIds || []), ...(check.officeEntryIds || [])]) };
}

/**
 * 후보 → 새 줄의 처음 값. 구분은 세션업이면 채우고, 발급이면 비워 둔다 (전환 · 재등록 · OT 는 강사가 안다).
 * @param {any} suggestion  suggestionsFor 의 한 줄
 */
export function entryFromSuggestion(suggestion, { side, instructorId, month }) {
  return {
    instructorId: text(instructorId), side, month: text(month),
    paidOn: kstDate(suggestion.occurredAt) || `${text(month)}-01`,
    kind: text(suggestion.kind), amount: Math.round(Number(suggestion.amount) || 0), share: 1, ot: false,
    clientId: text(suggestion.clientId), memberLabel: "", productLabel: "", recordId: text(suggestion.recordId), passId: text(suggestion.passId),
    refundOfMonth: "", note: "",
  };
}

/** 빈 줄 (앱 밖 결제 · 그룹 회원). */
export const blankEntry = ({ side, instructorId, month, kind = "" }) => ({
  instructorId: text(instructorId), side, month: text(month), paidOn: `${text(month)}-01`, kind, amount: 0, share: 1, ot: false,
  clientId: "", memberLabel: "", productLabel: "", recordId: "", passId: "", refundOfMonth: "", note: "",
});

/** 저장 전 막을 것 → 사용자 문구 (코드 함께). */
const PROBLEM_TEXT = Object.freeze({
  month_invalid: "달이 맞지 않아요",
  kind_required: "구분을 골라 주세요",
  amount_invalid: "받은 금액(현금가)을 1원 이상 적어 주세요",
  share_invalid: "반반 여부를 다시 골라 주세요",
  member_required: "회원을 고르거나 이름을 적어 주세요",
  side_required: "어느 장부인지 알 수 없어요",
  refund_month_invalid: "환불한 결제의 달을 다시 골라 주세요",
  refund_month_future: "환불한 결제의 달은 이번 달보다 뒤일 수 없어요",
  ot_not_for_group: "그룹 수강권에는 OT 인센이 없어요",
  paid_on_month: "결제일이 이 달이 아니에요",
});
export function entryErrors(entry) {
  const problems = entryProblems(entry);
  if (text(entry?.paidOn).slice(0, 7) !== text(entry?.month)) problems.push("paid_on_month");
  return problems.map((code) => ({ code, text: PROBLEM_TEXT[code] || code }));
}

/**
 * 강사 화면 한 장.
 * @param {{ entries: any[], priorEntries?: any[], records: any[], instructorId: string, month: string, monthDoc: any, canonicalInstructorId?: (id: unknown) => string }} input
 *   entries = 이 달 내 장부, priorEntries = 환불이 가리키는 지난 달 내 장부, records = salesRecordsOf(그 달)
 */
export function mySalesView({ entries, priorEntries = [], records, instructorId, month, monthDoc, canonicalInstructorId }) {
  const mine = (entries || []).filter((entry) => text(entry.side) === SALES_SIDE.INSTRUCTOR);
  const statement = monthStatement({ entries: [...mine, ...(priorEntries || [])], month });
  const check = lastCheckLine(monthDoc);
  return {
    statement,
    cheer: cheerLine(statement),
    status: monthStatusView(monthDoc),
    locked: text(monthDoc?.status) === "confirmed",
    check,
    rows: mine.slice().sort((left, right) => text(right.paidOn).localeCompare(text(left.paidOn))).map((entry) => ({ ...entry, flagged: Boolean(check?.entryIds.has(text(entry.id))) })),
    suggestions: suggestionsFor({ instructorId, records, claims: mine, canonicalInstructorId }),
  };
}

/**
 * FC · 대표 화면의 강사 줄들.
 * @param {{ instructors: any[], entriesByInstructor: Map<string, any[]>, monthsByInstructor: Map<string, any>, month: string, viewerUid: string, alsoInclude?: Set<string> }} input
 *   alsoInclude = 매출은 없어도 줄에 세울 강사 (FC 복지 수업만 넣은 강사)
 */
export function salesBoardRows({ instructors, entriesByInstructor, monthsByInstructor, month, viewerUid, alsoInclude = new Set() }) {
  return (instructors || []).map((member) => {
    const instructorId = text(member.userId);
    const entries = entriesByInstructor.get(instructorId) || [];
    const monthDoc = monthsByInstructor.get(instructorId) || null;
    const mine = entries.filter((entry) => text(entry.side) === SALES_SIDE.INSTRUCTOR);
    const office = entries.filter((entry) => text(entry.side) === SALES_SIDE.OFFICE);
    const pairing = pairSalesEntries(entries);
    const statement = monthStatement({ entries: mine, month });
    const officeStatement = monthStatement({ entries: office, month });
    return {
      instructorId,
      name: text(member.displayName) || instructorId,
      active: text(member.status || "active") === "active",
      monthDoc,
      status: monthStatusView(monthDoc),
      confirmed: text(monthDoc?.status) === "confirmed",
      mineCount: mine.length,
      officeCount: office.length,
      mineTotal: statement.total + statement.groupBase,
      officeTotal: officeStatement.total + officeStatement.groupBase,
      pairing,
      statement: text(monthDoc?.status) === "confirmed" && monthDoc?.snapshot ? { ...statement, ...monthDoc.snapshot } : statement,
      /* 자기 매출은 자기가 확정하지 못한다 -- 버튼을 처음부터 잠근다 (서버도 막는다). */
      ownSales: instructorId === text(viewerUid),
      attention: pairing.pairs.filter((pair) => pair.code !== PAIR.AGREED).length,
    };
  }).filter((row) => row.mineCount || row.officeCount || row.monthDoc || alsoInclude.has(row.instructorId))
    .sort((left, right) => Number(left.confirmed) - Number(right.confirmed) || right.attention - left.attention || left.name.localeCompare(right.name, "ko"));
}

/** 확정 거절 → 사용자 문구 (원본 코드 함께). */
export function confirmFailureText(error) {
  const details = error?.details || {};
  const reason = text(details.reason || error?.message || error?.code || "unknown").replace(/^functions\//, "");
  if (reason === "sides_differ") {
    const parts = [];
    if (details.differs) parts.push(`다름 ${details.differs}건`);
    if (details.instructor_only) parts.push(`강사만 넣음 ${details.instructor_only}건`);
    if (details.office_only) parts.push(`FC · 대표만 넣음 ${details.office_only}건`);
    return { kind: "invalid_request", code: reason, text: `두 장부가 달라 확정하지 못했어요 · ${parts.join(" · ")} (코드 ${reason})` };
  }
  const known = {
    own_sales: "자기 매출은 다른 사람이 확정해야 해요",
    out_of_scope: "맡은 지점 강사가 아니에요",
    not_confirmer: "확정은 FC · 대표 · 총괄만 할 수 있어요",
    already_confirmed: "이미 확정된 달이에요",
    target_required: "강사 · 달을 다시 골라 주세요",
  };
  if (known[reason]) return { kind: reason === "already_confirmed" ? "data_conflict" : "permission", code: reason, text: `${known[reason]} (코드 ${reason})` };
  if (/unavailable|deadline|network/.test(reason)) return { kind: "network", code: reason, text: `연결이 불안정해 확정하지 못했어요. 다시 눌러 주세요 (코드 ${reason})` };
  return { kind: "unknown", code: reason, text: `확정하지 못했어요 (코드 ${reason})` };
}

/** 줄 한 개의 짧은 설명 (목록용). 회원 이름은 화면이 붙인다. */
export function entryLine(entry, kindLabels) {
  const bits = [kindLabels[text(entry.kind)] || "구분 없음", `${Math.round(Number(entry.amount) || 0).toLocaleString("ko-KR")}원`];
  if (Number(entry.share) === 0.5) bits.push("반반");
  if (entry.ot === true) bits.push("OT");
  if (isRefund(entry) && text(entry.refundOfMonth)) bits.push(`${Number(text(entry.refundOfMonth).slice(5, 7))}월 결제 환불`);
  return bits.join(" · ");
}
