"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { manageGroupPayroll } = require("../src/group-payroll");

function fixture() {
  const org = "organizations/studio";
  const month = `${org}/groupPayroll/2026-11/locations`;
  const member = (userId, fields) => ({ organizationId: "studio", userId, status: "active", ...fields });
  const data = new Map([
    ["memberships/studio_owner", member("owner", { role: "owner" })],
    ["memberships/studio_fc", member("fc", { role: "manager", locationIds: ["east"] })],
    ["memberships/studio_teacher", member("teacher", { role: "instructor", locationId: "east", fullRoomRate: 45000 })],
    ["memberships/studio_other", member("other", { role: "instructor", locationId: "west", fullRoomRate: 30000 })],
    ["memberships/studio_unpriced", member("unpriced", { role: "instructor", locationId: "east" })],
    [`${org}/locations/east`, {}],
    [`${org}/locations/west`, {}],
  ]);
  const snap = (path) => ({ id: path.split("/").at(-1), exists: data.has(path), data: () => data.get(path) });
  const ref = (path) => ({
    path,
    collection: (name) => ref(`${path}/${name}`),
    doc: (name) => ref(`${path}/${name}`),
    get: async () => path === month
      ? { docs: [...data.keys()].filter((key) => key.startsWith(`${path}/`)).map(snap) }
      : snap(path),
  });
  const db = {
    collection: ref,
    runTransaction: async (run) => {
      const writes = new Map();
      const result = await run({
        get: (doc) => doc.get(),
        getAll: (...docs) => Promise.all(docs.map((doc) => doc.get())),
        set: (doc, value) => writes.set(doc.path, value),
      });
      for (const [path, value] of writes) data.set(path, value);
      return result;
    },
  };
  const call = (uid, action, fields) => manageGroupPayroll(db, uid, {
    organizationId: "studio", month: "2026-11", action, ...fields,
  }, () => 123);
  return { call, data };
}

const edit = (instructorId, fullCount, emptyCount) => ({ instructorId, fullCount, emptyCount });

test("branch counts replace prior counts, retain the recorded rate and reject concurrent edits", async () => {
  const { call, data } = fixture();
  const first = await call("fc", "save", { locationId: "east", revision: 0, edits: [edit("teacher", 2, 3)] });
  assert.deepEqual(first, { revision: 1, rows: [{ ...edit("teacher", 2, 3), fullRate: 45000 }] });
  data.get("memberships/studio_teacher").fullRoomRate = 60000;
  await assert.rejects(call("fc", "save", { locationId: "east", revision: 0, edits: [edit("teacher", 4, 2)] }), { httpsCode: "aborted" });
  const second = await call("fc", "save", { locationId: "east", revision: 1, edits: [edit("teacher", 4, 2)] });
  assert.deepEqual(second.rows, [{ ...edit("teacher", 4, 2), fullRate: 45000 }]);
  const { rows } = await call("owner", "list");
  assert.deepEqual(rows, [{ ...second.rows[0], locationId: "east" }]);
  const cleared = await call("owner", "save", { locationId: "east", revision: 2, edits: [edit("teacher", 0, 0)] });
  assert.deepEqual(cleared, { revision: 3, rows: [] });
});

test("FC can save only their branches and a failed batch leaves every instructor unchanged", async () => {
  const { call } = fixture();
  await assert.rejects(call("fc", "list"), { httpsCode: "permission-denied" });
  await assert.rejects(call("fc", "save", { locationId: "west", revision: 0, edits: [edit("other", 1, 0)] }), { httpsCode: "permission-denied" });
  await assert.rejects(call("teacher", "list", { locationId: "east" }), { httpsCode: "permission-denied" });
  await assert.rejects(call("fc", "save", { locationId: "east", revision: 0, edits: [edit("teacher", 2, 3), edit("unpriced", 1, 0)] }), { message: "group_payroll_rate" });
  await assert.rejects(call("fc", "save", { locationId: "east", revision: 0, edits: [edit("other", 0, 1)] }), { message: "group_payroll_instructor" });
  assert.deepEqual(await call("fc", "list", { locationId: "east" }), { revision: 0, rows: [] });
  assert.deepEqual((await call("fc", "save", { locationId: "east", revision: 0, edits: [edit("unpriced", 0, 2)] })).rows,
    [{ ...edit("unpriced", 0, 2), fullRate: 0 }]);
});
