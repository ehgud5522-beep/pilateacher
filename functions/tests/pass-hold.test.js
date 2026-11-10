"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { runPassHold } = require("../src/pass-hold");

function fixture(role = "manager", status = "active") {
  const pass = { organizationId: "o", clientId: "c", locationId: "l", status: "active", remainingCount: 10, expiresAt: new Date("2027-01-01") };
  const writes = [];
  const doc = (path) => ({ path, collection: (name) => ({ doc: () => doc(`${path}/${name}/entry`) }) });
  const firestore = { doc, runTransaction: async (run) => run({
    get: async (ref) => ({ exists: true, data: () => ref.path.startsWith("memberships/") ? { role, status } : pass }),
    update: (ref, value) => { writes.push({ path: ref.path, value }); Object.assign(pass, value); },
    create: (ref, value) => writes.push({ path: ref.path, value }),
  }) };
  return { firestore, pass, writes };
}
const input = { organizationId: "o", passId: "p", actorId: "u", action: "hold", days: 7, reason: "여행", now: () => new Date("2026-11-10") };

test("hold writes the interval and audit together without touching balance", async () => {
  const f = fixture();
  await runPassHold(f.firestore, input);
  assert.equal(f.writes.length, 2);
  assert.equal(f.pass.remainingCount, 10);
  assert.equal(f.writes[1].value.delta, 0);
  assert.equal(f.writes[1].value.createdBy, "u");
  await assert.rejects(runPassHold(f.firestore, input), /hold_already_active/);
  assert.equal(f.writes.length, 2);
});

test("only active owner, area manager and manager can hold or release", async () => {
  for (const role of ["instructor", "member", "staff"]) {
    const f = fixture(role);
    await assert.rejects(runPassHold(f.firestore, input), /hold_permission_denied/);
    assert.equal(f.writes.length, 0);
  }
  await assert.rejects(runPassHold(fixture("owner", "inactive").firestore, input), /hold_permission_denied/);
  for (const role of ["owner", "area_manager", "manager"]) await runPassHold(fixture(role).firestore, input);
});

test("hold rejects path injection before reading", async () => {
  await assert.rejects(runPassHold(fixture().firestore, { ...input, passId: "p/elsewhere" }), /hold_invalid_id/);
});
