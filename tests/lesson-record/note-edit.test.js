/**
 * 수업일지 D (2026-11-07): 음성 확정이 직접 쓴 기록을 덮지 않는다 · 다시 열면 같은 기록을
 * 고친다 · 회원 상세의 기록을 수업에 잇는다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { upsertLessonRecordNote } from "../../src/features/lesson-record/link-context.js";
import {
  defaultLinkLesson, isVoiceRecordNote, linkableLessonsFor, manualNoteFor, voiceNoteFor,
} from "../../src/features/lesson-record/note-edit.js";

const manual = (overrides = {}) => ({
  id: "m1", sid: "L1", date: "2026-11-07", body: "손으로 쓴 기록 — 골반 정렬 위주",
  lessonRecord: { stage: "confirmed_record", status: "confirmed_manual", confirmationStatus: "confirmed" },
  ...overrides,
});
const voice = (overrides = {}) => ({
  id: "v1", sid: "L1", date: "2026-11-07", body: "음성 정리본", transcript: "오늘은 브릿지", voiceSource: "native",
  lessonRecord: { stage: "confirmed_record", status: "confirmed", confirmedRecord: { didToday: ["브릿지"] } },
  ...overrides,
});

test("음성 기록과 직접 입력을 가른다", () => {
  assert.equal(isVoiceRecordNote(voice()), true);
  assert.equal(isVoiceRecordNote(manual()), false);
  assert.equal(isVoiceRecordNote({ id: "x", body: "특이사항 없음" }), false, "노코멘트");
  assert.equal(isVoiceRecordNote({ id: "d", sid: "L1", lessonRecord: { stage: "raw_transcript" } }), true, "확정 전 음성 초안");
});

test("손실 방지 — 음성 확정이 같은 수업의 직접 입력을 지우지 않는다", () => {
  const before = [manual(), { id: "other", sid: "L2", body: "다른 수업" }];
  const after = upsertLessonRecordNote(before, voice({ id: "new" }), { lessonId: "L1" });
  const kept = after.find((note) => note.id === "m1");
  assert.ok(kept, "직접 쓴 기록이 남아 있어야 한다");
  assert.equal(kept.body, "손으로 쓴 기록 — 골반 정렬 위주", "본문이 그대로");
  assert.ok(after.find((note) => note.id === "new"), "음성 기록도 있다");
  assert.ok(after.find((note) => note.id === "other"), "다른 수업 기록은 그대로");
  assert.equal(after.length, 3);
});

test("음성 확정은 같은 수업의 음성 기록(초안 · 중복)만 하나로 합친다", () => {
  const before = [
    voice({ id: "v-draft", lessonRecord: { stage: "structured_draft", structuredDraft: { didToday: ["초안"] } } }),
    manual(),
    voice({ id: "v-dup" }),
  ];
  const after = upsertLessonRecordNote(before, voice({ id: "incoming", body: "확정본" }), { lessonId: "L1" });
  const voices = after.filter(isVoiceRecordNote);
  assert.equal(voices.length, 1, "음성 기록은 하나");
  assert.equal(voices[0].id, "v-draft", "먼저 있던 음성 기록의 id 를 잇는다");
  assert.equal(voices[0].body, "확정본");
  assert.ok(after.find((note) => note.id === "m1"), "직접 입력은 남는다");
});

test("다시 열기 — 그 수업의 직접 입력 기록을 찾는다 (음성 기록은 아니다)", () => {
  const notes = [voice(), manual({ id: "m-new", body: "고친 글" }), manual({ id: "m-old", body: "옛 글" })];
  assert.equal(manualNoteFor(notes, "L1")?.id, "m-new", "가장 최근 직접 입력");
  assert.equal(voiceNoteFor(notes, "L1")?.id, "v1");
  assert.equal(manualNoteFor(notes, "L9"), null);
  assert.equal(manualNoteFor(notes, ""), null, "수업이 없으면 고칠 대상도 없다");
  assert.equal(manualNoteFor(undefined, "L1"), null);
});

const SCHEDULE = [
  { id: "today-a", date: "2026-11-07", start: "10:00", type: "개인레슨", memberId: "c1", attendees: [{ memberId: "c1", status: "done" }] },
  { id: "today-b", date: "2026-11-07", start: "15:00", type: "듀엣", memberIds: ["c1", "c2"], attendees: [{ memberId: "c1", status: "done" }, { memberId: "c2", status: "done" }] },
  { id: "yesterday", date: "2026-11-06", start: "09:00", type: "개인레슨", memberId: "c1", attendees: [{ memberId: "c1", status: "done" }] },
  { id: "future", date: "2026-11-08", start: "09:00", type: "개인레슨", memberId: "c1", attendees: [{ memberId: "c1", status: "booked" }] },
  { id: "cancelled", date: "2026-11-05", start: "09:00", type: "개인레슨", memberId: "c1", attendees: [{ memberId: "c1", status: "cancel" }] },
  { id: "someone-else", date: "2026-11-07", start: "11:00", type: "개인레슨", memberId: "c9", attendees: [{ memberId: "c9", status: "done" }] },
  { id: "personal", date: "2026-11-07", start: "12:00", personal: true, title: "상담" },
];

test("회원 상세 기록을 이을 수업 — 그 회원의 오늘까지 수업, 최근 것이 앞, 취소 · 미래 · 남의 수업 제외", () => {
  const list = linkableLessonsFor({ memberId: "c1", notes: [{ id: "n", sid: "today-b" }], schedule: SCHEDULE, today: "2026-11-07" });
  assert.deepEqual(list.map((lesson) => lesson.id), ["today-b", "today-a", "yesterday"]);
  assert.equal(list[0].hasRecord, true);
  assert.equal(list[1].hasRecord, false);
});

test("처음 골라 둘 수업 — 오늘의 기록 없는 수업, 없으면 최근의 기록 없는 수업, 그것도 없으면 잇지 않음", () => {
  const list = linkableLessonsFor({ memberId: "c1", notes: [{ id: "n", sid: "today-b" }], schedule: SCHEDULE, today: "2026-11-07" });
  assert.equal(defaultLinkLesson(list, "2026-11-07"), "today-a");
  const allToday = list.map((lesson) => (lesson.date === "2026-11-07" ? { ...lesson, hasRecord: true } : lesson));
  assert.equal(defaultLinkLesson(allToday, "2026-11-07"), "yesterday");
  assert.equal(defaultLinkLesson(list.map((lesson) => ({ ...lesson, hasRecord: true })), "2026-11-07"), "");
  assert.equal(defaultLinkLesson([], "2026-11-07"), "", "수업이 없으면 전처럼 잇지 않는다");
});
