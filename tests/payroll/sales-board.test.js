/**
 * 매출 인센 화면 판정 (2026-11-21 2단계). 상태 칩 · 마지막 대조 · 후보 → 새 줄 · 저장 전 문구 · 강사 화면 · FC 대표 표 · 확정 거절 문구.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRM_NOTICE_HINT, SALES_KIND_CHOICES_BY_SECTION, entryPreview, entryLine, otBonusOf, blankEntry, confirmFailureText, entryErrors, entryFromSuggestion, kstDate, lastCheckLine, monthStatusView, mySalesView, salesBoardRows,
  kstDateTimeLabel, submissionChangeText, submissionView, submittedSummaryOf,
} from "../../src/features/sales/sales-board.js";
import { salesRecordsOf } from "../../functions/shared/sales-incentive.mjs";

const MONTH = "2026-11";
const row = (id, side, extra = {}) => ({ id, side, instructorId: "t1", month: MONTH, paidOn: "2026-11-05", kind: "repurchase", amount: 1200000, share: 1, ot: false, clientId: "c1", memberLabel: "", recordId: "p1_issue", refundOfMonth: "", ...extra });

test("상태 칩 · 마지막 대조", () => {
  assert.equal(monthStatusView(null).code, "draft");
  assert.equal(monthStatusView({ status: "submitted" }).label, "제출함");
  assert.equal(monthStatusView({ status: "confirmed" }).tone, "good");
  assert.equal(monthStatusView({ status: "reopened", reopenReason: "환불 반영" }).label, "되돌림 · 환불 반영");
  assert.equal(lastCheckLine({ status: "confirmed", lastCheck: { differs: 1 } }), null);
  const line = lastCheckLine({ status: "submitted", lastCheck: { differs: 1, instructorOnly: 2, officeOnly: 0, instructorEntryIds: ["a"], officeEntryIds: ["b"] } });
  assert.equal(line.text, "두 장부가 달라 아직 확정되지 않았어요 · 다름 1건 · 강사만 넣음 2건");
  assert.ok(line.entryIds.has("a") && line.entryIds.has("b"));
});

test("후보 → 새 줄: 한국 날짜 · 세션업만 구분을 채움 · 받은 현금가", () => {
  assert.equal(kstDate(new Date("2026-11-04T16:30:00Z")), "2026-11-05", "한국 시간 새벽은 다음 날");
  const entry = entryFromSuggestion({ recordId: "p1_issue", passId: "p1", clientId: "c1", kind: "", amount: 1200000, occurredAt: new Date("2026-11-05T02:00:00Z") }, { side: "instructor", instructorId: "t1", month: MONTH });
  assert.deepEqual({ kind: entry.kind, paidOn: entry.paidOn, amount: entry.amount, side: entry.side }, { kind: "", paidOn: "2026-11-05", amount: 1200000, side: "instructor" });
  assert.equal(blankEntry({ side: "office", instructorId: "t1", month: MONTH, kind: "group" }).paidOn, "2026-11-01");
});

test("저장 전 문구: 구분 · 금액 · 회원 · 결제일 달 · 그룹 OT", () => {
  assert.deepEqual(entryErrors(row("x", "instructor")), []);
  const errors = entryErrors({ ...blankEntry({ side: "instructor", instructorId: "t1", month: MONTH }), paidOn: "2026-10-30", ot: false });
  assert.deepEqual(errors.map((item) => item.code), ["kind_required", "amount_invalid", "member_required", "paid_on_month"]);
  assert.equal(entryErrors(row("g", "instructor", { kind: "group", ot: true, clientId: "", memberLabel: "김민지" }))[0].text, "그룹 수강권에는 OT 인센이 없어요");
});

test("강사 화면: 내 장부만으로 명세 · 응원 · 어긋난 줄 표시 · 아직 안 넣은 후보만", () => {
  const passes = [
    { id: "p1", clientId: "c1", instructorId: "t1", contractPrice: 1320000, paymentMethod: "card", status: "active" },
    { id: "p2", clientId: "c2", instructorId: "t1", contractPrice: 4400000, paymentMethod: "card", status: "active" },
    { id: "p3", clientId: "c3", instructorId: "t2", contractPrice: 1100000, paymentMethod: "card", status: "active" },
  ];
  const at = new Date(2026, 10, 5, 10);
  const records = salesRecordsOf({ passes, month: MONTH, ledger: ["p1", "p2", "p3"].map((id) => ({ id: `${id}_issue`, type: "issue", passId: id, occurredAt: at })) });
  const view = mySalesView({
    entries: [row("a", "instructor"), row("o", "office", { amount: 999 })], records, instructorId: "t1", month: MONTH,
    monthDoc: { status: "submitted", lastCheck: { differs: 1, instructorEntryIds: ["a"], officeEntryIds: [] } },
  });
  assert.equal(view.statement.total, 1200000, "사무실 장부는 섞이지 않는다");
  assert.equal(view.cheer.code, "cheer_first");
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].flagged, true);
  assert.deepEqual(view.suggestions.map((item) => [item.recordId, item.amount]), [["p2_issue", 4000000]], "넣은 p1 · 남의 p3 는 빠진다");
  assert.equal(view.locked, false);
  assert.equal(mySalesView({ entries: [], records: [], instructorId: "t1", month: MONTH, monthDoc: { status: "confirmed" } }).locked, true);
});

test("FC · 대표 표: 확정 안 된 · 어긋난 강사가 위, 자기 매출은 잠김, 아무것도 없는 강사는 빠짐", () => {
  const rows = salesBoardRows({
    instructors: [{ userId: "t1", displayName: "가강사" }, { userId: "t2", displayName: "나강사" }, { userId: "t3", displayName: "다강사" }, { userId: "fc", displayName: "에프씨" }],
    entriesByInstructor: new Map([
      ["t1", [row("a", "instructor"), row("b", "office")]],
      ["t2", [row("c", "instructor", { instructorId: "t2" })]],
      ["fc", [row("d", "instructor", { instructorId: "fc" })]],
    ]),
    monthsByInstructor: new Map([["t1", { status: "confirmed", snapshot: { payout: 160000, total: 4200000 } }]]),
    month: MONTH, viewerUid: "fc",
  });
  assert.deepEqual(rows.map((item) => item.instructorId), ["t2", "fc", "t1"], "어긋난 건수가 같으면 이름순, 확정된 강사는 맨 뒤");
  assert.equal(rows.find((item) => item.instructorId === "fc").ownSales, true);
  assert.equal(rows.find((item) => item.instructorId === "t2").attention, 1);
  assert.equal(rows.find((item) => item.instructorId === "t1").statement.payout, 160000, "확정된 달은 확정 때 숫자");
});

test("확정 거절 문구 -- 원본 코드와 함께, 종류별로", () => {
  assert.deepEqual(confirmFailureText({ code: "functions/failed-precondition", details: { reason: "sides_differ", differs: 1, office_only: 2 } }),
    { kind: "invalid_request", code: "sides_differ", text: "두 장부가 달라 확정하지 못했어요 · 다름 1건 · FC · 대표만 넣음 2건 (코드 sides_differ)" });
  assert.equal(confirmFailureText({ details: { reason: "own_sales" } }).kind, "permission");
  assert.equal(confirmFailureText({ code: "functions/unavailable" }).kind, "network");
  assert.equal(confirmFailureText({}).text, "확정하지 못했어요 (코드 unknown)");
  assert.equal(CONFIRM_NOTICE_HINT, "확정하면 대표님에게 알림이 갑니다");
});

test("화면 배선: 강사 메뉴 · FC 대표 메뉴 · 확정은 서버 호출 · 버튼 옆 알림 문구", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  for (const needle of ['key: "sales-mine"', 'key: "sales-board"', "function MySalesScreen(", "function SalesBoardScreen(", "onConfirm = fbConfirmSalesMonth", "{CONFIRM_NOTICE_HINT}"]) {
    assert.ok(app.includes(needle), `App.jsx 에 ${needle} 없음`);
  }
});

test("대표 · 총괄도 알림함을 듣고, 수업 없는 알림은 눌러도 읽음만", async () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  /* 2026-11-28: 대표 · 총괄만이 아니라 센터 소속이면 모두 듣는다 (회원 요청 · 몸 상태 알림이 일반 강사에게 안 보였다). */
  assert.ok(app.includes("const inboxOn = Boolean(organizationRoster) && Boolean(account?.id);"), "소속이면 모두 알림함");
  assert.ok(app.includes('if (!String(item?.lessonId || "").trim()) return;'), "수업 없는 알림");
  const { INBOX_KIND } = await import("../../src/features/notifications/teacher-inbox.js");
  const { SALES_CONFIRMED_INBOX_KIND } = await import("../../functions/shared/sales-incentive.mjs");
  const { PASS_ISSUED_INBOX_KIND } = await import("../../functions/shared/issue-notice.mjs");
  assert.equal(INBOX_KIND.SALES_CONFIRMED, SALES_CONFIRMED_INBOX_KIND);
  assert.equal(INBOX_KIND.PASS_ISSUED_BY_FC, PASS_ISSUED_INBOX_KIND);
});

/* 2026-11-21 대표: "강사가 제출 이후에도 다시 수정하거나 어떤 내용을 제출했는지 확인이 돼야 함" */
test("제출한 내용: 요약을 남기고, 제출 뒤 고친 줄 · 새 줄 · 지운 줄을 가린다", () => {
  const sentAt = new Date("2026-11-20T05:03:00Z");
  const before = new Date("2026-11-19T00:00:00Z");
  const after = new Date("2026-11-21T00:00:00Z");
  const summary = submittedSummaryOf({ entries: [row("e1", "instructor"), row("e2", "instructor"), row("o1", "office")], statement: { total: 1200000.4, groupBase: 0, payout: 50000 } });
  assert.deepEqual(summary, { lines: 2, total: 1200000, groupBase: 0, payout: 50000, entryIds: ["e1", "e2"] });
  const entries = [
    row("e1", "instructor", { createdAt: before, updatedAt: after }),
    row("e3", "instructor", { createdAt: after, updatedAt: after }),
  ];
  const view = submissionView({ entries, monthDoc: { status: "submitted", submittedAt: sentAt, submittedSummary: summary } });
  assert.equal(view.submitted, true);
  assert.equal(view.label, "11월 20일 14:03");
  assert.equal(view.changeOf.get("e1"), "edited");
  assert.equal(view.changeOf.get("e3"), "added");
  assert.equal(view.removed, 1, "e2 를 지웠다");
  assert.equal(view.dirty, true);
  assert.equal(submissionChangeText(view), "고친 줄 1개 · 새로 넣은 줄 1개 · 지운 줄 1개");
  const clean = submissionView({ entries: [row("e1", "instructor", { createdAt: before, updatedAt: before })], monthDoc: { status: "submitted", submittedAt: sentAt, submittedSummary: { ...summary, lines: 1, entryIds: ["e1"] } } });
  assert.equal(clean.dirty, false);
  /* 요약이 없는 예전 제출: 시각으로만 가리고 지운 줄은 모른다. 작성 중 · 되돌림은 제출 아님. */
  const legacy = submissionView({ entries, monthDoc: { status: "submitted", submittedAt: sentAt } });
  assert.equal(legacy.changeOf.get("e3"), "added");
  assert.equal(legacy.removed, 0);
  assert.equal(submissionView({ entries, monthDoc: { status: "reopened" } }).submitted, false);
  assert.equal(submissionView({ entries, monthDoc: null }).submitted, false);
  assert.equal(kstDateTimeLabel("nope"), "");
  assert.equal(mySalesView({ entries, records: [], instructorId: "t1", month: MONTH, monthDoc: { status: "submitted", submittedAt: sentAt, submittedSummary: summary } }).submission.dirty, true);
});

/* 2026-11-21 대표: 개인 · 그룹 반반 두 칸, OT 10% 는 받는지 안 받는지 명확하게 */
test("OT 10%: 새 줄은 비워 두고 꼭 고르게 · 줄마다 받음(+금액) / 안 받음 · 그룹은 OT 없음", () => {
  const LABELS = { repurchase: "재등록", group: "그룹" };
  assert.equal(blankEntry({ side: "instructor", instructorId: "t1", month: MONTH }).ot, null);
  assert.equal(blankEntry({ side: "instructor", instructorId: "t1", month: MONTH, kind: "group" }).ot, false);
  const unchosen = { ...row("x", "instructor"), ot: null };
  assert.ok(entryErrors(unchosen).some((item) => item.code === "ot_choice_required"));
  assert.ok(!entryErrors({ ...unchosen, ot: false }).some((item) => item.code === "ot_choice_required"));
  assert.ok(!entryErrors({ ...row("g", "instructor"), kind: "group", ot: false, clientId: "", memberLabel: "박그룹", recordId: "" }).some((item) => item.code === "ot_choice_required"));
  assert.equal(otBonusOf({ ...row("a", "instructor"), ot: true, share: 0.5 }), 60000);
  assert.equal(otBonusOf({ ...row("a", "instructor"), ot: false }), 0);
  assert.equal(entryLine({ ...row("a", "instructor"), ot: true }, LABELS), "재등록 · 1,200,000원 · OT 10% 받음 +120,000원");
  assert.equal(entryLine({ ...row("a", "instructor"), ot: false }, LABELS), "재등록 · 1,200,000원 · OT 10% 안 받음");
  assert.equal(entryLine({ ...row("g", "instructor"), kind: "group", amount: 900000 }, LABELS), "그룹 · 900,000원");
  assert.deepEqual([...SALES_KIND_CHOICES_BY_SECTION.group], ["group", "group_refund"]);
  assert.ok(!SALES_KIND_CHOICES_BY_SECTION.personal.includes("group"));
});

/* 2026-11-22 대표: 예상 받는 금액을 크게, 그룹은 반반 없음 */
test("입력 중인 줄의 예상 금액: 구간을 넘기면 구간 인센 · 그룹은 5% · OT 는 10% · 못 넘기면 다음 구간까지", () => {
  const base = row("e1", "instructor", { amount: 3500000, kind: "repurchase" });
  const draft = (extra) => ({ ...blankEntry({ side: "instructor", instructorId: "t1", month: MONTH }), kind: "repurchase", paidOn: "2026-11-10", ...extra });
  assert.equal(entryPreview({ entries: [base], month: MONTH, draft: draft({ amount: 600000, ot: false }) }).delta, 160000, "350만 + 60만 = 410만 → 400만 구간");
  const group = entryPreview({ entries: [base], month: MONTH, draft: draft({ kind: "group", amount: 140000, ot: false }) });
  assert.equal(group.group, true);
  assert.equal(group.delta, 7000);
  assert.equal(group.groupBonus, 7000);
  const small = entryPreview({ entries: [], month: MONTH, draft: draft({ amount: 100000, ot: false }) });
  assert.equal(small.delta, 0);
  assert.equal(small.nextBracket.needed, 3900000);
  const ot = entryPreview({ entries: [], month: MONTH, draft: draft({ amount: 1000000, ot: true }) });
  assert.equal(ot.delta, 100000);
  assert.equal(ot.otBonus, 100000);
  /* 고치는 줄은 자기 자신을 빼고 센다 -- 두 번 세면 예상이 부풀려진다. */
  assert.equal(entryPreview({ entries: [base], month: MONTH, draft: { ...base, amount: 4000000 } }).delta, 160000);
  assert.ok(entryErrors({ ...row("g", "instructor"), kind: "group", ot: false, share: 0.5, clientId: "", memberLabel: "박그룹", recordId: "" }).some((item) => item.code === "share_not_for_group"));
});
