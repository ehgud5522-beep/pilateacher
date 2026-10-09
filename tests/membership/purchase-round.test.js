import assert from "node:assert/strict";
import test from "node:test";

import {
  expiryOrderByClient, expiryOrderWarning, expiryOutOfOrder, nextPurchaseRound, purchaseRoundOf,
} from "../../src/features/membership/purchase-round.js";
import { passBelongsTo } from "../../src/data/schema/pass-clients.js";

/**
 * 차수.
 *
 * 2026-10-09 부터 차감이 차수 순으로 간다. 그 전에는 만료일이 순서를 정했고
 * 차수는 적히기만 하는 숫자였다 -- 틀려도 아무 일이 없었다.
 *
 * 이제는 틀리면 엉뚱한 회원권에서 빠진다. 이 파일이 지키는 것은 둘이다:
 * 발급할 때 번호가 저절로 맞게 붙는가, 그리고 만료일이 차수와 어긋난 회원을
 * 화면이 먼저 찾아내는가.
 */

const NOW = new Date(2026, 9, 9);
const pass = (overrides = {}) => ({
  id: "p", clientId: "c1", clientIds: ["c1"], status: "active",
  category: "pt_1_1_repurchase_event", remainingCount: 8, purchaseRound: 1,
  expiresAt: new Date(2027, 0, 1), ...overrides,
});

/* ── 다음 차수 ───────────────────────────────────────────────────────────── */

test("the first pass of a client is round 1", () => {
  assert.equal(nextPurchaseRound([], "c1", passBelongsTo), 1);
  assert.equal(nextPurchaseRound([pass({ clientId: "someone", clientIds: ["someone"] })], "c1", passBelongsTo), 1);
  assert.equal(nextPurchaseRound([], "", passBelongsTo), 1);
});

test("the next round is one past the highest the client already has", () => {
  const mine = [pass({ id: "a", purchaseRound: 1 }), pass({ id: "b", purchaseRound: 3 })];
  assert.equal(nextPurchaseRound(mine, "c1", passBelongsTo), 4, "가장 큰 번호의 다음이다");
});

test("rounds are counted across kinds, not per kind", () => {
  /* 종류마다 1 부터 세면 같은 번호가 둘이 되고, 그때 순서는 발급 시각이
     정하게 되어 아무도 예측하지 못한다. */
  const mine = [
    pass({ id: "solo", purchaseRound: 1 }),
    pass({ id: "duet", purchaseRound: 2, category: "pt_2_1_new", clientIds: ["c1", "c2"] }),
  ];
  assert.equal(nextPurchaseRound(mine, "c1", passBelongsTo), 3);
});

test("a duet pass counts for the partner too", () => {
  /* 짝의 화면에서도 같은 계약이다. clientId 만 보면 대표 한 명에게만 센다. */
  const shared = pass({ id: "duet", purchaseRound: 2, clientId: "c1", clientIds: ["c1", "c2"], category: "pt_2_1_new" });
  assert.equal(nextPurchaseRound([shared], "c2", passBelongsTo), 3);
});

test("a pass with an unreadable round does not push the number up", () => {
  /* 0 으로 세면 다음이 1 이 되어 이미 있는 1차와 부딪힌다. */
  assert.equal(purchaseRoundOf({ purchaseRound: 0 }), null);
  assert.equal(purchaseRoundOf({ purchaseRound: "2차" }), null);
  assert.equal(purchaseRoundOf({}), null);
  assert.equal(nextPurchaseRound([pass({ purchaseRound: null }), pass({ purchaseRound: 2 })], "c1", passBelongsTo), 3);
});

/* ── 만료일이 차수와 어긋난 것 ───────────────────────────────────────────── */

test("a later round that expires first is flagged", () => {
  /* 차수 순으로 쓰므로 1차에 잔여가 남아 있는 동안 2차는 쓰이지 않는다.
     그런데 2차가 먼저 만료되면 그 회차는 손도 못 대 보고 사라진다. */
  const found = expiryOutOfOrder([
    pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
    pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW });

  assert.equal(found.length, 1);
  assert.equal(found[0].pass.id, "second");
  assert.equal(found[0].round, 2);
  assert.equal(found[0].blockedByRound, 1);
  assert.equal(expiryOrderWarning(found[0]), "2차가 1차보다 먼저 만료돼요. 만료일을 확인해 주세요.");
});

test("the normal order is not flagged", () => {
  const found = expiryOutOfOrder([
    pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2026, 11, 1) }),
    pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2027, 6, 1) }),
  ], { now: NOW });
  assert.deepEqual(found, []);
});

test("different kinds never wait for each other", () => {
  /* 차감 후보가 종류별로 갈리므로 1:1 과 2:1 은 서로를 기다리지 않는다.
     견주면 아무 문제 없는 회원권이 매번 경고에 걸린다. */
  const found = expiryOutOfOrder([
    pass({ id: "solo-1", purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
    pass({ id: "duet-2", purchaseRound: 2, category: "pt_2_1_new", clientIds: ["c1", "c2"], expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW });
  assert.deepEqual(found, []);
});

test("a spent, cancelled or expired pass raises nothing", () => {
  // 끝난 회원권은 경고할 것이 없다. 잃을 회차가 남아 있지 않다.
  for (const broken of [
    { remainingCount: 0 },
    { status: "cancelled" },
    { expiresAt: new Date(2026, 1, 1) },
  ]) {
    const found = expiryOutOfOrder([
      pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
      pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 11, 1), ...broken }),
    ], { now: NOW });
    assert.deepEqual(found, [], JSON.stringify(broken));
  }
});

test("an unreadable round or expiry is never guessed at", () => {
  /* 모르는 것으로 경고하면 그 경고는 곧 무시되고, 진짜가 왔을 때도 안 읽힌다. */
  assert.deepEqual(expiryOutOfOrder([
    pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
    pass({ id: "second", purchaseRound: null, expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW }), []);

  assert.deepEqual(expiryOutOfOrder([
    pass({ id: "first", purchaseRound: 1, expiresAt: null }),
    pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW }), []);
});

test("the blocker named is the one that holds it longest", () => {
  /* 1차와 2차가 둘 다 3차보다 늦게 만료되면, 3차를 가장 오래 붙잡는 것은
     가장 늦게 만료되는 쪽이다. 그쪽을 짚어야 대표가 고칠 것을 안다. */
  const found = expiryOutOfOrder([
    pass({ id: "first", purchaseRound: 1, expiresAt: new Date(2027, 2, 1) }),
    pass({ id: "second", purchaseRound: 2, expiresAt: new Date(2027, 9, 1) }),
    pass({ id: "third", purchaseRound: 3, expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW });

  assert.equal(found.length, 1);
  assert.equal(found[0].pass.id, "third");
  assert.equal(found[0].blockedByRound, 2, "가장 늦게 만료되는 앞 차수");
});

/* ── 센터 전체 ───────────────────────────────────────────────────────────── */

test("the centre-wide list groups by member, not by pass", () => {
  /* 한 사람에게 두 장이 걸려 있어도 대표가 열어야 할 화면은 하나다. */
  const found = expiryOrderByClient([
    pass({ id: "a1", clientId: "c1", clientIds: ["c1"], purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
    pass({ id: "a2", clientId: "c1", clientIds: ["c1"], purchaseRound: 2, expiresAt: new Date(2026, 11, 1) }),
    pass({ id: "a3", clientId: "c1", clientIds: ["c1"], purchaseRound: 3, expiresAt: new Date(2026, 11, 2) }),
    pass({ id: "b1", clientId: "c2", clientIds: ["c2"], purchaseRound: 1, expiresAt: new Date(2026, 11, 1) }),
    pass({ id: "b2", clientId: "c2", clientIds: ["c2"], purchaseRound: 2, expiresAt: new Date(2027, 6, 1) }),
  ], { now: NOW, clientIdsOf: (item) => item.clientIds });

  assert.equal(found.length, 1, "순서가 맞는 회원은 목록에 없다");
  assert.equal(found[0].clientId, "c1");
  assert.deepEqual(found[0].rows.map((row) => row.pass.id).sort(), ["a2", "a3"]);
});

test("one member's passes never borrow another member's rounds", () => {
  /* 센터 전체를 한 번에 견주면 남의 1차가 내 2차를 붙잡는다. */
  const found = expiryOrderByClient([
    pass({ id: "mine", clientId: "c1", clientIds: ["c1"], purchaseRound: 2, expiresAt: new Date(2026, 11, 1) }),
    pass({ id: "theirs", clientId: "c2", clientIds: ["c2"], purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
  ], { now: NOW, clientIdsOf: (item) => item.clientIds });
  assert.deepEqual(found, []);
});

test("a duet pass shows up for both partners", () => {
  /* 짝 둘 다에게 같은 계약이다. 한쪽 화면에서만 보이면 다른 쪽은 영영 모른다. */
  const found = expiryOrderByClient([
    pass({ id: "solo-1", clientId: "c1", clientIds: ["c1"], category: "pt_2_1_new", purchaseRound: 1, expiresAt: new Date(2027, 6, 1) }),
    pass({ id: "duet-2", clientId: "c1", clientIds: ["c1", "c2"], category: "pt_2_1_new", purchaseRound: 2, expiresAt: new Date(2026, 11, 1) }),
  ], { now: NOW, clientIdsOf: (item) => item.clientIds });
  assert.deepEqual(found.map((item) => item.clientId).sort(), ["c1"]);
});
