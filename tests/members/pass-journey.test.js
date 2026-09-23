import assert from "node:assert/strict";
import test from "node:test";
import { JOURNEY_PRIOR_NOTE, buildPassJourney, hasJourney } from "../../functions/shared/pass-journey.mjs";

const pass = (overrides = {}) => ({
  id: "pass-1",
  purchaseRound: 1,
  totalSessions: 20,
  serviceSessions: 0,
  remainingCount: 0,
  status: "completed",
  createdAt: new Date(2026, 0, 1),
  ...overrides,
});

test("finished passes stay on the line — that is the point of it", () => {
  /* 회원권마다 따로 보여주면 "이번 것 8회 남음" 은 알아도 "이 회원이 우리와 얼마나
     왔는가" 는 아무도 모른다. 재등록 상담에서 필요한 것은 뒤쪽이다. */
  const journey = buildPassJourney({
    passes: [
      pass({ id: "p1", purchaseRound: 1, totalSessions: 20, remainingCount: 0 }),
      pass({ id: "p2", purchaseRound: 2, totalSessions: 30, remainingCount: 0 }),
      pass({ id: "p3", purchaseRound: 3, totalSessions: 30, remainingCount: 18, status: "active" }),
    ],
  });
  assert.deepEqual(journey.segments.map((item) => item.total), [20, 30, 30]);
  assert.equal(journey.grandTotal, 80);
  assert.equal(journey.usedTotal, 62);
  assert.equal(journey.currentRound, 3);
});

test("the segments follow the order they were sold in", () => {
  // 금액순이나 만료순이면 줄이 달마다 재배열되고, 여정이 여정으로 읽히지 않는다.
  const journey = buildPassJourney({
    passes: [
      pass({ id: "third", purchaseRound: 3 }),
      pass({ id: "first", purchaseRound: 1 }),
      pass({ id: "second", purchaseRound: 2 }),
    ],
  });
  assert.deepEqual(journey.segments.map((item) => item.passId), ["first", "second", "third"]);
});

test("same round falls back to when it was made", () => {
  const journey = buildPassJourney({
    passes: [
      pass({ id: "later", purchaseRound: 1, createdAt: new Date(2026, 5, 1) }),
      pass({ id: "earlier", purchaseRound: 1, createdAt: new Date(2026, 0, 1) }),
    ],
  });
  assert.deepEqual(journey.segments.map((item) => item.passId), ["earlier", "later"]);
});

/* ── 앱 이전 기록 ─────────────────────────────────────────────────────────

   그냥 강사누적진행을 쓰면 안 된다. 그 값은 이관한 회원권에서 쓴 회차까지 이미
   세고 있어서, 그대로 그리면 그만큼 두 번 그려진다. */

test("the prior stretch is what the cumulative count has left over", () => {
  /* 이관: 총 20회 중 5회 남음(=15회 씀), 강사누적진행 40.
     40 중 15 는 이 회원권에서 쓴 것이므로 앱 이전은 25 다. */
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 5, status: "active" })],
    instructorSessions: 40,
  });
  assert.equal(journey.prior, 25);
  assert.equal(journey.segments[0].kind, "prior");
  assert.equal(journey.segments[0].total, 25);
  assert.equal(journey.segments[0].used, 25, "이전 구간은 통으로 채워져 있다");
  assert.equal(journey.grandTotal, 45);
  assert.equal(journey.usedTotal, 40);
});

test("one more deduction does not move the prior stretch", () => {
  /* 누적과 사용량이 함께 오르므로 그 차이는 그대로여야 한다. 움직이면 이관
     기록이 차감할 때마다 줄어드는 것처럼 보인다. */
  const before = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 5, status: "active" })],
    instructorSessions: 40,
  });
  const after = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 4, status: "active" })],
    instructorSessions: 41,
  });
  assert.equal(before.prior, after.prior);
  assert.equal(after.usedTotal, before.usedTotal + 1);
});

test("a member who never migrated has no prior stretch at all", () => {
  // 누적이 0 에서 시작해 차감과 함께 오르므로 같은 식이 언제나 0 을 준다.
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 17, status: "active" })],
    instructorSessions: 3,
  });
  assert.equal(journey.prior, 0);
  assert.equal(journey.hasPrior, false);
  assert.equal(journey.segments[0].kind, "pass");
});

test("the prior stretch never goes negative", () => {
  /* 담당이 바뀌면 누적이 0 부터 다시 센다. 그때 음수 구간을 그리면 줄이 뒤집힌다. */
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 5, status: "active" })],
    instructorSessions: 2,
  });
  assert.equal(journey.prior, 0);
});

test("the line says whose count it is, and stops saying it when it knows better", () => {
  /* 담당이 바뀐 회원은 이전 구간이 실제보다 짧다. 화면이 기준을 밝히면 오해가
     생기지 않는다. 회원 전체 누적을 알게 되면 그 문구는 사라져야 한다. */
  const byInstructor = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 5, status: "active" })],
    instructorSessions: 40,
  });
  assert.equal(byInstructor.priorIsInstructorScoped, true);
  assert.match(JOURNEY_PRIOR_NOTE, /담당 강사 기준/);

  // 이관 양식에 열 하나가 늘면 이 값이 들어온다. 구조는 열려 있다.
  const byMember = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 5, status: "active" })],
    instructorSessions: 40,
    memberSessions: 62,
  });
  assert.equal(byMember.prior, 47);
  assert.equal(byMember.priorIsInstructorScoped, false);
});

/* ── 구간 안의 성격 ───────────────────────────────────────────────────── */

test("service sessions are counted apart, because they are a different thing", () => {
  // 급여가 다르고 회원이 받은 성격도 다르다. 줄에서도 달라야 한다.
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 20, serviceSessions: 2, remainingCount: 8, status: "active" })],
  });
  const [segment] = journey.segments;
  assert.equal(segment.total, 22);
  assert.equal(segment.paid, 20);
  assert.equal(segment.service, 2);
  assert.equal(segment.used, 14);
});

test("a lapsed pass keeps its unused stretch visible rather than filled", () => {
  /* 만료된 회원권에 남은 회차는 쓰이지 못한 것이다. 채우면 한 것처럼 보이고,
     그냥 비우면 "왜 중간이 비었나" 를 묻게 된다. */
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 20, remainingCount: 6, status: "expired" })],
  });
  const [segment] = journey.segments;
  assert.equal(segment.used, 14);
  assert.equal(segment.lapsed, 6);
  assert.equal(segment.active, false);
});

test("a cancelled pass is not part of the journey", () => {
  /* 잘못 발급해 되돌린 것이라 그 회차는 일어나지 않았다. 잔여가 0 이라고 다 쓴
     것으로 그리면 오지 않은 수업이 줄에 남는다. */
  const journey = buildPassJourney({
    passes: [
      pass({ id: "real", totalSessions: 20, remainingCount: 0 }),
      pass({ id: "cancelled", purchaseRound: 2, totalSessions: 30, remainingCount: 0, status: "cancelled" }),
    ],
  });
  assert.deepEqual(journey.segments.map((item) => item.passId), ["real"]);
  assert.equal(journey.grandTotal, 20);
});

test("remaining beyond the total is clamped rather than drawn backwards", () => {
  // 옛 데이터에 잔여가 총 회차보다 큰 건이 실제로 있다. 줄이 뒤집히면 안 된다.
  const journey = buildPassJourney({
    passes: [pass({ totalSessions: 10, remainingCount: 30, status: "active" })],
  });
  assert.equal(journey.segments[0].used, 0);
  assert.equal(journey.segments[0].remaining, 10);
});

test("nothing to draw is said plainly", () => {
  assert.equal(hasJourney(buildPassJourney({ passes: [] })), false);
  assert.equal(hasJourney(buildPassJourney({})), false);
  assert.equal(hasJourney(null), false);
  assert.equal(hasJourney(buildPassJourney({ passes: [pass()] })), true);
  // 진행 중인 것이 없으면 "3차 진행중" 이라고 쓰지 않는다 -- 거짓이 된다.
  assert.equal(buildPassJourney({ passes: [pass({ status: "completed" })] }).currentRound, 0);
});
