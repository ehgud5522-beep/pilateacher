/**
 * 강사 개인매출 인센 (2026-11-21 대표 결정 1~8). 구간 · OT · 반반 · 환불 · 환수 · 응원 · 현금가 · 대조 → 코드.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HALF_SHARE, MATCH, MATCH_VIEW, PAIR, PAIR_VIEW, SALES_KIND, bracketOf, cheerLine, confirmSnapshot, creditOf, entryProblems, incentiveOf, matchEntry,
  monthStatement, nextBracketOf, normalizeMemberLabel, pairSalesEntries, receivedCashPriceOfPass, salesRecordsOf, sessionUpCashPrice, suggestionsFor,
} from "../../functions/shared/sales-incentive.mjs";

const sale = (amount, extra = {}) => ({ month: "2026-11", side: "instructor", kind: SALES_KIND.REPURCHASE, amount, share: 1, clientId: "c1", ...extra });

test("1. 구간은 정액 -- 400만이든 490만이든 16만, 1,000만 위로는 100만", () => {
  assert.deepEqual(bracketOf(3999999), { threshold: 0, amount: 0 });
  assert.equal(bracketOf(4000000).amount, 160000);
  assert.equal(bracketOf(4900000).amount, 160000, "대표: 400인데 490이여도 400인센");
  assert.equal(bracketOf(7300000).amount, 490000);
  assert.equal(bracketOf(10000000).amount, 1000000);
  assert.equal(bracketOf(30000000).amount, 1000000);
});

test("2. OT 결제도 합계에 들고 그 실매출의 10% 를 더", () => {
  const result = incentiveOf([sale(1200000), sale(1800000, { kind: SALES_KIND.CONVERSION, ot: true }), sale(500000, { kind: SALES_KIND.SESSION_UP }), sale(3800000)]);
  assert.equal(result.total, 7300000);
  assert.equal(result.bracket.amount, 490000);
  assert.equal(result.otBonus, 180000);
  assert.equal(result.incentive, 670000);
});

test("4. FC 가 대신 상담한 결제는 반만 인정 (반반 매출)", () => {
  assert.equal(creditOf(sale(1000001, { share: HALF_SHARE })), 500001, "원 단위 반올림");
  const result = incentiveOf([sale(4000000), sale(1000000, { share: HALF_SHARE, ot: true })]);
  assert.equal(result.total, 4500000);
  assert.equal(result.otBonus, 50000, "OT 10% 도 인정된 반에만");
});

test("7. 이 달 결제를 무르는 환불은 이 달 합계에서 바로 뺀다", () => {
  const statement = monthStatement({ month: "2026-11", entries: [sale(5000000), sale(600000, { kind: SALES_KIND.REFUND })] });
  assert.equal(statement.total, 4400000);
  assert.equal(statement.sales, 5000000);
  assert.equal(statement.refunds, 600000);
  assert.equal(statement.incentive, 160000);
  assert.deepEqual(statement.clawbacks, []);
});

test("7. 지난달 결제를 무르는 환불은 지난달을 고치지 않고 이 달에 환수로 알린다", () => {
  const entries = [
    sale(5200000, { month: "2026-10" }),
    sale(1500000, { month: "2026-10", ot: true }),
    sale(2000000),
    sale(1500000, { kind: SALES_KIND.REFUND, refundOfMonth: "2026-10", ot: true }),
  ];
  /* 10월: 670만 → 60만 구간 36만 + OT 15만 = 51만 지급. 환불하면 520만 → 25만. 환수 26만. */
  const statement = monthStatement({ month: "2026-11", entries });
  assert.equal(statement.total, 2000000, "지난달 환불은 이 달 구간 합계에 안 들어간다");
  assert.deepEqual(statement.clawbacks, [{ month: "2026-10", refunded: 1500000, amount: 260000 }]);
  assert.equal(statement.payout, 0 - 260000, "이 달 인센 0 - 환수 26만 = 다음 달로 넘겨 뺄 금액");
  assert.equal(monthStatement({ month: "2026-10", entries }).incentive, 510000, "10월 명세는 그대로");
});

test("8. 응원 문구 -- 계산과 같은 숫자", () => {
  assert.deepEqual(nextBracketOf(4600000), { threshold: 5000000, amount: 250000, needed: 400000, gain: 90000 });
  assert.equal(nextBracketOf(12000000), null);
  const near = cheerLine(monthStatement({ month: "2026-11", entries: [sale(4600000)] }));
  assert.deepEqual(near, { code: "cheer_almost_next", text: "40만 원만 더 하면 다음 구간 25만 원 (지금보다 +9만 원). 거의 다 왔어요!" });
  assert.equal(cheerLine(monthStatement({ month: "2026-11", entries: [] })).code, "cheer_start");
  assert.equal(cheerLine(monthStatement({ month: "2026-11", entries: [sale(3200000)] })).code, "cheer_almost_first");
  assert.equal(cheerLine(monthStatement({ month: "2026-11", entries: [sale(1000000)] })).code, "cheer_first");
  assert.equal(cheerLine(monthStatement({ month: "2026-11", entries: [sale(6000000)] })).code, "cheer_next");
  assert.match(cheerLine(monthStatement({ month: "2026-11", entries: [sale(15000000)] })).text, /^최고 구간 달성! 이번 달 개인 인센 100만 원/);
});

test("6. 현금가는 실제로 받은 돈만 -- 복합결제의 잔금은 뺀다", () => {
  assert.equal(receivedCashPriceOfPass({ contractPrice: 1100000, paymentMethod: "card" }), 1000000);
  assert.equal(receivedCashPriceOfPass({ contractPrice: 1000000, paymentMethod: "cash" }), 1000000);
  assert.equal(receivedCashPriceOfPass({ contractPrice: 1100000, paymentMethod: "transfer" }), 1000000);
  /* 220만 계약: 카드 110만 + 현금 50만 받고 60만 잔금 → 100만 + 50만 */
  assert.equal(receivedCashPriceOfPass({ contractPrice: 2200000, paymentMethod: "mixed", paymentBreakdown: { card: 1100000, cash: 500000 } }), 1500000);
  assert.equal(receivedCashPriceOfPass({ contractPrice: 2200000, paymentMethod: "mixed" }), 0, "쪼갠 금액이 없으면 받은 것으로 치지 않는다");
  assert.equal(sessionUpCashPrice({ addedPrice: 550000, paymentMethod: "card" }, null), 500000);
  assert.equal(sessionUpCashPrice({ addedPrice: 550000 }, { paymentMethod: "cash" }), 550000);
});

const at = new Date(2026, 10, 5, 10);
const passes = [
  { id: "p1", clientId: "c1", instructorId: "t1", contractPrice: 1320000, paymentMethod: "card", status: "active" },
  { id: "p2", clientId: "c2", instructorId: "t1", contractPrice: 1000000, paymentMethod: "cash", status: "cancelled" },
  { id: "p3", clientId: "c3", instructorId: "t1", contractPrice: 990000, paymentMethod: "card", status: "active" },
  { id: "csv_9", clientId: "c9", instructorId: "t1", contractPrice: 500000, paymentMethod: "cash", status: "active" },
  { id: "p5", clientId: "c5", instructorId: "t2", contractPrice: 550000, paymentMethod: "card", status: "active" },
];
const ledger = [
  { id: "p1_issue", type: "issue", passId: "p1", clientId: "c1", occurredAt: at },
  { id: "p2_issue", type: "issue", passId: "p2", clientId: "c2", occurredAt: at },
  { id: "p3_issue", type: "issue", passId: "p3", clientId: "c3", occurredAt: at },
  { id: "p3_handover", type: "handover", passId: "p0", toPassId: "p3", occurredAt: at },
  { id: "csv_9_issue", type: "issue", passId: "csv_9", clientId: "c9", occurredAt: at },
  { id: "p1_sessionup_1", type: "sessionup", passId: "p1", clientId: "c1", instructorId: "t1", addedPrice: 550000, paymentMethod: "card", occurredAt: at },
  { id: "p5_issue", type: "issue", passId: "p5", clientId: "c5", occurredAt: at },
  { id: "old_issue", type: "issue", passId: "p1", clientId: "c1", occurredAt: new Date(2026, 9, 30) },
];
const records = salesRecordsOf({ passes, ledger, month: "2026-11" });

test("대조: 기록과 일치 · 잔금 · 금액 큼 · 기록 없음 · 취소 · 양도 · 이관 · OT · 반반 · 환불", () => {
  const code = (entry, claims = [entry]) => matchEntry({ month: "2026-11", share: 1, kind: SALES_KIND.REPURCHASE, ...entry }, { records, claims }).code;
  assert.equal(code({ recordId: "p1_issue", passId: "p1", amount: 1200000 }), MATCH.MATCHED);
  assert.equal(code({ recordId: "p1_issue", passId: "p1", amount: 1000000 }), MATCH.PARTIAL);
  assert.equal(code({ recordId: "p1_issue", passId: "p1", amount: 1320000 }), MATCH.AMOUNT_MISMATCH, "카드값을 그대로 적음");
  assert.equal(code({ clientId: "c-none", amount: 300000 }), MATCH.NO_RECORD);
  assert.equal(code({ recordId: "p2_issue", passId: "p2", amount: 1000000 }), MATCH.CANCELLED_PASS);
  assert.equal(code({ recordId: "p3_issue", passId: "p3", amount: 900000 }), MATCH.NOT_A_SALE, "양도로 생긴 회원권");
  assert.equal(code({ recordId: "csv_9_issue", passId: "csv_9", amount: 500000 }), MATCH.NOT_A_SALE, "이관 회원권");
  assert.equal(code({ recordId: "p1_sessionup_1", passId: "p1", kind: SALES_KIND.SESSION_UP, amount: 500000 }), MATCH.MATCHED, "세션업은 늘어난 금액");
  assert.equal(code({ recordId: "p1_issue", passId: "p1", amount: 1200000, ot: true }), MATCH.OT_CHECK);
  assert.equal(code({ recordId: "p1_issue", passId: "p1", amount: 1200000, share: HALF_SHARE }), MATCH.HALF_CHECK);
  assert.equal(code({ kind: SALES_KIND.REFUND, recordId: "p2_issue", passId: "p2", amount: 1000000 }), MATCH.REFUND_MATCHED);
  assert.equal(code({ kind: SALES_KIND.REFUND, recordId: "p1_issue", passId: "p1", amount: 1000000 }), MATCH.REFUND_UNVERIFIED);
  for (const value of Object.values(MATCH)) assert.ok(MATCH_VIEW[value]?.label, `${value} 문구`);
});

test("대조: 두 강사가 같은 결제를 전부 넣으면 중복, 강사 하나가 반반이면 중복 아님", () => {
  const mine = { instructorId: "t1", recordId: "p1_issue", passId: "p1", amount: 1200000, share: 1 };
  const theirs = { instructorId: "t2", recordId: "p1_issue", passId: "p1", amount: 1200000, share: 1 };
  assert.equal(matchEntry({ month: "2026-11", kind: SALES_KIND.REPURCHASE, ...mine }, { records, claims: [mine, theirs] }).code, MATCH.DOUBLE_CLAIM);
  const half = { ...mine, share: HALF_SHARE };
  assert.equal(matchEntry({ month: "2026-11", kind: SALES_KIND.REPURCHASE, ...half }, { records, claims: [half] }).code, MATCH.HALF_CHECK);
});

test("먼저 채워 둘 후보: 내 담당 · 이 달 · 아직 아무도 안 넣음 · 매출 아닌 것 빼고 · 받은 현금가", () => {
  const list = suggestionsFor({ instructorId: "t1", records, claims: [{ recordId: "p1_sessionup_1", kind: SALES_KIND.SESSION_UP }] });
  assert.deepEqual(list.map((item) => [item.recordId, item.amount, item.kind]), [["p1_issue", 1200000, ""]]);
  assert.deepEqual(suggestionsFor({ instructorId: "t2", records, claims: [] }).map((item) => item.recordId), ["p5_issue"]);
});

test("저장 전 모양 검사 (규칙과 같은 판단)", () => {
  assert.deepEqual(entryProblems(sale(1000000)), []);
  assert.deepEqual(entryProblems({ month: "2026-1", kind: "x", amount: 0, share: 0.3 }), ["month_invalid", "kind_required", "amount_invalid", "share_invalid", "member_required", "side_required"]);
  assert.deepEqual(entryProblems(sale(1000, { kind: SALES_KIND.GROUP, ot: true, clientId: "", memberLabel: "김민지" })), ["ot_not_for_group"]);
  assert.deepEqual(entryProblems(sale(1000, { clientId: "", memberLabel: "앱 밖 회원" })), []);
  assert.deepEqual(entryProblems(sale(1000, { kind: SALES_KIND.REFUND, refundOfMonth: "2026-12" })), ["refund_month_future"]);
});

test("저장소가 쓰는 칸 목록은 규칙의 hasOnly 와 같다", async () => {
  const { readFileSync } = await import("node:fs");
  const { SALES_ENTRY_FIELDS } = await import("../../src/data/repositories/sales-repository.js");
  const rules = readFileSync(new URL("../../firestore.foundation.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("function salesEntryWellFormed"), rules.indexOf("match /salesEntries/"));
  for (const field of [...SALES_ENTRY_FIELDS, "organizationId", "createdBy", "createdByRole", "createdAt", "updatedBy", "updatedAt"]) {
    assert.ok(block.includes(`"${field}"`), `규칙에 ${field} 없음`);
  }
});

test("9. 그룹 수강권은 현금가의 0.5% -- 개인 구간 합계에는 안 든다, 그룹 환불도 같은 셈", () => {
  const result = incentiveOf([
    sale(4000000),
    sale(3000000, { kind: SALES_KIND.GROUP, clientId: "", memberLabel: "김민지" }),
    sale(1000000, { kind: SALES_KIND.GROUP, clientId: "", memberLabel: "이두리", share: HALF_SHARE }),
    sale(400000, { kind: SALES_KIND.GROUP_REFUND, clientId: "", memberLabel: "김민지" }),
  ]);
  assert.equal(result.total, 4000000, "그룹은 구간 합계에 안 든다");
  assert.equal(result.groupBase, 3100000, "300만 + 반반 50만 - 환불 40만");
  assert.equal(result.groupBonus, 15500);
  assert.equal(result.incentive, 160000 + 15500);
  assert.equal(matchEntry(sale(3000000, { kind: SALES_KIND.GROUP, clientId: "", memberLabel: "김민지" }), { records: [], claims: [] }).code, MATCH.GROUP_MANUAL, "그룹 회원은 앱 기록이 없다");
  assert.equal(MATCH_VIEW[MATCH.GROUP_MANUAL].attention, false);
});

test("두 장부 대조: 같음 · 다름(어느 칸) · 한쪽만 · 그룹 이름은 띄어쓰기 · 회원 · 님 무시", () => {
  const mine = (id, extra) => ({ id, side: "instructor", month: "2026-11", paidOn: "2026-11-05", kind: SALES_KIND.REPURCHASE, amount: 1200000, share: 1, ot: false, clientId: "c1", recordId: "p1_issue", refundOfMonth: "", ...extra });
  const office = (id, extra) => ({ ...mine(id, extra), side: "office" });
  const same = pairSalesEntries([mine("a"), office("b")]);
  assert.equal(same.canConfirm, true);
  assert.equal(same.pairs[0].code, PAIR.AGREED);

  const differs = pairSalesEntries([mine("a"), office("b", { amount: 1100000, ot: true })]);
  assert.equal(differs.canConfirm, false);
  assert.deepEqual(differs.pairs[0].diffs.map((item) => item.label), ["금액", "OT 인센"]);

  const single = pairSalesEntries([mine("a"), office("b", { clientId: "c9", recordId: "p9_issue" })]);
  assert.deepEqual(single.counts, { agreed: 0, differs: 0, instructor_only: 1, office_only: 1 });

  const group = (side, id, label) => ({ id, side, month: "2026-11", paidOn: "2026-11-07", kind: SALES_KIND.GROUP, amount: 300000, share: 1, ot: false, clientId: "", memberLabel: label, recordId: "", refundOfMonth: "" });
  assert.equal(pairSalesEntries([group("instructor", "g1", "김민지 회원"), group("office", "g2", "김민지님")]).canConfirm, true);
  assert.equal(normalizeMemberLabel(" 김 민지 회원님 "), "김민지");
  /* 결제일만 틀려도 짝은 짓고 "다름" 으로 보인다 -- 어디를 고칠지 바로 알게 */
  const dated = pairSalesEntries([group("instructor", "g1", "김민지"), { ...group("office", "g2", "김민지"), paidOn: "2026-11-08" }]);
  assert.deepEqual(dated.pairs.map((pair) => [pair.code, pair.diffs.map((item) => item.field)]), [[PAIR.DIFFERS, ["paidOn"]]]);
  assert.equal(pairSalesEntries([]).canConfirm, true, "매출이 없는 달도 확정할 수 있다");
  for (const code of Object.values(PAIR)) assert.ok(PAIR_VIEW[code]?.label);
});

test("확정 숫자에 그룹 인센이 함께 남는다", () => {
  const statement = monthStatement({ month: "2026-11", entries: [sale(5000000), sale(2000000, { kind: SALES_KIND.GROUP, clientId: "", memberLabel: "김민지" })] });
  assert.deepEqual(confirmSnapshot(statement, 2), { total: 5000000, otBonus: 0, groupBase: 2000000, groupBonus: 10000, bracketAmount: 250000, incentive: 260000, clawbackTotal: 0, payout: 260000, entryCount: 2 });
});

test("FC 단독 확정 + 대표 알림: 버튼 옆 문구 · 알림 본문 (그룹 · 환수 포함, 회원 이름 없음)", async () => {
  const { CONFIRM_NOTICE_HINT, salesConfirmedNotice } = await import("../../functions/shared/sales-incentive.mjs");
  assert.equal(CONFIRM_NOTICE_HINT, "확정하면 대표님에게 알림이 갑니다");
  const notice = salesConfirmedNotice({
    confirmerName: "박에프씨", instructorName: "정예진", month: "2026-11",
    snapshot: { total: 5000000, bracketAmount: 250000, otBonus: 0, groupBonus: 10000, clawbackTotal: 110000, payout: 150000 },
  });
  assert.deepEqual(notice, {
    title: "[매출 인센 확정]",
    body: "박에프씨 님이 정예진 강사의 2026년 11월 매출 인센을 확정했어요 · 지급 150,000원 (개인 250,000원 · 그룹 10,000원 · 지난달 환수 −110,000원) · 매출 5,000,000원",
  });
});
