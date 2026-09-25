import assert from "node:assert/strict";
import test from "node:test";
import { DualWriteCoordinator, idempotencyKeyOf, mutationFingerprint } from "../../src/data/dual-write/coordinator.js";
import { dualWriteEnabled } from "../../src/data/dual-write/feature-flags.js";

test("client dual write runs legacy before new write", async () => {
  const order = [];
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  const result = await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "client-1", operation: "create",
    legacyWrite: async () => order.push("legacy"),
    newWrite: async () => order.push("new"),
  });
  assert.deepEqual(order, ["legacy", "new"]);
  assert.equal(result.secondary, "written");
});

test("legacy failure prevents the secondary write", async () => {
  let secondaryCalls = 0;
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  await assert.rejects(() => coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "lesson", entityId: "lesson-1", operation: "update",
    legacyWrite: async () => { throw new Error("legacy failed"); },
    newWrite: async () => { secondaryCalls += 1; },
  }), /legacy failed/);
  assert.equal(secondaryCalls, 0);
});

test("secondary failure preserves legacy success and records non-PII retry metadata", async () => {
  const recorded = [];
  const coordinator = new DualWriteCoordinator({
    enabled: () => true,
    retryStore: { record: (entry) => recorded.push(entry), remove: () => {} },
    now: () => new Date("2026-07-31T00:00:00.000Z"),
  });
  const result = await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "client-1", operation: "update",
    legacyWrite: async () => "legacy-ok",
    newWrite: async () => { throw Object.assign(new Error("private payload"), { code: "unavailable" }); },
  });
  assert.equal(result.legacyResult, "legacy-ok");
  assert.equal(result.secondary, "queued");
  assert.equal(recorded[0].lastErrorCode, "unavailable");
  assert.equal(JSON.stringify(recorded).includes("private payload"), false);
});

test("feature flag is safe-off and requires both allowlists outside production", () => {
  const context = { userId: "u1", organizationId: "o1" };
  assert.equal(dualWriteEnabled({}, context), false);
  assert.equal(dualWriteEnabled({
    MODE: "development",
    VITE_FIREBASE_DUAL_WRITE_ENABLED: "true",
    VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST: "u1",
    VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST: "o1",
  }, context), true);
  assert.equal(dualWriteEnabled({
    MODE: "production",
    VITE_FIREBASE_DUAL_WRITE_ENABLED: "true",
    VITE_FIREBASE_DUAL_WRITE_UID_ALLOWLIST: "u1",
    VITE_FIREBASE_DUAL_WRITE_ORG_ALLOWLIST: "o1",
  }, context), false);
});

test("idempotency keys are deterministic", () => {
  const input = { organizationId: "o", entityType: "lesson", entityId: "l", operation: "update" };
  assert.equal(idempotencyKeyOf(input), idempotencyKeyOf(input));
});

test("mutation fingerprints are stable but distinguish different updates", () => {
  assert.equal(mutationFingerprint({ name: "A", status: "active" }), mutationFingerprint({ status: "active", name: "A" }));
  assert.notEqual(mutationFingerprint({ name: "A" }), mutationFingerprint({ name: "B" }));
});

test("missing organization context preserves legacy success and skips the new write", async () => {
  let secondaryCalls = 0;
  const coordinator = new DualWriteCoordinator({ enabled: () => true });
  const result = await coordinator.execute({
    context: { organizationId: "" },
    entityType: "client", entityId: "client-1", operation: "update",
    legacyWrite: async () => "legacy-ok",
    newWrite: async () => { secondaryCalls += 1; },
  });
  assert.equal(result.legacyResult, "legacy-ok");
  assert.equal(result.secondary, "invalid_context");
  assert.equal(secondaryCalls, 0);
});

test("unknown error codes cannot expose arbitrary error content", async () => {
  const recorded = [];
  const coordinator = new DualWriteCoordinator({
    enabled: () => true,
    retryStore: { record: (entry) => recorded.push(entry), remove: () => {} },
  });
  await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "lesson", entityId: "lesson-1", operation: "update",
    legacyWrite: async () => {},
    newWrite: async () => { throw Object.assign(new Error("private"), { code: "person@example.com" }); },
  });
  assert.equal(recorded[0].lastErrorCode, "unknown");
  assert.equal(JSON.stringify(recorded).includes("person@example.com"), false);
});

/* ── 영구 오류와 일시 오류 ──────────────────────────────────────────────

   서버가 "이 쓰기는 안 된다" 고 답한 것은 백 번 보내도 같은 답이다. 기록에
   쌓아 두면 줄지 않는 숫자가 되고, 강사는 그것을 보고도 아무것도 할 수 없다. */

const failingWrite = (code) => async () => {
  throw Object.assign(new Error(code), { code });
};

const logStore = () => {
  const rows = new Map();
  return {
    rows,
    record: (entry) => { rows.set(entry.idempotencyKey, entry); return entry; },
    remove: (key) => { rows.delete(key); },
  };
};

test("영구 오류는 기록에 쌓지 않고 그 자리에서 거부를 알린다", async () => {
  for (const code of ["permission-denied", "invalid-argument", "failed-precondition", "not-found"]) {
    const retryStore = logStore();
    const coordinator = new DualWriteCoordinator({ enabled: () => true, retryStore });
    const result = await coordinator.execute({
      context: { organizationId: "org-1" },
      entityType: "client", entityId: "c-1", operation: "update",
      legacyWrite: async () => "local", newWrite: failingWrite(code),
    });
    assert.equal(result.secondary, "refused", code);
    assert.equal(result.errorCode, code);
    assert.equal(retryStore.rows.size, 0, `${code} 가 기록에 쌓였다`);
  }
});

test("네트워크 오류는 기록에 남고 숫자가 된다", async () => {
  const retryStore = logStore();
  const coordinator = new DualWriteCoordinator({ enabled: () => true, retryStore });
  const result = await coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "c-1", operation: "update",
    legacyWrite: async () => "local", newWrite: failingWrite("unavailable"),
  });
  assert.equal(result.secondary, "queued");
  assert.equal(result.errorCode, "unavailable");
  assert.equal(retryStore.rows.size, 1);
});

test("다음에 성공하면 그 줄이 빠진다", async () => {
  /* 다시 보내는 코드는 없다. 사람이 그 회원을 다시 저장하는 것이 유일한
     복구 수단이고, 그때 숫자가 준다. */
  const retryStore = logStore();
  const coordinator = new DualWriteCoordinator({ enabled: () => true, retryStore });
  const call = (newWrite, version) => coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "c-1", operation: "update", version,
    legacyWrite: async () => "local", newWrite,
  });

  await call(failingWrite("unavailable"), 1);
  assert.equal(retryStore.rows.size, 1);

  // 같은 회원·같은 작업. 열쇠가 같아야 그 줄이 지워진다.
  const ok = await call(async () => "written", 1);
  assert.equal(ok.secondary, "written");
  assert.equal(retryStore.rows.size, 0);
});

test("영구 오류는 이미 쌓여 있던 줄도 걷어낸다", async () => {
  /* 연결이 끊겨 한 번 쌓인 뒤 규칙이 거부하기 시작하는 순서가 실제로 있다.
     그 줄을 두면 영원히 줄지 않는다. */
  const retryStore = logStore();
  const coordinator = new DualWriteCoordinator({ enabled: () => true, retryStore });
  const call = (newWrite) => coordinator.execute({
    context: { organizationId: "org-1" },
    entityType: "client", entityId: "c-1", operation: "update",
    legacyWrite: async () => "local", newWrite,
  });

  await call(failingWrite("unavailable"));
  assert.equal(retryStore.rows.size, 1);
  await call(failingWrite("permission-denied"));
  assert.equal(retryStore.rows.size, 0);
});
