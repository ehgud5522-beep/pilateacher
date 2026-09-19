import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorClientSessionsOf, previewLessonRates, previewMemberRate,
} from "../../src/features/schedule/lesson-rate-preview.js";
import { deductPass } from "../../src/data/repositories/pass-repository.js";

const NOW = new Date(2026, 8, 20, 12, 0, 0);

const member = (overrides = {}) => ({ id: "m-1", name: "김하나", orgClientId: "client-a", ...overrides });

const pass = (overrides = {}) => ({
  id: "pass-a",
  clientId: "client-a",
  locationId: "bansong",
  category: "pt_1_1_repurchase_event",
  baseUnitPrice: 30000,
  contractPrice: 1300000,
  netContractPrice: 1300000,
  paymentMethod: "cash",
  totalSessions: 20,
  serviceSessions: 0,
  serviceUsed: 0,
  handedOver: false,
  remainingCount: 8,
  status: "active",
  expiresAt: new Date(2027, 0, 31),
  ...overrides,
});

const totals = (sessions) => [{ id: "u1_client-a", instructorId: "u1", clientId: "client-a", sessions }];

const preview = (overrides = {}) => previewMemberRate({
  member: member(), passes: [pass()], totals: totals(40), instructorId: "u1",
  isDeputyDirector: false, now: NOW, ...overrides,
});

/* ── 미리 보여주는 값이 실제 차감과 같아야 한다 ─────────────────────────────

   강사가 확정을 누른 뒤에 금액을 처음 보면 "왜 이 금액이지" 를 나중에 묻게 되고,
   그때는 원장이 append-only 라 고칠 수도 없다. 그런데 미리 본 값과 실제 값이
   다르면 그 화면은 아예 믿을 수 없는 것이 된다. */

test("the preview is the number the deduction will actually write", async () => {
  const cases = [
    { label: "기준 단가", totals: 40, pass: {} },
    { label: "누적 20회 미만", totals: 3, pass: {} },
    { label: "인수인계", totals: 40, pass: { handedOver: true } },
    { label: "서비스 첫 회차", totals: 40, pass: { serviceSessions: 1, serviceUsed: 0 } },
    { label: "서비스 두 번째", totals: 40, pass: { serviceSessions: 2, serviceUsed: 1 } },
    { label: "부원장", totals: 40, pass: {}, deputy: true },
  ];

  for (const item of cases) {
    const onePass = pass(item.pass);
    const shown = previewMemberRate({
      member: member(), passes: [onePass], totals: totals(item.totals),
      instructorId: "u1", isDeputyDirector: item.deputy === true, now: NOW,
    });

    /* 실제 차감을 돌려 같은 값이 나오는지 본다. 미리보기가 계산을 다시 구현하지
       않고 같은 엔진을 부르는지를 이 한 줄이 지킨다. */
    const writes = [];
    const store = {
      list: async () => [],
      read: async () => ({ sessions: item.totals }),
      commit: async (batch) => { writes.push(batch); },
      serverTimestamp: async () => "SERVER_TIME",
    };
    const { entry } = await deductPass("center-a", onePass, {
      instructorId: "u1", createdBy: "u1", occurredAt: NOW, isDeputyDirector: item.deputy === true,
    }, { store, newId: () => "lesson-x", now: () => NOW });

    assert.equal(shown.unitPrice, entry.unitPrice, `${item.label}: 금액`);
    assert.equal(shown.rule, entry.rule, `${item.label}: 사유`);
  }
});

test("the preview picks the same pass the settlement would", () => {
  /* 만료가 이른 것부터 쓴다. 다른 회원권을 골라 보여주면 금액도 사유도 달라진다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({ id: "later", expiresAt: new Date(2027, 5, 1), baseUnitPrice: 30000 }),
      pass({ id: "sooner", expiresAt: new Date(2026, 11, 1), baseUnitPrice: 25000, category: "pt_1_1_new" }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "sooner");
  assert.equal(shown.unitPrice, 25000);
});

/* ── 차감할 수 없는 경우 ───────────────────────────────────────────────── */

test("no pass and a spent pass are different problems, said differently", () => {
  /* 앞은 발급이고 뒤는 재등록이다. 한 문구로 뭉개면 강사가 무엇을 해야 하는지
     알 수 없다. */
  assert.equal(preview({ passes: [] }).skip, "no_pass");
  assert.equal(preview({ passes: [pass({ remainingCount: 0 })] }).skip, "spent");
  assert.equal(preview({ passes: [pass({ expiresAt: new Date(2026, 0, 1) })] }).skip, "spent");
});

test("a member the centre does not know gets no number at all", () => {
  // 금액을 지어내지 않는다. 차감할 회원권이 없는 회원이다.
  assert.equal(preview({ member: member({ orgClientId: "" }) }).skip, "no_client");
});

test("a judgement that cannot finish says so instead of showing a made-up number", () => {
  /* 부원장인데 공급가액을 읽을 수 없는 회원권이다. 확정이 실패할 것을 미리
     말하고, 원본 코드를 함께 남긴다 -- 없으면 무엇을 고쳐야 하는지 알 수 없다. */
  const broken = pass();
  delete broken.netContractPrice;
  delete broken.paymentMethod;
  const shown = preview({ passes: [broken], isDeputyDirector: true });
  assert.equal(shown.skip, "write_failed");
  assert.match(shown.code, /netContractPrice/);
});

test("a pass issued before the rename still previews", () => {
  const legacy = pass();
  delete legacy.baseUnitPrice;
  legacy.unitPrice = 30000;
  assert.equal(preview({ passes: [legacy] }).unitPrice, 30000);
});

/* ── 누적 찾기 ─────────────────────────────────────────────────────────── */

test("the cumulative count is found by the instructor-client pair", () => {
  assert.equal(instructorClientSessionsOf(totals(40), "u1", "client-a"), 40);
  // 다른 강사에게는 그 회원이 처음이다. 0 이 맞는 답이다.
  assert.equal(instructorClientSessionsOf(totals(40), "u2", "client-a"), 0);
  assert.equal(instructorClientSessionsOf(totals(40), "u1", "client-b"), 0);
  assert.equal(instructorClientSessionsOf([], "u1", "client-a"), 0);
  assert.equal(instructorClientSessionsOf(null, "u1", "client-a"), 0);
});

/* ── 수업 한 건 ───────────────────────────────────────────────────────── */

test("every attendee gets a number, whatever their attendance says", () => {
  /* 확정 전에 보여주는 것이 목적이다. 아직 아무도 출석을 누르지 않은 수업에서도
     서야 한다 -- 눌러야 보이면 "확정하면 얼마인가" 를 미리 알 수 없다. */
  const lesson = {
    id: "lesson-1",
    attendees: [
      { memberId: "m-1", status: "booked" },
      { memberId: "m-2", status: "noshow" },
    ],
  };
  const rates = previewLessonRates({
    lesson,
    members: [member(), member({ id: "m-2", orgClientId: "client-b" })],
    passes: [pass(), pass({ id: "pass-b", clientId: "client-b", baseUnitPrice: 35000, category: "pt_2_1_repurchase" })],
    totals: [...totals(40), { id: "u1_client-b", instructorId: "u1", clientId: "client-b", sessions: 40 }],
    instructorId: "u1", now: NOW,
  });
  assert.equal(rates.get("m-1").unitPrice, 30000);
  assert.equal(rates.get("m-2").unitPrice, 35000);
});

test("a lesson that names one member without an attendee list still works", () => {
  const rates = previewLessonRates({
    lesson: { id: "lesson-1", memberId: "m-1" },
    members: [member()], passes: [pass()], totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(rates.get("m-1").unitPrice, 30000);
});

test("an attendee the roster does not have is skipped, not guessed at", () => {
  const rates = previewLessonRates({
    lesson: { id: "lesson-1", attendees: [{ memberId: "gone" }] },
    members: [member()], passes: [pass()], totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(rates.size, 0);
});
