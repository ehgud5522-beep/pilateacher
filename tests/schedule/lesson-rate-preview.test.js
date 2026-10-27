import assert from "node:assert/strict";
import test from "node:test";
import {
  instructorClientSessionsOf, previewLessonRates, previewMemberRate,
} from "../../src/features/schedule/lesson-rate-preview.js";
import { planLessonSettlement } from "../../src/features/schedule/lesson-settlement.js";
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
  /* 차수가 고르는 순서다 (2026-10-09). 기본값이 없으면 모든 회원권이
     "차수를 못 읽음" 으로 떨어져 배열 순서가 답이 된다. */
  purchaseRound: 1,
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
  /* **먼저 만료되는 것부터 쓴다** (2026-10-22). 다른 회원권을 골라 보여주면
     금액도 사유도 달라지고, 강사가 본 숫자와 원장에 박히는 숫자가 갈라진다.

     ── 두 번 뒤집힌 자리다 ──
     2026-10-09 에 만료일 순에서 차수 순으로 바뀌었고, 10-22 에 돌아왔다.
     돌아온 이유는 실제로 손실이 났기 때문이다 -- 뒤 차수가 먼저 만료되면 그
     회차는 손도 못 대 보고 사라지고, 그것은 회원이 돈을 낸 회차다.

     여기서 2차의 만료가 더 이르다. 차수로 고르면 1차(25,000)이고, 만료일로
     고르면 2차(30,000)다 -- **금액이 달라지므로** 어느 쪽을 골랐는지가
     단가 하나로 드러난다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 11, 1), baseUnitPrice: 30000 }),
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 5, 1), baseUnitPrice: 25000, category: "pt_1_1_new" }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "second");
  assert.equal(shown.unitPrice, 30000);
});

/* ── 만료일 순 (2026-10-22 대표 확정) ───────────────────────────────────
   **두 번 뒤집힌 자리다.** 10-09 에 만료일 순 → 차수 순, 10-22 에 다시
   만료일 순이다. 돌아온 이유는 실제로 손실이 났기 때문이다 -- 뒤 차수가 먼저
   만료되면 그 회차는 손도 못 대 보고 사라지고, 그것은 회원이 돈을 낸 회차다.

   그래서 **expiryOutOfOrder 경고는 이제 울릴 일이 없다.** 그 화면이 막으려던
   상황을 이 정렬이 먼저 없앤다. */

test("만료가 이른 2차 렛미인이 만료가 늦은 1차 신규보다 먼저 빠진다", () => {
  /* 대표가 든 예시 그대로다. 차수로 고르면 1차 신규(25,000)이고, 만료일로
     고르면 2차 렛미인(28,000)이다 -- 금액이 달라 어느 쪽을 골랐는지가 단가
     하나로 드러난다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "letmein", purchaseRound: 2, category: "letmein", baseUnitPrice: 28000,
        expiresAt: new Date(2026, 10, 30),
      }),
      pass({
        id: "new", purchaseRound: 1, category: "pt_1_1_new", baseUnitPrice: 25000,
        expiresAt: new Date(2027, 5, 1),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "letmein");
  assert.equal(shown.unitPrice, 28000, "단가는 고른 회원권의 것이다");
});

test("만료일이 같으면 차수가 낮은 것부터", () => {
  const sameDay = new Date(2027, 0, 1);
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({ id: "second", purchaseRound: 2, baseUnitPrice: 30000, expiresAt: sameDay }),
      pass({ id: "first", purchaseRound: 1, baseUnitPrice: 25000, expiresAt: sameDay, category: "pt_1_1_new" }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "first");
});

test("만료일이 없는 회원권은 맨 뒤다", () => {
  /* "언제까지든 쓸 수 있다" 는 뜻이라 급하지 않다. 0 으로 보면 그것이 모든
     회원권보다 먼저 쓰이고, 그 순간 만료가 코앞인 회차가 밀려 사라진다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({ id: "forever", purchaseRound: 1, baseUnitPrice: 25000, expiresAt: null, category: "pt_1_1_new" }),
      pass({ id: "soon", purchaseRound: 2, baseUnitPrice: 30000, expiresAt: new Date(2026, 10, 30) }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "soon");
});

/* ── 율하 강은경 건 (2026-10-22 대표 보고) ──────────────────────────────
   75회 재등록(이벤트) 3차 · 만료 11/14 가 있는데 20회 깍두기 4차 · 만료
   2027-03-31 에서 3회가 빠졌다. **차수 순으로도 설명이 안 되는 자리다** --
   3차가 4차보다 먼저여야 했다.

   아래 두 테스트가 새 정렬로 이것이 어떻게 끝나는지 고정한다. 실제 문서의
   값은 읽지 못했으므로(이 기기에 Admin 자격이 없다) 대표가 말한 모양 그대로
   세운다. */

/* Firestore 는 Date 가 아니라 Timestamp 를 돌려준다. 정렬이 그것을 못 읽으면
   모든 회원권이 MAX_SAFE_INTEGER 로 **같은 값**이 되어 비교가 통째로 무력해지고,
   정렬은 배열 순서를 그대로 돌려준다 -- 2026-10-02~10-08 에 실제로 그랬다. */
const stamp = (date) => ({ toDate: () => date });

test("Timestamp 로 와도 만료일 순이 선다", () => {
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "late", purchaseRound: 1, category: "pt_1_1_new", baseUnitPrice: 25000,
        expiresAt: stamp(new Date(2027, 2, 31)), createdAt: stamp(new Date(2026, 9, 1)),
      }),
      pass({
        id: "soon", purchaseRound: 2, baseUnitPrice: 30000,
        expiresAt: stamp(new Date(2026, 10, 14)), createdAt: stamp(new Date(2026, 9, 1)),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "soon", "Timestamp 를 못 읽으면 배열 순서가 답이 되어 late 가 나온다");
});

test("만료일·차수가 같으면 Timestamp 생성일이 가른다", () => {
  /* createdAt 도 Timestamp 로 온다. 여기가 blind 하면 마지막 가름이 무력해져
     배열 순서가 답이 된다 -- 조용하고, 아무 화면도 말하지 않는다. */
  const sameDay = new Date(2027, 0, 31);
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "newer", purchaseRound: 1, category: "pt_1_1_new", baseUnitPrice: 25000,
        expiresAt: stamp(sameDay), createdAt: stamp(new Date(2026, 9, 20)),
      }),
      pass({
        id: "older", purchaseRound: 1, category: "pt_1_1_new", baseUnitPrice: 25000,
        expiresAt: stamp(sameDay), createdAt: stamp(new Date(2026, 9, 1)),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "older", "먼저 끊은 것이 먼저 나간다");
});

test("강은경 건 — 만료가 이른 75회권이 먼저 빠진다", () => {
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "kkakdugi-20", purchaseRound: 4, category: "pt_1_1_repurchase_normal",
        baseUnitPrice: 35000, totalSessions: 20, remainingCount: 17,
        expiresAt: new Date(2027, 2, 31),
      }),
      pass({
        id: "event-75", purchaseRound: 3, category: "pt_1_1_repurchase_event",
        baseUnitPrice: 30000, totalSessions: 75, remainingCount: 60,
        expiresAt: new Date(2026, 10, 14),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "event-75");
});

test("강은경 건 — 75회권에 차수가 없어도 만료일이 먼저라 그것이 빠진다", () => {
  /* **차수 순이던 동안 4차가 이긴 이유로 가장 그럴듯한 것이다.** roundOf 는
     purchaseRound 를 못 읽으면 MAX_SAFE_INTEGER 를 돌려준다 -- 차수 순
     정렬에서 그 회원권은 **맨 뒤**로 밀린다. 상품명에 "3차" 가 적혀 있어도
     필드가 비어 있으면 코드는 그것을 모른다.

     새 정렬에서는 만료일이 첫 번째 키라 이 경우에도 75회권이 먼저 나간다 --
     원인이 무엇이었든 이 자리는 닫힌다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "kkakdugi-20", purchaseRound: 4, category: "pt_1_1_repurchase_normal",
        baseUnitPrice: 35000, remainingCount: 17, expiresAt: new Date(2027, 2, 31),
      }),
      pass({
        id: "event-75", purchaseRound: undefined, category: "pt_1_1_repurchase_event",
        baseUnitPrice: 30000, remainingCount: 60, expiresAt: new Date(2026, 10, 14),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "event-75", "차수를 못 읽어도 만료일이 이긴다");
});

test("강은경 건 — 75회권이 걸러졌다면 새 정렬로도 깍두기가 나간다", () => {
  /* **정렬이 고치지 못하는 갈래다.** 잔여 0 · 비활성 · 2:1 카테고리처럼
     거름망에서 떨어진 것이면 순서를 아무리 바꿔도 후보에 없다.

     그래서 원인을 확정하기 전에는 "고쳤다" 고 말할 수 없다. 이 테스트는 그
     사실을 적어 둔다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "kkakdugi-20", purchaseRound: 4, category: "pt_1_1_repurchase_normal",
        baseUnitPrice: 35000, remainingCount: 17, expiresAt: new Date(2027, 2, 31),
      }),
      pass({
        id: "event-75", purchaseRound: 3, category: "pt_1_1_repurchase_event",
        baseUnitPrice: 30000, remainingCount: 0, expiresAt: new Date(2026, 10, 14),
      }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "kkakdugi-20");
});

test("종류가 먼저다 — 2:1 이 아무리 빨리 만료돼도 1:1 수업에 쓰이지 않는다", () => {
  /* 정렬은 **걸러낸 뒤**에 돈다. 종류를 넘어 고르면 회원은 자기가 산 것과
     다른 회차를 잃는다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "duet", purchaseRound: 1, category: "pt_2_1_repurchase", baseUnitPrice: 35000,
        clientIds: ["client-a", "other"], expiresAt: new Date(2026, 9, 25),
      }),
      pass({ id: "solo", purchaseRound: 2, baseUnitPrice: 30000, expiresAt: new Date(2027, 5, 1) }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "solo");
});

test("서비스 회차 우선 소진은 이 정렬과 부딪치지 않는다", () => {
  /* **다른 층위다.** 이 정렬은 "어느 회원권" 을 고르고, 그 안에서 "어느
     회차" 를 쓸지는 spendsServiceSession 이 답한다.

     만료가 이른 회원권에 서비스가 남아 있으면 그 회원권이 뽑히고, 그 안에서
     서비스부터 나간다 -- 둘이 서로를 가로채지 않는다. */
  const shown = previewMemberRate({
    member: member(),
    passes: [
      pass({
        id: "soon-with-service", purchaseRound: 2, baseUnitPrice: 30000,
        expiresAt: new Date(2026, 10, 30), serviceSessions: 2, serviceUsed: 0,
      }),
      pass({ id: "later", purchaseRound: 1, baseUnitPrice: 25000, expiresAt: new Date(2027, 5, 1) }),
    ],
    totals: totals(40), instructorId: "u1", now: NOW,
  });
  assert.equal(shown.passId, "soon-with-service", "만료가 이른 쪽을 고른다");
  /* 미리보기는 카테고리를 돌려주지 않는다. 어느 회차를 쓰는지는 rule 이
     말한다 -- service_first 면 그 회원권 안에서 서비스가 먼저 나간 것이다. */
  assert.equal(shown.rule, "service_first", "그 안에서는 서비스가 먼저다");
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
  /* 한 수업에 둘을 넣지 않는다. 수업 종류가 기준이 된 뒤로 회원이 둘이면
     듀엣이고, 공유 회원권이 없으면 금액이 아니라 사유가 나온다 -- 여기서
     보려는 것은 그것이 아니라 "출석을 누르기 전에도 금액이 선다" 이다. */
  const rateFor = (status) => previewLessonRates({
    lesson: { id: "lesson-1", attendees: [{ memberId: "m-1", status }] },
    members: [member()],
    passes: [pass()],
    totals: totals(40),
    instructorId: "u1", now: NOW,
  }).get("m-1");

  for (const status of ["booked", "done", "noshow"]) {
    assert.equal(rateFor(status).unitPrice, 30000, status);
  }
});

test("듀엣 수업은 짝이 결석해도 공유 회원권 금액을 보여준다", () => {
  /* 확정이 공유 회원권에서 뺄 것이므로 미리보기도 그 금액이어야 한다.
     두 줄에 같은 금액이 서지만 나가는 것은 한 번이라, deducts 로 가린다. */
  const duetLesson = {
    id: "lesson-1",
    type: "듀엣",
    attendees: [{ memberId: "m-1", status: "done" }, { memberId: "m-2", status: "cancel" }],
  };
  const rates = previewLessonRates({
    lesson: duetLesson,
    members: [member(), member({ id: "m-2", orgClientId: "client-b" })],
    passes: [pass({
      id: "pass-duet", clientIds: ["client-a", "client-b"],
      category: "pt_2_1_new", baseUnitPrice: 30000,
    })],
    totals: [...totals(40), { id: "u1_client-b", instructorId: "u1", clientId: "client-b", sessions: 40 }],
    instructorId: "u1", now: NOW,
  });
  assert.equal(rates.get("m-1").passId, "pass-duet");
  assert.equal(rates.get("m-1").shared, true);
  assert.equal(rates.get("m-1").deducts, true);
  assert.equal(rates.get("m-2").deducts, false, "나가는 것은 한 번이다");
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

/* ── 차감 규칙 일곱 가지에서 미리보기와 확정이 같은 회원권을 고르는가 ───────

   갈라지면 강사는 화면에서 본 금액과 다른 금액이 원장에 박히는 것을 보게
   되고, 원장은 append-only 라 그때는 되돌릴 수도 없다. 두 화면이 같은 함수를
   부른다는 것만으로는 부족하다 -- 규칙마다 실제로 같은 passId 가 나오는지를
   여기서 견준다. */

const A = "client-a";
const B = "client-b";

const solo = (id, overrides = {}) => pass({
  id, clientId: A, clientIds: [A], category: "pt_1_1_repurchase_event", ...overrides,
});
const duet = (id, overrides = {}) => pass({
  id, clientId: A, clientIds: [A, B], category: "pt_2_1_new", baseUnitPrice: 35000, ...overrides,
});

/**
 * A 의 1:1 2장 + A·B 공유 2장. 종류마다 1차와 2차가 있다.
 *
 * 만료일은 일부러 차수와 **반대로** 둔다 -- 2차가 먼저 만료된다. 그래서 차수로
 * 고르는지 만료일로 고르는지가 고른 회원권 하나로 드러난다.
 *
 * 2026-10-22 부터 **먼저 만료되는 것**을 쓴다. 이름을 만료 순으로 바꿔
 * 두었다 -- 전에는 `-soon`/`-late` 가 차수를 가리켜서, 순서가 뒤집힌 뒤에는
 * 읽는 사람이 반대로 이해한다.
 */
const FOUR = [
  solo("solo-expires-first", { purchaseRound: 2, expiresAt: new Date(2027, 2, 1) }),
  solo("solo-expires-later", { purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
  duet("duet-expires-first", { purchaseRound: 2, expiresAt: new Date(2026, 10, 1) }),
  duet("duet-expires-later", { purchaseRound: 1, expiresAt: new Date(2026, 11, 1) }),
];

const PEOPLE = [
  member({ id: "m-a", name: "성승현", orgClientId: A }),
  member({ id: "m-b", name: "김민정", orgClientId: B }),
];
const SESSIONS = [
  { id: "u1_client-a", instructorId: "u1", clientId: A, sessions: 40 },
  { id: "u1_client-b", instructorId: "u1", clientId: B, sessions: 40 },
];

test("미리보기와 확정이 일곱 가지 모두 같은 회원권을 고른다", () => {
  const cases = [
    { label: "1 A 혼자 출석", attendees: [["m-a", "done"]], expect: { "m-a": "solo-expires-first" } },
    {
      label: "2 둘 다 출석",
      attendees: [["m-a", "done"], ["m-b", "done"]],
      expect: { "m-a": "duet-expires-first", "m-b": "duet-expires-first" },
    },
    {
      label: "3 한 명 노쇼",
      attendees: [["m-a", "done"], ["m-b", "noshow"]],
      expect: { "m-a": "duet-expires-first", "m-b": "duet-expires-first" },
    },
    {
      /* 2026-10-04 변경 — 전에는 둘 다 노쇼면 확정이 차감하지 않았고, 그래서
         미리보기만 공유 회원권을 가리켰다. 이제 노쇼도 1회 차감하므로 둘이
         완전히 같다. */
      label: "4 둘 다 노쇼",
      attendees: [["m-a", "noshow"], ["m-b", "noshow"]],
      expect: { "m-a": "duet-expires-first", "m-b": "duet-expires-first" },
    },
    {
      /* 2026-10-01 변경 — 전에는 취소한 사람을 명단에서 지워 남은 한 명이
         1:1 수업을 한 것으로 봤다. 지금은 등록한 종류가 기준이라 듀엣이다. */
      label: "5 B 미리 취소",
      attendees: [["m-a", "done"], ["m-b", "cancel"]],
      expect: { "m-a": "duet-expires-first", "m-b": "duet-expires-first" },
    },
    {
      label: "6 1:1 잔여 0",
      attendees: [["m-a", "done"]],
      passes: [
        solo("solo-only", { purchaseRound: 1, expiresAt: new Date(2027, 6, 1), remainingCount: 0 }),
        duet("duet-only", { expiresAt: new Date(2026, 10, 1) }),
      ],
      skip: { "m-a": "solo_pass_missing" },
    },
    {
      /* 2026-10-01 변경 — 전에는 각자의 1:1 에서 한 회씩, 한 수업에 2회가
         나갔다. 지금은 차감하지 않고 막는다. 미리보기도 같은 말을 해야 한다. */
      label: "7 각자 1:1 (듀엣 회원권 없음)",
      attendees: [["m-a", "done"], ["m-b", "done"]],
      passes: [
        solo("solo-a", { expiresAt: new Date(2027, 5, 1) }),
        pass({ id: "solo-b", clientId: B, clientIds: [B], expiresAt: new Date(2027, 5, 1) }),
      ],
      skip: { "m-a": "duet_pass_missing", "m-b": "duet_pass_missing" },
      settles: false,
    },
  ];

  for (const item of cases) {
    const lesson = {
      id: "lesson-1", date: "2026-09-20", start: "19:00", end: "19:50",
      attendees: item.attendees.map(([memberId, status]) => ({ memberId, status })),
    };
    const passes = item.passes || FOUR;
    const shared = { lesson, members: PEOPLE, passes, now: NOW };

    const rates = previewLessonRates({ ...shared, totals: SESSIONS, instructorId: "u1" });
    for (const [memberId, passId] of Object.entries(item.expect || {})) {
      assert.equal(rates.get(memberId)?.passId, passId, `${item.label} 미리보기 ${memberId}`);
    }
    for (const [memberId, reason] of Object.entries(item.skip || {})) {
      assert.equal(rates.get(memberId)?.skip, reason, `${item.label} 미리보기 사유 ${memberId}`);
    }

    const plan = planLessonSettlement(shared);
    const picked = new Map();
    for (const deduction of plan.deductions) {
      for (const memberId of deduction.memberIds) picked.set(memberId, deduction.pass.id);
    }
    if (item.settles === false) {
      assert.deepEqual(plan.deductions, [], `${item.label} 확정은 차감하지 않는다`);
      continue;
    }
    for (const [memberId, passId] of Object.entries(item.expect || {})) {
      assert.equal(picked.get(memberId), passId, `${item.label} 확정 ${memberId}`);
    }
    for (const [memberId, reason] of Object.entries(item.skip || {})) {
      const skip = plan.skips.find((row) => row.memberId === memberId);
      assert.equal(skip?.reason, reason, `${item.label} 확정 사유 ${memberId}`);
    }
    // 공유 회원권은 두 줄에 같은 금액이 서지만 나가는 것은 한 번이다.
    const sharedRows = [...(item.expect ? Object.keys(item.expect) : [])]
      .map((memberId) => rates.get(memberId)).filter(Boolean);
    if (sharedRows.some((row) => row.shared)) {
      assert.equal(sharedRows.filter((row) => row.deducts).length, 1, `${item.label} 1회만`);
    }
  }
});

/* ── 세션업 기간 ─────────────────────────────────────────────────────────

   확정 화면이 이 값을 그대로 그린다. 회원권 카드와 **같은 함수**로 세야
   두 화면이 같은 숫자를 말한다 -- 여기서 다시 세면 갈라질 자리가 생긴다. */

test("미리보기가 세션업 기간을 함께 돌려준다", () => {
  // 20회권(6회차까지) 잔여 8 → 유료 12회 사용. 이미 지났다.
  assert.deepEqual(preview().sessionUp, { limit: 6, used: 12, left: 0, open: false });

  // 같은 회원권을 4회만 썼으면 지금 포함 3회 남았다.
  assert.deepEqual(
    preview({ passes: [pass({ remainingCount: 16 })] }).sessionUp,
    { limit: 6, used: 4, left: 3, open: true },
  );
});

test("회원권이 없으면 기간도 없다 -- 지어내지 않는다", () => {
  /* skip 인 줄에는 금액도 기간도 없다. 없는 회원권의 기간을 그리면 강사는
     있지도 않은 것을 회원에게 말한다. */
  assert.equal(preview({ passes: [] }).sessionUp, undefined);
});
