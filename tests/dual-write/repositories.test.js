import assert from "node:assert/strict";
import test from "node:test";
import { FirestoreClientRepository, FirestoreLessonRepository } from "../../src/data/repositories/firestore-adapters.js";

const timestamp = () => ({ seconds: 1, nanoseconds: 0 });
const context = { organizationId: "org-1", locationId: "loc-1", userId: "user-1", serverTimestamp: timestamp };

test("client repository uses stable ID and organization-scoped path", async () => {
  const writes = [];
  const repository = new FirestoreClientRepository({ merge: async (...args) => writes.push(args) });
  await repository.createClient(context, { id: "client-1", name: "Test", regular: 2, service: 1 });
  await repository.updateClient(context, { id: "client-1", name: "Test", regular: 1, service: 1 });
  assert.equal(writes[0][0], "organizations/org-1/clients/client-1");
  assert.equal(writes[1][0], writes[0][0]);
  assert.equal(writes[0][1].schemaVersion, 1);
  assert.equal("createdAt" in writes[1][1], false);
  assert.equal("createdBy" in writes[1][1], false);
});

test("lesson document stores a count and never embeds participant arrays", async () => {
  const writes = [];
  const repository = new FirestoreLessonRepository({ merge: async (...args) => writes.push(args) });
  await repository.createLesson(context, {
    id: "lesson-1",
    date: "2026-07-31",
    attendees: [{ memberId: "a" }, { memberId: "b" }],
    participantCount: 2,
  });
  assert.equal(writes[0][0], "organizations/org-1/lessons/lesson-1");
  assert.equal(writes[0][1].participantCount, 2);
  assert.equal("attendees" in writes[0][1], false);
});

test("attendance is written as bounded participant documents", async () => {
  const writes = [];
  const repository = new FirestoreLessonRepository({ merge: async (...args) => writes.push(args) });
  await repository.saveAttendance(context, "lesson-1", { clientId: "client-1", status: "attended" });
  assert.equal(writes[0][0], "organizations/org-1/lessons/lesson-1/participants/client-1");
  assert.equal(writes[0][1].attendanceStatus, "attended");
});

test("new Firestore reads remain disabled", () => {
  const writer = { merge: async () => {} };
  assert.throws(() => new FirestoreClientRepository(writer).listClients(), /reads are disabled/);
  assert.throws(() => new FirestoreLessonRepository(writer).getLessonById(), /reads are disabled/);
});

test("organization paths are isolated and missing organization IDs fail before writing", async () => {
  const writes = [];
  const repository = new FirestoreClientRepository({ merge: async (...args) => writes.push(args) });
  await repository.createClient({ ...context, organizationId: "org-a" }, { id: "client-1" });
  await repository.createClient({ ...context, organizationId: "org-b" }, { id: "client-1" });
  assert.notEqual(writes[0][0], writes[1][0]);
  assert.throws(
    () => repository.createClient({ ...context, organizationId: "" }, { id: "client-2" }),
    /Missing organizationId/,
  );
  assert.equal(writes.length, 2);
});
