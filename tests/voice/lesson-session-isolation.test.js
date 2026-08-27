import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  lessonRecordSessionKey, listPendingLessonRecords, loadPendingLessonRecord,
  removePendingLessonRecordsForMember, savePendingLessonRecord,
} from "../../src/features/lesson-record/draft-queue.js";
import { evaluateLessonRecordLink, linkScheduleToMember, upsertLessonRecordNote } from "../../src/features/lesson-record/link-context.js";
import { runLessonRecordRetryCycle, scheduleLessonRecordRetry } from "../../src/features/lesson-record/retry-queue.js";

const memoryStorage = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)) };
};

test("three lessons for the same member have isolated draft keys and confirmed links", () => {
  const storage = memoryStorage();
  const members = [{ id: "member-a" }];
  const schedule = [1, 2, 3].map((index) => ({ id: `lesson-${index}`, attendees: [{ memberId: "member-a" }] }));
  schedule.forEach((lesson, index) => {
    savePendingLessonRecord("member-a", lesson.id, { rawTranscript: `record-${index + 1}` }, storage);
    assert.equal(evaluateLessonRecordLink({ members, schedule, memberId: "member-a", lessonId: lesson.id }).state, "linked");
  });
  assert.equal(new Set(schedule.map((lesson) => lessonRecordSessionKey("member-a", lesson.id))).size, 3);
  assert.equal(loadPendingLessonRecord("member-a", "lesson-1", storage).rawTranscript, "record-1");
  assert.equal(loadPendingLessonRecord("member-a", "lesson-2", storage).rawTranscript, "record-2");
  assert.equal(loadPendingLessonRecord("member-a", "lesson-3", storage).rawTranscript, "record-3");
});

test("a payload stored under the wrong session key is not restored", () => {
  const storage = memoryStorage();
  storage.setItem("pilateacher_lesson_record_queue_v1", JSON.stringify({
    "member-a:lesson-2": { memberId: "member-a", lessonId: "lesson-1", rawTranscript: "old lesson" },
  }));
  assert.equal(loadPendingLessonRecord("member-a", "lesson-2", storage), null);
});

test("current schedule match is decisive and missing link can be resolved in one step", () => {
  const members = [{ id: "member-a" }];
  const schedule = [{ id: "lesson-2", attendees: [], memberIds: [] }];
  const before = evaluateLessonRecordLink({ members, schedule, memberId: "member-a", lessonId: "lesson-2" });
  assert.equal(before.state, "link_review_required");
  const linked = linkScheduleToMember(schedule[0], "member-a");
  const after = evaluateLessonRecordLink({ members, schedule: [linked], memberId: "member-a", lessonId: "lesson-2" });
  assert.equal(after.state, "linked");
  assert.deepEqual(after.scheduleMemberIds, ["member-a"]);
});

test("same lesson recording upserts the existing record and removes duplicate sessions", () => {
  const notes = [
    { id: "record-original", sid: "lesson-1", body: "first", lessonRecord: { stage: "confirmed_record" } },
    { id: "record-duplicate", sid: "lesson-1", body: "duplicate", lessonRecord: { stage: "structured_draft" } },
    { id: "other", sid: "lesson-2", body: "other" },
  ];
  const next = upsertLessonRecordNote(notes, { id: "new", sid: "lesson-1", body: "updated", lessonRecord: { stage: "confirmed_record" } }, { lessonId: "lesson-1" });
  assert.equal(next.filter((note) => note.sid === "lesson-1").length, 1);
  assert.equal(next.find((note) => note.sid === "lesson-1").id, "record-original");
  assert.equal(next.find((note) => note.sid === "lesson-1").body, "updated");
});

test("member cleanup removes only that member drafts and returns audio blobs", () => {
  const storage = memoryStorage();
  savePendingLessonRecord("member-a", "lesson-1", { rawTranscript: "one", audioBlobId: "blob-1" }, storage);
  savePendingLessonRecord("member-a", "lesson-2", { rawTranscript: "two", audioClips: [{ blobId: "blob-2", state: "pending" }] }, storage);
  savePendingLessonRecord("member-b", "lesson-3", { rawTranscript: "three" }, storage);
  const result = removePendingLessonRecordsForMember("member-a", storage);
  assert.equal(result.removed, 2);
  assert.deepEqual(new Set(result.blobIds), new Set(["blob-1", "blob-2"]));
  assert.deepEqual(listPendingLessonRecords(storage).map((draft) => draft.memberId), ["member-b"]);
});

test("render tree keys VoiceNote by lesson session and offers one-tap recovery", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(source, /key=\{lessonRecordSessionKey\(activeMemberId, draft\.id\)\}/);
  assert.match(source, /key=\{lessonRecordSessionKey\(task\.a\.memberId, task\.s\.id\)\}/);
  assert.match(source, />이 회원으로 연결</);
  assert.match(source, /server_audio_preflight/);
  assert.match(source, /text_summary_preflight/);
});

test("background retry verifies the current lesson link before calling the provider", async () => {
  const storage = memoryStorage();
  let providerCalls = 0;
  savePendingLessonRecord("member-a", "lesson-2", { rawTranscript: "브릿지를 진행했습니다" }, storage);
  scheduleLessonRecordRetry("member-a", "lesson-2", { code: "network_offline" }, storage, 0);
  const result = await runLessonRecordRetryCycle({
    llmProvider: { async structureLessonRecord() { providerCalls += 1; return { status: "structured", output: {} }; } },
    beforeAttempt: async () => ({ state: "link_review_required", reason: "schedule_member_missing", scheduleMemberIds: [] }),
    storage,
    now: 60_000,
  });
  assert.equal(providerCalls, 0);
  assert.equal(result.failed, 1);
  assert.equal(loadPendingLessonRecord("member-a", "lesson-2", storage).failure.code, "member_session_unresolved");
});
