import assert from "node:assert/strict";
import test from "node:test";
import {
  blockingNotice, duetIssueNotices, duetSummaryLine, productLooksDuet, reviewNotices,
} from "../../src/features/passes/duet-issue.js";

const NOW = new Date(2026, 9, 1);

const client = (overrides = {}) => ({ id: "c-1", name: "김하나", locationId: "bansong", ...overrides });
const partner = (overrides = {}) => client({ id: "c-2", name: "박두리", ...overrides });
const duetProduct = (overrides = {}) => ({ id: "p-1", name: "2:1 30회", sessionType: "pt_2_1", payCategory: "pt_2_1_new", ...overrides });
const soloProduct = (overrides = {}) => ({ id: "p-2", name: "1:1 20회", sessionType: "pt_1_1", payCategory: "pt_1_1_new", ...overrides });

const pass = (overrides = {}) => ({
  id: "pass-a", clientId: "c-1", status: "active", remainingCount: 8,
  expiresAt: new Date(2027, 0, 31), ...overrides,
});

const codesOf = (notices) => notices.map((item) => item.code);

/* ── 상품이 2:1 이라고 말하는 방법은 둘이다 ───────────────────────────── */

test("a duet product is recognised by its category or by its session type", () => {
  assert.equal(productLooksDuet(duetProduct()), true);
  assert.equal(productLooksDuet(duetProduct({ payCategory: "pt_2_1_repurchase" })), true);
  /* 2:1 상품을 서비스나 기타 카테고리로 파는 경우가 있고, 그때도 회원은 둘이다.
     카테고리만 보면 그 계약에서 듀엣 경고가 사라진다. */
  assert.equal(productLooksDuet(duetProduct({ payCategory: "etc" })), true);
  assert.equal(productLooksDuet(soloProduct()), false);
  assert.equal(productLooksDuet(null), false);
});

/* ── 막는 것 ─────────────────────────────────────────────────────────── */

test("a duet without a second member cannot be issued", () => {
  const notices = duetIssueNotices({ duet: true, client: client(), product: duetProduct(), now: NOW });
  assert.equal(blockingNotice(notices)?.code, "partner_missing");
});

test("the same person cannot be both halves", () => {
  /* 회차는 하나인데 누적이 둘 올라간다. 20회 판정이 두 배 속도로 지나가고,
     그 시점부터 단가가 조용히 틀린다. */
  const notices = duetIssueNotices({
    duet: true, client: client(), partner: client(), product: duetProduct(), now: NOW,
  });
  assert.equal(blockingNotice(notices)?.code, "partner_is_self");
});

test("a 1:1 issue is never blocked by any of this", () => {
  const notices = duetIssueNotices({ duet: false, client: client(), product: soloProduct(), now: NOW });
  assert.equal(blockingNotice(notices), null);
  assert.deepEqual(notices, []);
});

/* ── 어긋나면 확인을 띄운다 ──────────────────────────────────────────── */

test("a 2:1 product issued to one member asks the owner to look again", () => {
  const notices = duetIssueNotices({ duet: false, client: client(), product: duetProduct(), now: NOW });
  assert.deepEqual(codesOf(notices), ["category_duet_without_partner"]);
  assert.equal(notices[0].level, "confirm");
});

test("a duet sold on a 1:1 product asks too, because payroll follows the category", () => {
  const notices = duetIssueNotices({
    duet: true, client: client(), partner: partner(), product: soloProduct(), now: NOW,
  });
  assert.deepEqual(codesOf(notices), ["category_not_duet"]);
});

test("neither mismatch blocks the issue — both shapes really happen", () => {
  /* 2:1 상품을 혼자 쓰는 계약도, 1:1 상품을 둘이 쓰기로 한 계약도 있다. 막으면
     그 정당한 계약을 팔 수 없다. */
  for (const input of [
    { duet: false, client: client(), product: duetProduct() },
    { duet: true, client: client(), partner: partner(), product: soloProduct() },
  ]) {
    assert.equal(blockingNotice(duetIssueNotices({ ...input, now: NOW })), null);
  }
});

test("a matching product says nothing at all", () => {
  assert.deepEqual(duetIssueNotices({
    duet: true, client: client(), partner: partner(), product: duetProduct(), now: NOW,
  }), []);
});

/* ── 이미 회원권이 있는 회원 ─────────────────────────────────────────── */

test("an existing usable pass is said out loud but does not block", () => {
  /* 재등록은 만료 전에 미리 하는 일이 잦고, 남은 회차와 새 회원권이 함께 있는
     것은 정상이다. 다만 회원을 잘못 골랐으면 여기서 드러난다. */
  const notices = duetIssueNotices({
    duet: false, client: client(), product: soloProduct(), passes: [pass()], now: NOW,
  });
  assert.deepEqual(codesOf(notices), ["already_has_pass"]);
  assert.equal(notices[0].level, "warn");
  assert.match(notices[0].message, /김하나님에게 이미 쓸 수 있는 회원권이 있습니다 \(잔여 8회\)/);
});

test("both halves of a duet are checked, not just the one being searched for", () => {
  const notices = duetIssueNotices({
    duet: true, client: client(), partner: partner(), product: duetProduct(), now: NOW,
    passes: [pass({ id: "p-a", clientId: "c-1" }), pass({ id: "p-b", clientId: "c-2", remainingCount: 3 })],
  });
  assert.deepEqual(codesOf(notices), ["already_has_pass", "already_has_pass"]);
  assert.match(notices[0].message, /김하나/);
  assert.match(notices[1].message, /박두리/);
});

test("the partner's own duet pass counts as theirs", () => {
  // 짝은 대표가 아니므로 clientId 로만 찾으면 이 회원권이 보이지 않는다.
  const notices = duetIssueNotices({
    duet: true, client: client({ id: "c-3", name: "이세리" }), partner: partner(), product: duetProduct(), now: NOW,
    passes: [pass({ clientId: "c-1", clientIds: ["c-1", "c-2"] })],
  });
  assert.deepEqual(codesOf(notices), ["already_has_pass"]);
  assert.match(notices[0].message, /박두리/);
});

test("a spent or expired pass is not an existing pass", () => {
  /* 쓸 수 없는 회원권을 경고하면 재등록할 때마다 경고가 뜨고, 경고는 곧
     읽히지 않는 것이 된다. */
  const notices = duetIssueNotices({
    duet: false, client: client(), product: soloProduct(), now: NOW,
    passes: [
      pass({ id: "spent", remainingCount: 0 }),
      pass({ id: "expired", expiresAt: new Date(2026, 0, 1) }),
      pass({ id: "cancelled", status: "cancelled" }),
    ],
  });
  assert.deepEqual(notices, []);
});

/* ── 화면이 나누는 방식 ──────────────────────────────────────────────── */

test("what blocks and what merely warns are kept apart", () => {
  const notices = duetIssueNotices({
    duet: true, client: client(), product: soloProduct(), passes: [pass()], now: NOW,
  });
  assert.equal(blockingNotice(notices)?.code, "partner_missing");
  // 확인 화면은 막는 것을 다시 말하지 않는다 -- 거기까지 갈 수 없기 때문이다.
  assert.ok(!codesOf(reviewNotices(notices)).includes("partner_missing"));
  assert.deepEqual(codesOf(reviewNotices(notices)), ["category_not_duet", "already_has_pass"]);
});

test("the summary says the sessions are shared, not doubled", () => {
  // 대표가 각자 30회로 오해하면 계약 자체가 틀어진다.
  assert.equal(duetSummaryLine(30), "30회를 두 분이 함께 씁니다 · 수업 한 번에 1회 차감");
});
