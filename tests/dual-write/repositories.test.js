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

test("client repository physically deletes the selected member document", async () => {
  const removals = [];
  const repository = new FirestoreClientRepository({ merge: async () => {}, remove: async (...args) => removals.push(args) });
  await repository.deleteClient(context, "client-1");
  assert.deepEqual(removals, [["organizations/org-1/clients/client-1"]]);
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

/* ── 연락처는 만들 때만 보낸다 ────────────────────────────────────────

   기기마다 명부가 따로다. 강사 폰에 옛 번호가 남아 있는데 그 강사가 회원
   메모를 고치면, 이 어댑터가 옛 번호를 함께 실어 보내 방금 바뀐 번호를
   되돌려 놓는다 -- 규칙이 phone 을 잠근 뒤로는 되돌리는 대신 **그 수정 자체가
   거부된다.** 메모를 고치려던 강사에게는 이유 없는 실패다. */

test("the client update never carries a phone number", async () => {
  const writes = [];
  const repository = new FirestoreClientRepository({ merge: async (...args) => writes.push(args) });
  await repository.updateClient(context, { id: "client-1", name: "김하나", phone: "010-0000-0000" });
  assert.equal("phone" in writes[0][1], false, "수정이 옛 번호를 실어 보냈다");
  // 나머지는 그대로 간다 -- 번호만 빼는 것이지 수정을 막는 것이 아니다.
  assert.equal(writes[0][1].name, "김하나");
});

test("the client create stores digits only", async () => {
  /* 010-1234-5678 로 저장되면 회원 앱의 where("phone","==",…) 가 그 회원을
     영영 찾지 못한다. 저장은 언제나 숫자만이다. */
  const writes = [];
  const repository = new FirestoreClientRepository({ merge: async (...args) => writes.push(args) });
  await repository.createClient(context, { id: "client-1", name: "김하나", phone: "010-1234-5678" });
  assert.equal(writes[0][1].phone, "01012345678");
});

test("archiving a client does not resend the phone either", async () => {
  // 종료도 수정이다. 같은 문으로 들어간다.
  const writes = [];
  const repository = new FirestoreClientRepository({ merge: async (...args) => writes.push(args) });
  await repository.archiveClient(context, { id: "client-1", name: "김하나", phone: "010-0000-0000" });
  assert.equal("phone" in writes[0][1], false);
});
