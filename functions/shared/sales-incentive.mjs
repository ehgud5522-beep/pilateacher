/**
 * 강사 개인매출 인센 (2026-11-21 대표 결정). 앱 · 서버가 이 파일 하나를 같이 쓴다 -- 따로 세면 강사 화면과
 * 대표 화면의 금액이 갈라진다.
 *
 * ── 대표 결정 (기획안 https://claude.ai/artifact/A6Y72EhG13oSxANcm4Xsu5 에 답한 것) ──
 *  1. 구간은 **정액**: 400만 이상 500만 미만이면 490만이어도 400만 구간 금액(16만). ("400인데 490이여도 400인센")
 *  2. OT 결제도 구간 합계에 들어가고, 거기에 그 실매출의 10% 를 더 준다
 *  3. 강사 · FC · 대표(총괄)가 매출을 입력한다 -- **두 쪽이 따로** (아래 "두 쪽 대조", 같은 날 대표: "강사 입력 + FC · 대표 입력이 같아야 확정")
 *  4. **강사가 낸 매출만** 입력한다. FC 가 대신 상담했으면 그 결제는 강사에게 반만 인정된다 (반반 매출, share 0.5)
 *  5. 확정은 FC · 대표 · 총괄. **강사 쪽과 사무실 쪽이 한 줄도 빠짐없이 같을 때만** -- 서버(confirmSalesMonth)가 다시 맞춰 본다
 *  6. **실제로 받은 돈만** 입력한다. 잔금은 받을지 모르므로 받은 달에 새 줄로
 *  7. 환불은 환불 줄로 넣는다. 이미 인센을 받은 달의 결제를 환불하면, 그만큼 덜 받았어야 할 인센(환수)을 다음 달에 알린다
 *  8. 강사에게 "N원 더 하면 다음 구간 인센 M원" 을 보여 주고 응원한다
 *  9. 그룹 인센: 강사가 판 그룹 수강권은 현금가의 0.5% (같은 날 대표). 두 장부가 같아야 지급되는 것도 같다.
 *     개인 인센 구간 합계에는 넣지 않는다 -- 그룹은 따로 0.5% 다.
 *     그룹 회원은 필라티쳐 명부에 없다 (대표: "회원은 그룹이라서 필라티쳐에는 조회가 안됨") -- 이름을 글자로 넣고(memberLabel),
 *     앱 기록 대조는 없이 두 장부 대조로만 확인한다. 이름은 띄어쓰기 · "회원" · "님" 을 빼고 맞춘다.
 *
 * 금액은 모두 **현금가**(부가세 뺀 공급가액): 현금은 그대로, 카드 · 이체 · 기타결제는 ÷1.1 (deduction-pricing.mjs 와 같은 규칙).
 * 순수 함수다. 문구 · 기준 숫자 · 판정 코드는 여기서만 정한다.
 */

const text = (value) => String(value ?? "").trim();
const intOf = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
const MONTH = /^\d{4}-\d{2}$/;

/** 엑셀 "개인매출 인센 기준표" 그대로. [실매출 이상, 인센 금액]. 1,000만 위로는 100만 그대로. */
export const SALES_BRACKETS = Object.freeze([
  Object.freeze([4000000, 160000]),
  Object.freeze([5000000, 250000]),
  Object.freeze([6000000, 360000]),
  Object.freeze([7000000, 490000]),
  Object.freeze([8000000, 640000]),
  Object.freeze([9000000, 810000]),
  Object.freeze([10000000, 1000000]),
]);
export const OT_BONUS_RATE = 0.1;
/** 그룹 수강권 인센 -- 현금가의 0.5%. */
export const GROUP_BONUS_RATE = 0.005;
/** FC 가 대신 상담한 결제 -- 강사에게 반만. */
export const HALF_SHARE = 0.5;
export const SALES_SHARES = Object.freeze([1, HALF_SHARE]);
/** 한 줄 금액 상한 (오타 방지 · 규칙과 같은 값). */
export const SALES_AMOUNT_MAX = 100000000;

export const SALES_KIND = Object.freeze({
  OT: "ot",
  CONVERSION: "conversion",
  SESSION_UP: "session_up",
  REPURCHASE: "repurchase",
  REFUND: "refund",
  GROUP: "group",
  GROUP_REFUND: "group_refund",
});
export const SALES_KIND_LABELS = Object.freeze({
  [SALES_KIND.OT]: "OT",
  [SALES_KIND.CONVERSION]: "전환",
  [SALES_KIND.SESSION_UP]: "세션업",
  [SALES_KIND.REPURCHASE]: "재등록",
  [SALES_KIND.REFUND]: "환불",
  [SALES_KIND.GROUP]: "그룹",
  [SALES_KIND.GROUP_REFUND]: "그룹 환불",
});
export const SALES_KINDS = Object.freeze(/** @type {string[]} */ (Object.values(SALES_KIND)));

/** 누가 넣은 줄인가. 강사 본인이 넣은 줄과 FC · 대표 · 총괄이 넣은 줄은 서로 맞춰 보는 두 장부다. */
export const SALES_SIDE = Object.freeze({ INSTRUCTOR: "instructor", OFFICE: "office" });
export const SALES_SIDES = Object.freeze(/** @type {string[]} */ (Object.values(SALES_SIDE)));

export const isSalesMonth = (month) => MONTH.test(text(month));
const REFUND_KINDS = /** @type {string[]} */ ([SALES_KIND.REFUND, SALES_KIND.GROUP_REFUND]);
const GROUP_KINDS = /** @type {string[]} */ ([SALES_KIND.GROUP, SALES_KIND.GROUP_REFUND]);
export const isRefund = (entry) => REFUND_KINDS.includes(text(entry?.kind));
/** 그룹 수강권 줄(판매 · 환불). 개인 구간 합계에 들지 않고 0.5% 만 받는다. */
export const isGroup = (entry) => GROUP_KINDS.includes(text(entry?.kind));

/** 한 줄이 인센 합계에 더하는 금액. 반반이면 반(원 단위 반올림), 환불이면 음수. */
export function creditOf(entry) {
  const amount = Math.max(0, intOf(entry?.amount));
  const share = Number(entry?.share) === HALF_SHARE ? HALF_SHARE : 1;
  const credited = Math.round(amount * share);
  return isRefund(entry) ? -credited : credited;
}

/** 정액 구간 인센. 합계가 첫 구간 아래면 0. */
export function bracketOf(total) {
  const value = intOf(total);
  let found = null;
  for (const [threshold, amount] of SALES_BRACKETS) if (value >= threshold) found = { threshold, amount };
  return found || { threshold: 0, amount: 0 };
}

/** 다음 구간. 맨 위 구간이면 null. */
export function nextBracketOf(total) {
  const value = intOf(total);
  const current = bracketOf(value);
  const next = SALES_BRACKETS.find(([threshold]) => threshold > value);
  if (!next) return null;
  return { threshold: next[0], amount: next[1], needed: next[0] - value, gain: next[1] - current.amount };
}

/**
 * 한 달의 인센 (환수 빼기 전). entries = 그 달 줄들 (이 달 결제 + 이 달 결제를 무르는 환불).
 * OT 10% 는 OT 로 표시한 줄의 인정 금액에 붙는다 -- 환불 줄도 OT 면 그만큼 줄어든다.
 */
export function incentiveOf(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const personal = list.filter((entry) => !isGroup(entry));
  const total = Math.max(0, personal.reduce((sum, entry) => sum + creditOf(entry), 0));
  const otBase = Math.max(0, personal.filter((entry) => entry.ot === true).reduce((sum, entry) => sum + creditOf(entry), 0));
  const groupBase = Math.max(0, list.filter(isGroup).reduce((sum, entry) => sum + creditOf(entry), 0));
  const bracket = bracketOf(total);
  const otBonus = Math.round(otBase * OT_BONUS_RATE);
  const groupBonus = Math.round(groupBase * GROUP_BONUS_RATE);
  return { total, otBase, groupBase, bracket, otBonus, groupBonus, incentive: bracket.amount + otBonus + groupBonus };
}

/**
 * 강사 한 명 · 한 달의 명세.
 *
 * 환불은 두 갈래다:
 *  - 이 달 결제를 무르는 환불(refundOfMonth 가 비었거나 이 달) -- 이 달 합계에서 바로 뺀다
 *  - 지난 달 결제를 무르는 환불 -- 그 달은 이미 지급했으므로 고치지 않고, 그 달 인센이 얼마나 줄었어야 하는지(환수)를
 *    이 달 명세에 적는다. 그 달 줄들(entries 에 함께 넘긴다)로 다시 계산해 차이를 낸다.
 *
 * @param {{ entries: any[], month: string }} input  entries = 그 강사의 줄 (이 달 + 환수 계산에 필요한 지난 달)
 */
export function monthStatement({ entries, month }) {
  const key = text(month);
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const thisMonth = list.filter((entry) => text(entry.month) === key);
  /* 그 달 결제를 무르는 환불인가 (refundOfMonth 가 비었거나 그 달). */
  const refundsOwnMonth = (entry, of) => isRefund(entry) && (!text(entry.refundOfMonth) || text(entry.refundOfMonth) >= of);
  const ownRefund = (entry) => refundsOwnMonth(entry, key);
  const counted = thisMonth.filter((entry) => !isRefund(entry) || ownRefund(entry));
  const base = incentiveOf(counted);

  const priorRefunds = thisMonth.filter((entry) => isRefund(entry) && !ownRefund(entry));
  const byOriginal = new Map();
  for (const refund of priorRefunds) {
    const original = text(refund.refundOfMonth);
    if (!byOriginal.has(original)) byOriginal.set(original, []);
    byOriginal.get(original).push(refund);
  }
  const clawbacks = [...byOriginal.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([original, refunds]) => {
    const originalEntries = list.filter((entry) => text(entry.month) === original && (!isRefund(entry) || refundsOwnMonth(entry, original)));
    const paid = incentiveOf(originalEntries).incentive;
    const corrected = incentiveOf([...originalEntries, ...refunds]).incentive;
    return { month: original, refunded: refunds.reduce((sum, entry) => sum - creditOf(entry), 0), amount: Math.max(0, paid - corrected) };
  });
  const clawbackTotal = clawbacks.reduce((sum, item) => sum + item.amount, 0);
  return {
    month: key,
    ...base,
    sales: counted.filter((entry) => !isRefund(entry) && !isGroup(entry)).reduce((sum, entry) => sum + creditOf(entry), 0),
    refunds: counted.filter(isRefund).reduce((sum, entry) => sum - creditOf(entry), 0),
    halfCount: counted.filter((entry) => Number(entry.share) === HALF_SHARE).length,
    clawbacks,
    clawbackTotal,
    /* 이 달 받을 금액. 환수가 더 크면 음수 -- "다음 달로 넘겨 뺄 금액" 으로 보여 준다. */
    payout: base.incentive - clawbackTotal,
    next: nextBracketOf(base.total),
  };
}

const manwon = (won) => {
  const value = Math.max(0, intOf(won));
  if (value >= 10000 && value % 10000 === 0) return `${(value / 10000).toLocaleString("ko-KR")}만 원`;
  if (value >= 10000) return `${(Math.round(value / 1000) / 10).toLocaleString("ko-KR")}만 원`;
  return `${value.toLocaleString("ko-KR")}원`;
};
export const formatManwon = manwon;

/**
 * 강사에게 보여 줄 응원 한 줄 (대표 결정 8). 숫자는 계산과 같은 값만 쓴다. 코드는 화면 끝에 함께.
 * @returns {{ code: string, text: string }}
 */
export function cheerLine(statement) {
  const total = intOf(statement?.total);
  const next = statement?.next;
  if (!next) return { code: "cheer_top", text: `최고 구간 달성! 이번 달 개인 인센 ${manwon(statement?.bracket?.amount)} 구간이에요. 정말 수고 많으셨어요` };
  if (total <= 0) return { code: "cheer_start", text: `${manwon(next.threshold)}부터 인센이 시작돼요. 이번 달 첫 매출을 응원해요` };
  if (!statement?.bracket?.amount) {
    return next.needed <= 1000000
      ? { code: "cheer_almost_first", text: `${manwon(next.needed)}만 더 하면 첫 구간 인센 ${manwon(next.amount)}이에요. 거의 다 왔어요!` }
      : { code: "cheer_first", text: `${manwon(next.needed)} 더 하면 첫 구간 인센 ${manwon(next.amount)}이에요` };
  }
  return next.needed <= 500000
    ? { code: "cheer_almost_next", text: `${manwon(next.needed)}만 더 하면 다음 구간 ${manwon(next.amount)} (지금보다 +${manwon(next.gain)}). 거의 다 왔어요!` }
    : { code: "cheer_next", text: `${manwon(next.needed)} 더 하면 다음 구간 ${manwon(next.amount)} (지금보다 +${manwon(next.gain)})` };
}

/* ── 현금가 ───────────────────────────────────────────────────────────── */

const VAT_FREE = "cash";
const MIXED_PARTS = ["card", "transfer", "other", "cash"];
const net = (amount, method) => (text(method) === VAT_FREE ? intOf(amount) : Math.round((intOf(amount) * 10) / 11));

/**
 * 회원권 발급에서 **실제로 받은** 현금가 (대표 결정 6). 복합결제의 잔금(쪼갠 합이 계약 금액에 못 미치는 몫)은 뺀다 --
 * 받을지 모르는 돈이다. 단일 결제는 계약 금액 전부를 받은 것으로 본다.
 */
export function receivedCashPriceOfPass(pass) {
  const contract = Math.max(0, intOf(pass?.contractPrice));
  if (text(pass?.paymentMethod) !== "mixed") return net(contract, pass?.paymentMethod);
  const parts = pass?.paymentBreakdown && typeof pass.paymentBreakdown === "object" ? pass.paymentBreakdown : null;
  if (!parts) return 0;
  let paid = 0;
  let result = 0;
  for (const part of MIXED_PARTS) {
    const share = Math.min(Math.max(0, intOf(parts[part])), Math.max(0, contract - paid));
    paid += share;
    result += net(share, part);
  }
  return result;
}

/** 세션업으로 늘어난 금액의 현금가. 결제수단이 없으면 회원권의 수단을 쓴다. */
export const sessionUpCashPrice = (entry, pass) => net(entry?.addedPrice, text(entry?.paymentMethod) || (text(pass?.paymentMethod) === "mixed" ? "card" : pass?.paymentMethod));

/* ── 대표 대조 (한 줄마다) ──────────────────────────────────────────────── */

export const MATCH = Object.freeze({
  MATCHED: "matched",
  PARTIAL: "partial_payment",
  AMOUNT_MISMATCH: "amount_mismatch",
  NO_RECORD: "no_record",
  DOUBLE_CLAIM: "double_claim",
  CANCELLED_PASS: "cancelled_pass",
  NOT_A_SALE: "not_a_sale",
  OT_CHECK: "ot_check",
  HALF_CHECK: "half_check",
  REFUND_MATCHED: "refund_matched",
  REFUND_UNVERIFIED: "refund_unverified",
  GROUP_MANUAL: "group_manual",
});
/** 문구 · 색. 대표가 할 일이 있는 것이 attention. */
export const MATCH_VIEW = Object.freeze({
  [MATCH.MATCHED]: { tone: "good", label: "기록과 일치", attention: false },
  [MATCH.PARTIAL]: { tone: "warn", label: "받은 돈이 기록보다 적음 (잔금 남음?)", attention: true },
  [MATCH.AMOUNT_MISMATCH]: { tone: "warn", label: "금액이 기록보다 큼", attention: true },
  [MATCH.NO_RECORD]: { tone: "bad", label: "발급 · 세션업 기록 없음", attention: true },
  [MATCH.DOUBLE_CLAIM]: { tone: "bad", label: "다른 강사도 같은 결제를 입력함", attention: true },
  [MATCH.CANCELLED_PASS]: { tone: "bad", label: "취소된 회원권", attention: true },
  [MATCH.NOT_A_SALE]: { tone: "muted", label: "매출 아님 (양도 · 이관)", attention: true },
  [MATCH.OT_CHECK]: { tone: "warn", label: "OT 인센 표시 -- 확인", attention: true },
  [MATCH.HALF_CHECK]: { tone: "muted", label: "반반 매출 (FC 상담)", attention: false },
  [MATCH.REFUND_MATCHED]: { tone: "muted", label: "환불 (회원권 취소 확인)", attention: false },
  [MATCH.REFUND_UNVERIFIED]: { tone: "warn", label: "환불 -- 취소 기록 없음", attention: true },
  [MATCH.GROUP_MANUAL]: { tone: "muted", label: "그룹 회원 -- 앱 기록 없음, 두 장부 대조로 확인", attention: false },
});

const monthOfDate = (value) => {
  const at = value instanceof Date ? value : typeof value?.toDate === "function" ? value.toDate() : new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`;
};
/* 이관 회원권: 발급 내역(isMigratedPass)과 같은 기준 -- 계약일 칸이 있거나 id 가 csv_ 로 시작. */
const isMigrated = (pass) => Boolean(pass) && ((pass.contractedAt !== undefined && pass.contractedAt !== null) || text(pass.id).startsWith("csv_"));

/**
 * 그 달 기록(발급 · 세션업)을 결제 후보로 편다. 줄 = { recordId, passId, clientId, instructorId, kind, cashPrice, occurredAt, pass }.
 * @param {{ passes: any[], ledger: any[], month: string }} input  ledger = 그 달의 issue · sessionup 항목
 */
export function salesRecordsOf({ passes, ledger, month }) {
  const passById = new Map((passes || []).filter(Boolean).map((pass) => [text(pass.id), pass]));
  /* 양도로 생긴 회원권: 회원권 자체에는 표시가 없고, 같은 배치의 handover 항목이 toPassId 로 가리킨다. 매출이 아니다. */
  const handedOver = new Set((ledger || []).filter((entry) => entry && text(entry.type) === "handover").map((entry) => text(entry.toPassId)).filter(Boolean));
  const records = [];
  for (const entry of ledger || []) {
    if (!entry || monthOfDate(entry.occurredAt) !== text(month)) continue;
    const pass = passById.get(text(entry.passId)) || null;
    if (text(entry.type) === "issue") {
      records.push({ recordId: text(entry.id), passId: text(entry.passId), clientId: text(entry.clientId || pass?.clientId), instructorId: text(pass?.instructorId || entry.instructorId),
        kind: "issue", cashPrice: pass ? receivedCashPriceOfPass(pass) : null, occurredAt: entry.occurredAt, pass,
        notASale: isMigrated(pass) || handedOver.has(text(entry.passId)) });
    } else if (text(entry.type) === "sessionup") {
      records.push({ recordId: text(entry.id), passId: text(entry.passId), clientId: text(entry.clientId || pass?.clientId), instructorId: text(entry.instructorId || pass?.instructorId),
        kind: "sessionup", cashPrice: sessionUpCashPrice(entry, pass), occurredAt: entry.occurredAt, pass });
    }
  }
  return records;
}

/**
 * 한 줄의 대조 결과.
 * @param {any} entry  강사 · FC · 대표가 넣은 줄
 * @param {{ records: any[], claims: any[] }} context  records = salesRecordsOf, claims = 그 달 **모든 강사**의 줄 (중복 청구 판정)
 * @returns {{ code: string, record: any }}
 */
export function matchEntry(entry, { records, claims }) {
  /* 그룹 회원은 명부 · 발급 기록이 앱에 없다. 기록 대조 대신 두 장부 대조(pairSalesEntries)가 확인이다. */
  if (isGroup(entry)) return { code: MATCH.GROUP_MANUAL, record: null };
  const passId = text(entry?.passId);
  const sameRecord = (record) => (text(entry?.recordId) ? record.recordId === text(entry.recordId) : passId ? record.passId === passId : record.clientId === text(entry?.clientId));
  const candidates = (records || []).filter(sameRecord);
  if (isRefund(entry)) {
    const pass = candidates[0]?.pass || null;
    return { code: pass && text(pass.status) === "cancelled" ? MATCH.REFUND_MATCHED : MATCH.REFUND_UNVERIFIED, record: candidates[0] || null };
  }
  const record = candidates.find((item) => item.kind === (text(entry?.kind) === SALES_KIND.SESSION_UP ? "sessionup" : "issue")) || candidates[0] || null;
  if (!record) return { code: MATCH.NO_RECORD, record: null };
  if (record.pass && text(record.pass.status) === "cancelled") return { code: MATCH.CANCELLED_PASS, record };
  if (record.notASale) return { code: MATCH.NOT_A_SALE, record };
  /* 같은 기록을 여러 강사가 넣었고 인정 비율 합이 1 을 넘으면 중복. 강사 하나 + 반반은 중복이 아니다. */
  const key = record.recordId;
  const shareSum = (claims || []).filter((claim) => !isRefund(claim) && (text(claim.recordId) === key || (!text(claim.recordId) && text(claim.passId) && text(claim.passId) === record.passId && record.kind === "issue")))
    .reduce((sum, claim) => sum + (Number(claim.share) === HALF_SHARE ? HALF_SHARE : 1), 0);
  const claimants = new Set((claims || []).filter((claim) => !isRefund(claim) && (text(claim.recordId) === key || (!text(claim.recordId) && text(claim.passId) === record.passId && record.kind === "issue"))).map((claim) => text(claim.instructorId)));
  if (claimants.size > 1 && shareSum > 1) return { code: MATCH.DOUBLE_CLAIM, record };
  const amount = intOf(entry?.amount);
  if (record.cashPrice !== null && amount > record.cashPrice) return { code: MATCH.AMOUNT_MISMATCH, record };
  if (record.cashPrice !== null && amount < record.cashPrice) return { code: MATCH.PARTIAL, record };
  if (entry?.ot === true) return { code: MATCH.OT_CHECK, record };
  if (Number(entry?.share) === HALF_SHARE) return { code: MATCH.HALF_CHECK, record };
  return { code: MATCH.MATCHED, record };
}

/**
 * 강사 화면이 먼저 채워 둘 후보: 그 강사가 담당인 회원권의 이 달 발급 · 세션업 중 아직 아무도 넣지 않은 것.
 * 매출이 아닌 것(양도 · 이관 · 취소)은 빼고, 금액은 받은 현금가로.
 */
export function suggestionsFor({ instructorId, records, claims, canonicalInstructorId = (id) => text(id) }) {
  const me = canonicalInstructorId(instructorId) || text(instructorId);
  const used = new Set((claims || []).filter((claim) => !isRefund(claim)).map((claim) => text(claim.recordId)).filter(Boolean));
  return (records || [])
    .filter((record) => (canonicalInstructorId(record.instructorId) || record.instructorId) === me)
    .filter((record) => !used.has(record.recordId))
    .filter((record) => !record.notASale && !(record.pass && text(record.pass.status) === "cancelled"))
    .filter((record) => (record.cashPrice || 0) > 0)
    .map((record) => ({
      recordId: record.recordId, passId: record.passId, clientId: record.clientId,
      kind: record.kind === "sessionup" ? SALES_KIND.SESSION_UP : "", amount: record.cashPrice, occurredAt: record.occurredAt,
    }));
}

/** 줄 하나가 저장해도 되는 모양인가 (규칙과 같은 판단 -- 화면이 먼저 막는다). 문제 코드 목록. */
export function entryProblems(entry) {
  const problems = [];
  if (!isSalesMonth(entry?.month)) problems.push("month_invalid");
  if (!SALES_KINDS.includes(text(entry?.kind))) problems.push("kind_required");
  const amount = Number(entry?.amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > SALES_AMOUNT_MAX) problems.push("amount_invalid");
  if (!SALES_SHARES.includes(Number(entry?.share))) problems.push("share_invalid");
  if (!text(entry?.clientId) && !text(entry?.memberLabel)) problems.push("member_required");
  if (!SALES_SIDES.includes(text(entry?.side))) problems.push("side_required");
  if (isRefund(entry) && text(entry?.refundOfMonth) && !isSalesMonth(entry.refundOfMonth)) problems.push("refund_month_invalid");
  if (isRefund(entry) && text(entry?.refundOfMonth) > text(entry?.month)) problems.push("refund_month_future");
  if (isGroup(entry) && entry?.ot === true) problems.push("ot_not_for_group");
  return problems;
}

/* ── 두 쪽 대조 (2026-11-21 대표: "강사 입력 + FC · 대표 입력이 같아야 확정이 되는 구조") ──────────────
   강사가 넣은 줄(instructor)과 FC · 대표 · 총괄이 따로 넣은 줄(office)을 한 줄씩 짝짓는다. 짝은 이렇게 찾는다:
     1. 둘 다 같은 기록(recordId -- 앱이 채운 발급 · 세션업 후보)을 가리키면 짝
     2. 아니면 같은 회원 · 같은 구분 · 같은 환불 달 중 결제일 · 금액까지 같은 줄
     3. 그래도 없으면 같은 회원 · 같은 구분 · 같은 환불 달 (결제일 오타도 짝은 짓고 "다름" 으로 보인다)
   짝이 된 두 줄은 금액 · 구분 · 반반 · OT · 결제일 · 환불 달이 모두 같아야 "같음". 짝 없는 줄이 하나라도 있으면 확정 못 한다. */

export const PAIR = Object.freeze({
  AGREED: "agreed",
  DIFFERS: "differs",
  INSTRUCTOR_ONLY: "instructor_only",
  OFFICE_ONLY: "office_only",
});
export const PAIR_VIEW = Object.freeze({
  [PAIR.AGREED]: { tone: "good", label: "두 쪽이 같음" },
  [PAIR.DIFFERS]: { tone: "bad", label: "두 쪽이 다름" },
  [PAIR.INSTRUCTOR_ONLY]: { tone: "warn", label: "강사만 넣음 -- FC · 대표 입력 없음" },
  [PAIR.OFFICE_ONLY]: { tone: "warn", label: "FC · 대표만 넣음 -- 강사 입력 없음" },
});
const COMPARED_FIELDS = Object.freeze([
  ["amount", "금액"], ["kind", "구분"], ["share", "반반"], ["ot", "OT 인센"], ["paidOn", "결제일"], ["refundOfMonth", "환불한 결제의 달"],
]);
const normalized = (entry, field) => {
  if (field === "amount") return intOf(entry?.amount);
  if (field === "share") return Number(entry?.share) === HALF_SHARE ? HALF_SHARE : 1;
  if (field === "ot") return entry?.ot === true;
  return text(entry?.[field]);
};
/** 손으로 쓴 이름 맞추기: 띄어쓰기 · 끝의 "회원" · "님" 을 뺀다 ("김민지 회원" = "김민지님" = "김민지"). */
export const normalizeMemberLabel = (value) => text(value).replace(/\s+/g, "").replace(/(회원님|회원|님)$/u, "");
const memberKey = (entry) => text(entry?.clientId) || `label:${normalizeMemberLabel(entry?.memberLabel)}`;
const looseKey = (entry) => [memberKey(entry), text(entry?.kind), text(entry?.refundOfMonth)].join("|");
const order = (left, right) => text(left.paidOn).localeCompare(text(right.paidOn)) || text(left.id).localeCompare(text(right.id));

/**
 * @param {any[]} entries  강사 한 명 · 한 달의 두 쪽 줄 전부
 * @returns {{ pairs: Array<{ code: string, instructor: any, office: any, diffs: Array<{ field: string, label: string }> }>,
 *             counts: Record<string, number>, canConfirm: boolean }}
 */
export function pairSalesEntries(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const mine = list.filter((entry) => text(entry.side) === SALES_SIDE.INSTRUCTOR).sort(order);
  const office = list.filter((entry) => text(entry.side) === SALES_SIDE.OFFICE).sort(order);
  const used = new Set();
  const free = (predicate) => office.find((row) => !used.has(row) && predicate(row));
  const pairs = [];
  for (const row of mine) {
    const match = (text(row.recordId) && free((other) => text(other.recordId) === text(row.recordId)))
      || free((other) => looseKey(other) === looseKey(row) && text(other.paidOn) === text(row.paidOn) && intOf(other.amount) === intOf(row.amount))
      || free((other) => looseKey(other) === looseKey(row))
      || null;
    if (!match) { pairs.push({ code: PAIR.INSTRUCTOR_ONLY, instructor: row, office: null, diffs: [] }); continue; }
    used.add(match);
    const diffs = COMPARED_FIELDS.filter(([field]) => normalized(row, field) !== normalized(match, field)).map(([field, label]) => ({ field, label }));
    pairs.push({ code: diffs.length ? PAIR.DIFFERS : PAIR.AGREED, instructor: row, office: match, diffs });
  }
  for (const row of office) if (!used.has(row)) pairs.push({ code: PAIR.OFFICE_ONLY, instructor: null, office: row, diffs: [] });
  const counts = Object.fromEntries(Object.values(PAIR).map((code) => [code, pairs.filter((pair) => pair.code === code).length]));
  return { pairs, counts, canConfirm: pairs.every((pair) => pair.code === PAIR.AGREED) };
}

/** 확정할 때 남기는 숫자 (규칙의 salesSnapshotWellFormed 와 같은 칸). 강사 쪽 줄로 센다 -- 확정되는 순간 두 쪽은 같다. */
export function confirmSnapshot(statement, entryCount) {
  return {
    total: intOf(statement.total), otBonus: intOf(statement.otBonus), groupBase: intOf(statement.groupBase), groupBonus: intOf(statement.groupBonus),
    bracketAmount: intOf(statement.bracket?.amount),
    incentive: intOf(statement.incentive), clawbackTotal: intOf(statement.clawbackTotal), payout: intOf(statement.payout), entryCount: intOf(entryCount),
  };
}

/* ── FC 단독 확정 + 대표 알림 (2026-11-21 대표 결정) ─────────────────────────────── */

/** 확정 버튼 옆 문구 -- 누르기 전에 알린다. */
export const CONFIRM_NOTICE_HINT = "확정하면 대표님에게 알림이 갑니다";
export const SALES_CONFIRMED_INBOX_KIND = "sales_confirmed";

const monthTitle = (month) => { const [year, value] = text(month).split("-").map(Number); return Number.isFinite(value) ? `${year}년 ${value}월` : text(month); };
const won = (value) => `${intOf(value).toLocaleString("ko-KR")}원`;

/** 대표 알림함 한 줄. 회원 이름은 없다 -- 강사 · 확정한 사람 이름과 금액만. */
export function salesConfirmedNotice({ confirmerName, instructorName, month, snapshot }) {
  const parts = [`개인 ${won(snapshot?.bracketAmount)}`];
  if (intOf(snapshot?.otBonus)) parts.push(`OT ${won(snapshot.otBonus)}`);
  if (intOf(snapshot?.groupBonus)) parts.push(`그룹 ${won(snapshot.groupBonus)}`);
  const clawback = intOf(snapshot?.clawbackTotal) ? ` · 지난달 환수 −${won(snapshot.clawbackTotal)}` : "";
  return {
    title: "[매출 인센 확정]",
    body: `${text(confirmerName)} 님이 ${text(instructorName)} 강사의 ${monthTitle(month)} 매출 인센을 확정했어요 · 지급 ${won(snapshot?.payout)} (${parts.join(" · ")}${clawback}) · 매출 ${won(snapshot?.total)}`,
  };
}
