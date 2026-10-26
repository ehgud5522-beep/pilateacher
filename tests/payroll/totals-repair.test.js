import assert from "node:assert/strict";
import test from "node:test";

import {
  isCountedServiceDeduction, planTotalsRepair, serviceDeductionsByPair, summarizeRepair,
} from "../../tools/payroll/totals-repair.js";
import {
  compareWithStored, sheetTotals, summarizeAudit,
} from "../../tools/payroll/sheet-totals-audit.js";

/**
 * 누적을 바로잡는 두 스크립트의 **셈**.
 *
 * 둘 다 프로덕션을 읽는다. 셈이 틀리면 센터 전체의 급여 단가가 틀어지고
 * 원장은 append-only 라 되돌릴 수 없는데, **프로덕션을 읽어 가며 시험할 수는
 * 없다.** 그래서 셈과 입출력을 갈라 두고 셈만 여기서 못 박는다.
 */

const entry = (overrides = {}) => ({
  type: "deduct", category: "service", instructorId: "u-me",
  clientId: "c1", passId: "p1", ...overrides,
});

/* ── 무엇을 빼는가 ───────────────────────────────────────────────────────── */

test("only service deductions count — issues and paid sessions do not", () => {
  /* 결제 회차는 누적에 들어가는 것이 맞다. 함께 빼면 멀쩡한 누적이 깎이고,
     그 회원의 신규 단가 구간이 없던 만큼 길어진다. */
  assert.equal(isCountedServiceDeduction(entry()), true);
  assert.equal(isCountedServiceDeduction(entry({ category: "pt_1_1_new" })), false);
  assert.equal(isCountedServiceDeduction(entry({ type: "issue" })), false);
  assert.equal(isCountedServiceDeduction(entry({ type: "correction" })), false);
});

test("a duet service session is taken off both members", () => {
  /* 차감이 두 사람의 누적을 모두 올렸다 (pass-repository 의 clientIds.map).
     한쪽만 빼면 두 사람의 누적이 영영 어긋난 채로 남는다. */
  const pairs = serviceDeductionsByPair({
    entries: [entry(), entry()],
    clientIdsOf: () => ["c1", "c2"],
  });
  assert.equal(pairs.get("u-me_c1").serviceDeductions, 2);
  assert.equal(pairs.get("u-me_c2").serviceDeductions, 2);
});

test("a pass we could not read falls back to the member on the entry", () => {
  /* 짝을 지어내지 않는다. 없는 사람의 누적을 빼면 그 회원의 단가가 틀어지고,
     덜 뺀 것은 다음에 다시 돌리면 된다 -- 뒤가 덜 틀리다. */
  const pairs = serviceDeductionsByPair({ entries: [entry()], clientIdsOf: () => null });
  assert.deepEqual([...pairs.keys()], ["u-me_c1"]);
});

test("each instructor is counted separately for the same member", () => {
  // 누적은 강사–회원 쌍이다. 합치면 남의 수업이 내 누적을 올린다.
  const pairs = serviceDeductionsByPair({
    entries: [entry(), entry({ instructorId: "u-other" })],
    clientIdsOf: () => ["c1"],
  });
  assert.equal(pairs.get("u-me_c1").serviceDeductions, 1);
  assert.equal(pairs.get("u-other_c1").serviceDeductions, 1);
});

/* ── 얼마로 내리는가 ─────────────────────────────────────────────────────── */

const pairsOf = (list) => new Map(list.map((item) => [`${item.instructorId}_${item.clientId}`, item]));

test("the plan says the before and the after, never just the delta", () => {
  /* 바꾸기 전에 사람이 보는 목록이다. 차이만 적으면 그 숫자가 맞는지 화면에서
     확인할 수 없다. */
  const rows = planTotalsRepair({
    pairs: pairsOf([{ instructorId: "u-me", clientId: "c1", serviceDeductions: 3 }]),
    sessionsOf: () => 25,
  });
  assert.deepEqual(rows[0].before, 25);
  assert.deepEqual(rows[0].after, 22);
});

test("the count never goes below zero, and says how much it swallowed", () => {
  /* 음수가 들어가면 규칙이 그 문서의 모든 쓰기를 거부하고(sessions >= 0),
     그때부터 그 회원의 차감이 통째로 막힌다.

     조용히 0 으로 만들지도 않는다 -- 깎인 만큼이 안 보이면 "왜 안 맞지" 가
     남는다. */
  const rows = planTotalsRepair({
    pairs: pairsOf([{ instructorId: "u-me", clientId: "c1", serviceDeductions: 9 }]),
    sessionsOf: () => 4,
  });
  assert.equal(rows[0].after, 0);
  assert.equal(rows[0].clamped, 5);
});

test("a pair with no totals document is reported, not created", () => {
  /* 문서가 없다는 것은 그 강사가 그 회원을 앱으로 가르친 적이 없다는 뜻이다.
     거기에 0 을 심으면 있지도 않던 기록이 생긴다. */
  const rows = planTotalsRepair({
    pairs: pairsOf([{ instructorId: "u-me", clientId: "c1", serviceDeductions: 2 }]),
    sessionsOf: () => null,
  });
  assert.equal(rows[0].skipped, "no_total_document");
  assert.equal(rows[0].after, null);
});

test("the summary separates what changes from what does not", () => {
  const rows = planTotalsRepair({
    pairs: pairsOf([
      { instructorId: "u-a", clientId: "c1", serviceDeductions: 3 },
      { instructorId: "u-b", clientId: "c2", serviceDeductions: 0 },
      { instructorId: "u-c", clientId: "c3", serviceDeductions: 1 },
    ]),
    sessionsOf: (instructorId) => (instructorId === "u-c" ? null : 10),
  });
  const found = summarizeRepair(rows);
  assert.equal(found.changing, 1);
  assert.equal(found.unchanged, 1);
  assert.equal(found.missingTotals, 1);
  assert.equal(found.sessionsRemoved, 3);
});

/* ── 엑셀 대조 ───────────────────────────────────────────────────────────── */

const sheetRow = (overrides = {}) => ({
  instructorId: "u-me", clientId: "c1", priorSessions: 10, ...overrides,
});

test("the sheet is summed per instructor-client pair, and the largest row is kept too", () => {
  /* 둘 다 필요하다. 저장값이 max 와 같으면 덮어쓰기로 마지막 줄만 남은
     것이고(옛 양식), sum 과 같으면 줄마다 총합을 적은 것이다(새 양식). */
  const sums = sheetTotals({ rows: [sheetRow({ priorSessions: 10 }), sheetRow({ priorSessions: 25 })] });
  assert.equal(sums.get("u-me_c1").sum, 35);
  assert.equal(sums.get("u-me_c1").max, 25);
  assert.equal(sums.get("u-me_c1").rows, 2);
});

test("a duet partner gets counted even though they have no row of their own", () => {
  /* 짝은 2차 시트에 자기 줄이 없다. 세지 않으면 그 회원이 비교 대상에서
     통째로 빠지고, 누적이 모자라도 드러나지 않는다. */
  const sums = sheetTotals({
    rows: [sheetRow({ partnerClientId: "c2", partnerPriorSessions: 10 })],
  });
  assert.equal(sums.get("u-me_c2").sum, 10);
});

test("matching the sum is the healthy case and drops out of the report", () => {
  const sums = sheetTotals({ rows: [sheetRow({ priorSessions: 35 })] });
  assert.deepEqual(compareWithStored({ sums, sessionsOf: () => 35 }), []);
});

test("a member whose stored count equals only the last row is the overwrite we are hunting", () => {
  /* 이것이 이 스크립트를 만든 이유다. 세 장을 올렸는데 마지막 한 장의 숫자만
     남아 있으면 그 회원의 누적이 그만큼 모자라다. */
  const sums = sheetTotals({ rows: [
    sheetRow({ priorSessions: 10 }), sheetRow({ priorSessions: 20 }), sheetRow({ priorSessions: 5 }),
  ] });
  const [row] = compareWithStored({ sums, sessionsOf: () => 20 });
  assert.equal(row.looksLike, "matches_last_row_only");
  assert.equal(row.sheetSum, 35);
  assert.equal(row.stored, 20);
});

test("a single-row member is never called an overwrite", () => {
  /* 한 줄이면 sum 과 max 가 같아 덮어쓰기로 깨질 수 없다. 저장값이 다르면
     그것은 이관 뒤에 쌓인 실제 수업이다 -- 다른 이야기다. */
  const sums = sheetTotals({ rows: [sheetRow({ priorSessions: 10 })] });
  const [row] = compareWithStored({ sums, sessionsOf: () => 14 });
  assert.equal(row.looksLike, "neither");
});

test("a pair with no stored document is called out separately", () => {
  const sums = sheetTotals({ rows: [sheetRow()] });
  const [row] = compareWithStored({ sums, sessionsOf: () => null });
  assert.equal(row.looksLike, "no_total_document");
  assert.equal(summarizeAudit([row], sums).missingTotals, 1);
});
