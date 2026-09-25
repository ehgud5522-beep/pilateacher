import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_DEMO_BADGE, isReviewDemo, passIsReviewDemo, reviewDemoClientIds,
  visibleToRole, withoutReviewDemo,
} from "../../src/features/members/review-demo.js";

/**
 * 심사용 회원은 사람이 아니다.
 *
 * 한 군데라도 새면 가짜 회원이 진짜 숫자에 섞이고, 그 숫자로 강사 급여가
 * 나간다. 이 파일이 지키는 것은 "빠지는가" 하나다.
 */

const clients = [
  { id: "csv_01011112222", name: "김하나", locationId: "bansong" },
  { id: "review-demo-1", name: "심사용 회원", locationId: "bansong", reviewDemo: true },
  { id: "csv_01033334444", name: "박두리", locationId: "centum" },
];

test("표시가 있는 회원만 심사용이다", () => {
  assert.equal(isReviewDemo({ reviewDemo: true }), true);
  // 참값만 본다. "true" 문자열이나 1 로는 켜지지 않는다.
  assert.equal(isReviewDemo({ reviewDemo: "true" }), false);
  assert.equal(isReviewDemo({ reviewDemo: 1 }), false);
  assert.equal(isReviewDemo({}), false);
  assert.equal(isReviewDemo(null), false);
});

test("빼야 할 id 를 모은다", () => {
  /* 집계는 원장을 읽는데 원장 항목에는 이 표시가 없다 -- 명부에서 id 를
     모아 두고 그것으로 거른다. */
  assert.deepEqual([...reviewDemoClientIds(clients)], ["review-demo-1"]);
  assert.deepEqual([...reviewDemoClientIds([])], []);
  assert.deepEqual([...reviewDemoClientIds(null)], []);
});

test("clientId 로 적힌 회원도 모은다", () => {
  // 명부는 id 로, 이관분은 clientId 로 온다. 둘 다 같은 회원이다.
  assert.deepEqual(
    [...reviewDemoClientIds([{ clientId: "csv_1", reviewDemo: true }])],
    ["csv_1"],
  );
});

/* ── 보이는 것과 세는 것은 다르다 ───────────────────────────────────── */

test("대표에게는 보이고 나머지에게는 안 보인다", () => {
  /* 대표는 그 회원이 거기 있다는 것을 알아야 한다. 안 보이면 왜 숫자가
     안 맞는지 물을 곳이 없다. */
  assert.equal(visibleToRole(clients, { role: "owner" }).length, 3);
  for (const role of ["manager", "instructor", "staff", ""]) {
    const seen = visibleToRole(clients, { role });
    assert.equal(seen.length, 2, role);
    assert.equal(seen.some((client) => client.reviewDemo), false, role);
  }
});

test("세는 자리에서는 대표에게도 뺀다", () => {
  /* 보이는 문제가 아니라 세는 문제다. 대표의 급여 합계에 가짜가 섞이면
     그것이 가장 나쁘다. */
  const excluded = reviewDemoClientIds(clients);
  const rows = [
    { clientId: "csv_01011112222", unitPrice: 30000 },
    { clientId: "review-demo-1", unitPrice: 0 },
    { clientId: "csv_01033334444", unitPrice: 25000 },
  ];
  assert.deepEqual(
    withoutReviewDemo(rows, excluded).map((row) => row.clientId),
    ["csv_01011112222", "csv_01033334444"],
  );
});

test("뺄 것이 없으면 목록을 그대로 돌려준다", () => {
  const rows = [{ clientId: "a" }];
  assert.equal(withoutReviewDemo(rows, new Set()), rows);
  assert.equal(withoutReviewDemo(rows, null), rows);
});

test("다른 열쇠로도 거른다", () => {
  // 발급 내역은 항목마다 모양이 조금씩 다르다.
  const excluded = new Set(["review-demo-1"]);
  const rows = [{ member: "review-demo-1" }, { member: "csv_1" }];
  assert.deepEqual(
    withoutReviewDemo(rows, excluded, (row) => row.member).map((row) => row.member),
    ["csv_1"],
  );
});

/* ── 회원권 ──────────────────────────────────────────────────────────── */

test("심사용 회원의 회원권을 가려낸다", () => {
  const excluded = new Set(["review-demo-1"]);
  assert.equal(passIsReviewDemo({ clientId: "review-demo-1" }, excluded), true);
  assert.equal(passIsReviewDemo({ clientId: "csv_1" }, excluded), false);
  // 듀엣은 한쪽만 심사용일 수 없지만, 한 사람이라도 걸리면 뺀다.
  assert.equal(passIsReviewDemo({ clientId: "csv_1", clientIds: ["csv_1", "review-demo-1"] }, excluded), true);
  assert.equal(passIsReviewDemo({ clientId: "csv_1" }, new Set()), false);
});

test("배지 문구는 대표 화면의 것이다", () => {
  // 회원 앱에는 이 말이 없다. 심사관에게 보이면 안 된다.
  assert.equal(REVIEW_DEMO_BADGE, "심사용");
});
