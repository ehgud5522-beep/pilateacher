import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

import { transferPass } from "../../src/data/repositories/pass-repository.js";

const require = createRequire(import.meta.url);
const {
  ADMIN_ERROR, PASS_ADMIN_ROLES, isPassAdmin, runHandover, runSessionUp,
} = require("../../functions/src/pass-admin.js");

/**
 * 세션업과 회원 간 양도의 서버 통로.
 *
 * 이 파일이 지키는 것은 셋이다.
 *
 * 하나. **강사는 어느 쪽도 못 한다.** 화면이 버튼을 감추는 것은 안내이고 막는
 * 것은 서버다. 화면만 믿으면 호출 한 번으로 지나간다.
 *
 * 둘. **양도는 규칙 경로와 같은 결과를 낸다.** 같은 버튼이 누가 눌렀느냐에
 * 따라 다른 금액을 박으면 안 되고, 원장은 append-only 라 고칠 수 없다.
 *
 * 셋. **금액은 서버가 센다.** 앱이 보낸 계약 금액·단가는 아예 받지 않는다.
 */

/* ── 가짜 Firestore ───────────────────────────────────────────────────────
   배치가 무엇을 썼는지만 본다. 쓰기는 모아 두고 commit 에서 한 번에 적용한다
   -- 실제 배치가 그렇고, 중간 상태를 읽을 수 있으면 테스트가 통과하는데
   현실에서 틀리는 자리가 생긴다. */

const INCREMENT = Symbol("increment");

function fakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const writes = [];

  const reference = (path) => ({
    path,
    async get() {
      const data = docs.get(path);
      return { exists: data !== undefined, data: () => data, id: path.split("/").pop() };
    },
    collection: (name) => collection(`${path}/${name}`),
  });
  const collection = (base) => ({ doc: (id) => reference(`${base}/${id}`) });

  return {
    docs,
    writes,
    collection,
    batch() {
      const staged = [];
      return {
        set(ref, data) { staged.push({ op: "set", path: ref.path, data }); },
        update(ref, data) { staged.push({ op: "update", path: ref.path, data }); },
        async commit() {
          for (const write of staged) {
            writes.push(write);
            const current = docs.get(write.path) || {};
            const next = write.op === "set" ? { ...write.data } : { ...current };
            if (write.op === "update") {
              for (const [key, value] of Object.entries(write.data)) {
                next[key] = value?.[INCREMENT] !== undefined
                  ? (Number(current[key]) || 0) + value[INCREMENT]
                  : value;
              }
            }
            docs.set(write.path, next);
          }
        },
      };
    },
  };
}

/* 서버 센티넬을 우리 것으로 넣는다. **firebase-admin 을 부르지 않는다.**

   그 패키지는 functions/node_modules 에만 있고 CI 는 루트에서만 npm install
   한다 -- 여기서 부르면 CI 에서 이 파일이 로드 단계에 죽고, TAP 줄도 못 내고
   죽어서 "not ok" 로는 잡히지도 않는다 (2026-10-03 Codemagic).

   증감은 센티넬 모양 그대로 둔다. 가짜 저장소가 "읽어서 빼지 않았다" 를 실제로
   볼 수 있어야 하기 때문이다. */
const fieldValue = {
  increment: (amount) => ({ [INCREMENT]: amount, _delta: amount }),
  serverTimestamp: () => "SERVER_TIME",
};

const ORG = "organizations/center-a";
const basePass = (overrides = {}) => ({
  organizationId: "center-a", clientId: "client-a", clientIds: ["client-a"],
  locationId: "loc-1", productId: "prod-1", category: "pt_1_1_repurchase_normal",
  status: "active", totalSessions: 20, serviceSessions: 0, serviceUsed: 0,
  /* 카드 수수료를 뺀 값이 원본에 이미 들어 있어야 한다. 계약 금액을 그대로
     넣으면 받는 쪽만 수수료를 한 번 더 맞고 부원장 단가가 어긋난다 --
     transferPricing 이 `exact: false` 로 멈추는 자리다. */
  remainingCount: 20, contractPrice: 1300000, netContractPrice: 1181818,
  baseUnitPrice: 65000, paymentMethod: "card", purchaseRound: 2, handedOver: false,
  instructorId: "u1", expiresAt: new Date(2027, 1, 1),
  ...overrides,
});

const write = (store, path) => store.writes.find((item) => item.path === path);

/* ── 권한 ────────────────────────────────────────────────────────────────── */

test("only an active owner or manager passes the membership check", () => {
  /* 퇴사한 사람은 역할이 남아 있어도 아니다. 소속 문서는 지우지 않고
     status 로 끄기 때문에, 역할만 보면 퇴사자가 그대로 통과한다. */
  assert.equal(isPassAdmin({ role: "owner", status: "active" }), true);
  assert.equal(isPassAdmin({ role: "manager", status: "active" }), true);
  assert.equal(isPassAdmin({ role: "instructor", status: "active" }), false);
  assert.equal(isPassAdmin({ role: "staff", status: "active" }), false);
  assert.equal(isPassAdmin({ role: "owner", status: "revoked" }), false);
  assert.equal(isPassAdmin({ role: "manager", status: "inactive" }), false);
  assert.equal(isPassAdmin(null), false);
  assert.equal(isPassAdmin({}), false);
});

test("the instructor is not on the list at all", () => {
  /* 목록에 없는 것과 조건에서 걸러지는 것은 다르다. 목록 자체를 본다. */
  assert.deepEqual([...PASS_ADMIN_ROLES], ["owner", "manager"]);
  assert.equal(PASS_ADMIN_ROLES.includes("instructor"), false);
});

/* ── 세션업 ──────────────────────────────────────────────────────────────── */

test("session up writes the pass and the ledger in one batch", async () => {
  const store = fakeFirestore({ [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 8 }) });

  const result = await runSessionUp(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", actorId: "u-owner",
    addSessions: 50, addPrice: 2500000, paymentMethod: "card",
    now: () => new Date(2026, 9, 3, 10, 0),
  });

  const pass = store.docs.get(`${ORG}/passes/pass-1`);
  assert.equal(pass.totalSessions, 70);
  assert.equal(pass.remainingCount, 58);
  assert.equal(pass.contractPrice, 3800000);
  assert.equal(pass.baseUnitPrice, 54286);

  /* 원장이 없으면 늘어난 사실이 어디에도 남지 않는다 -- 반년 뒤 "왜 70회냐" 에
     답할 것이 이것뿐이다. */
  const entry = store.docs.get(`${ORG}/passes/pass-1/ledger/${result.entryId}`);
  assert.equal(entry.type, "sessionup");
  assert.equal(entry.delta, 50);
  assert.equal(entry.addedSessions, 50);
  assert.equal(entry.addedPrice, 2500000);
  assert.equal(entry.fromTotalSessions, 20);
  assert.equal(entry.createdBy, "u-owner");
});

test("session up refuses an ended pass and writes nothing", async () => {
  /* 끝난 계약을 되살리면 그 사이의 만료·소진이 없던 일이 된다. 막는 것만으로는
     부족하다 -- 절반만 쓰고 멈추면 회차가 근거 없이 생긴다. */
  const store = fakeFirestore({ [`${ORG}/passes/pass-1`]: basePass({ status: "cancelled" }) });

  await assert.rejects(
    () => runSessionUp(store, {
      fieldValue, organizationId: "center-a", passId: "pass-1", actorId: "u-owner",
      addSessions: 10, addPrice: 500000,
    }),
    /pass_not_active/,
  );
  assert.equal(store.writes.length, 0);
});

test("session up refuses a pass that is not there", async () => {
  const store = fakeFirestore({});
  await assert.rejects(
    () => runSessionUp(store, {
      fieldValue, organizationId: "center-a", passId: "ghost", actorId: "u-owner",
      addSessions: 10, addPrice: 500000,
    }),
    new RegExp(ADMIN_ERROR.NOT_FOUND),
  );
  assert.equal(store.writes.length, 0);
});

test("session up does not touch serviceUsed", async () => {
  /* 서비스를 더해도 "회원권당 한 번" 은 그대로다. 세션업이 그 권리를 새로
     주면 서비스를 얹을 때마다 센터가 한 번씩 더 지불한다. */
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ serviceSessions: 1, serviceUsed: 1, remainingCount: 5 }),
  });

  await runSessionUp(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", actorId: "u-owner",
    addSessions: 10, addPrice: 500000, addService: 2,
    now: () => new Date(2026, 9, 3),
  });

  const pass = store.docs.get(`${ORG}/passes/pass-1`);
  assert.equal(pass.serviceUsed, 1, "쓴 서비스는 그대로다");
  assert.equal(pass.serviceSessions, 3);
  assert.equal(pass.remainingCount, 5 + 10 + 2);
});

/* ── 양도 ────────────────────────────────────────────────────────────────── */

test("the callable handover matches the rules path exactly", async () => {
  /* 같은 버튼이 누가 눌렀느냐에 따라 다른 금액을 박으면 안 된다. 두 경로를
     같은 회원권으로 돌려 받는 회원권을 통째로 견준다. */
  const source = basePass({ remainingCount: 20 });
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: { ...source },
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  await runHandover(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
    sessions: 5, actorId: "u-owner", newPassId: "pass-new",
    now: () => new Date(2026, 9, 3),
  });
  const viaCallable = store.docs.get(`${ORG}/passes/pass-new`);

  /* 규칙 경로. 같은 입력으로 돌리고 같은 집합이 나오는지 본다. */
  const committed = [];
  const ruleStore = {
    async serverTimestamp() { return "SERVER_TIME"; },
    async commit(operations) { committed.push(...operations); },
  };
  await transferPass("center-a", { id: "pass-1", ...source }, {
    toClientId: "client-b", sessions: 5, instructorId: "u1", createdBy: "u-owner",
  }, { store: ruleStore, newId: () => "pass-new" });
  const viaRules = committed.find((item) => item.path.endsWith("passes/pass-new"))?.data;

  /* 한 칸도 빼지 않고 견준다. 센티넬까지 같은 모양으로 넣었으므로 가릴 것이
     없다 -- 빼 두면 그 칸이 갈라져도 테스트는 통과한다. */
  assert.deepEqual(viaCallable, viaRules);
});

test("the handover ledger says where the sessions went", async () => {
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 20 }),
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  const result = await runHandover(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
    sessions: 5, actorId: "u-manager", newPassId: "pass-new",
    now: () => new Date(2026, 9, 3),
  });

  const out = store.docs.get(`${ORG}/passes/pass-1/ledger/${result.handoverEntryId}`);
  assert.equal(out.type, "handover");
  assert.equal(out.delta, -5);
  assert.equal(out.toPassId, "pass-new");
  assert.equal(out.toClientId, "client-b");
  assert.equal(out.createdBy, "u-manager");

  const into = store.docs.get(`${ORG}/passes/pass-new/ledger/${result.issueEntryId}`);
  assert.equal(into.type, "issue");
  assert.equal(into.delta, 5);
  assert.equal(into.category, "pt_1_1_new");
});

test("the source pass is decremented, not overwritten", async () => {
  /* 읽어서 빼면 같은 회원권에 차감과 양도가 겹칠 때 한쪽이 다른 쪽을 지운다.
     서버가 더해야 한다. */
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 20 }),
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  await runHandover(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
    sessions: 5, actorId: "u-owner", newPassId: "pass-new",
    now: () => new Date(2026, 9, 3),
  });

  const update = write(store, `${ORG}/passes/pass-1`);
  assert.equal(update.op, "update");
  assert.equal(update.data.remainingCount._delta, -5, "증감 센티넬이어야 한다");
  assert.equal(store.docs.get(`${ORG}/passes/pass-1`).remainingCount, 15);
});

test("a duet pass cannot be handed over", async () => {
  /* 둘이 나눠 쓰기로 한 회차를 한 사람이 넘기면 짝의 몫이 사라지고, 그 사실은
     짝에게 아무도 알리지 않는다. */
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ clientIds: ["client-a", "client-x"], remainingCount: 20 }),
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  await assert.rejects(
    () => runHandover(store, {
      fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
      sessions: 5, actorId: "u-owner",
    }),
    /transfer_duet/,
  );
  assert.equal(store.writes.length, 0);
});

test("a handover to someone outside the centre is refused", async () => {
  /* id 는 그냥 문자열이다. 없는 회원에게 넘기면 회차가 아무도 못 보는 자리로
     가고, 원장은 append-only 라 되돌릴 수 없다. */
  const store = fakeFirestore({ [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 20 }) });

  await assert.rejects(
    () => runHandover(store, {
      fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "ghost",
      sessions: 5, actorId: "u-owner",
    }),
    new RegExp(ADMIN_ERROR.TARGET_NOT_FOUND),
  );
  assert.equal(store.writes.length, 0);
});

test("more sessions than are left is refused", async () => {
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 3 }),
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  await assert.rejects(
    () => runHandover(store, {
      fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
      sessions: 5, actorId: "u-owner",
    }),
    /transfer_too_many/,
  );
  assert.equal(store.writes.length, 0);
});

test("the price the caller sends is ignored", async () => {
  /* 앱이 보낸 금액을 그대로 박으면 그것은 잠긴 문이 아니다. 서버가 같은
     모듈로 다시 센다. */
  const store = fakeFirestore({
    [`${ORG}/passes/pass-1`]: basePass({ remainingCount: 20 }),
    [`${ORG}/clients/client-b`]: { name: "박두리" },
  });

  await runHandover(store, {
    fieldValue, organizationId: "center-a", passId: "pass-1", toClientId: "client-b",
    sessions: 5, actorId: "u-owner", newPassId: "pass-new",
    contractPrice: 1, netContractPrice: 1,
    now: () => new Date(2026, 9, 3),
  });

  const created = store.docs.get(`${ORG}/passes/pass-new`);
  /* 1,300,000 ÷ 20 × 5 = 325,000 에서 부원장 단가를 원본과 같게 맞추느라
     1원이 내려간다. 비슷한 값으로 넘기지 않는 것이 이 보정의 뜻이다. */
  assert.equal(created.contractPrice, 324999);
  assert.notEqual(created.contractPrice, 1);
});
