/** 설계 문서 1단계-5 · 서버 기록 읽기. 화면에만 더하고, 기기 기록이 이기고, 고치기 대상이 아니다. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeServerNotes, notesFromServerRecords } from "../../src/features/lesson-record/server-notes.js";
import { manualNoteFor, voiceNoteFor } from "../../src/features/lesson-record/note-edit.js";

const row = (id, extra = {}) => ({ id, clientId: "c1", createdBy: "t2", deviceNoteId: `n-${id}`, lessonId: "L1", lessonDate: "2026-11-10", kind: "manual", body: `본문 ${id}`, createdAt: { seconds: 100 }, ...extra });

test("고친 기록은 마지막 판만, 옛 줄은 빠진다", () => {
  const notes = notesFromServerRecords([
    row("a", { deviceNoteId: "n1" }),
    row("b", { deviceNoteId: "n1", supersedes: "a", body: "고친 본문", createdAt: { seconds: 200 } }),
  ]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].body, "고친 본문");
  assert.equal(notes[0].serverOnly, true);
  assert.equal(notes[0].id, "server:b");
});

test("기기에 같은 기록이 있으면 기기 것이 이긴다", () => {
  const member = { id: "m1", notes: [{ id: "n1", sid: "L1", body: "기기 본문" }] };
  const merged = mergeServerNotes(member, [row("a", { deviceNoteId: "n1" }), row("b", { lessonId: "L2", lessonDate: "2026-11-12" })]);
  assert.equal(merged.notes.length, 2);
  assert.equal(merged.notes[0].body, "기기 본문");
  assert.equal(merged.notes[1].id, "server:b");
  assert.equal(member.notes.length, 1, "기기 회원 객체는 바꾸지 않는다");
});

test("서버 기록이 없으면 회원 객체를 그대로 돌려준다", () => {
  const member = { id: "m1", notes: [] };
  assert.equal(mergeServerNotes(member, []), member);
  assert.equal(mergeServerNotes(member, null), member);
  assert.equal(mergeServerNotes(null, [row("a")]), null);
});

test("음성 기록은 네 칸을 확정본으로 싣는다, 빈 본문은 버린다", () => {
  const fields = { lessonContent: [{ text: "롤업", origin: "ai" }] };
  const notes = notesFromServerRecords([row("v", { kind: "voice", fields }), row("e", { body: "  " })]);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].lessonRecord.confirmedRecord, fields);
  assert.equal(notes[0].lessonRecord.confirmationStatus, "confirmed");
});

test("서버에서 더한 기록은 고치기 대상으로 잡히지 않는다 -- 다른 강사 기록을 덮어쓰지 않게", () => {
  const notes = notesFromServerRecords([row("a"), row("v", { kind: "voice", fields: { lessonContent: [{ text: "x", origin: "ai" }] } })]);
  assert.equal(manualNoteFor(notes, "L1"), null);
  assert.equal(voiceNoteFor(notes, "L1"), null);
});

test("App 은 스위치(lessonRecordServerRead)로만 켜고, 회원 상세 · 수업 관리에 합친 회원을 쓴다", () => {
  const app = readFileSync(new URL("../../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /scheduleSyncEnabledFor\(scheduleSyncConfig\?\.lessonRecordServerRead, account\?\.id\)/);
  assert.match(app, /const member = useServerMergedMember\(deviceMember\);/);
  assert.match(app, /const activeMember = useServerMergedMember\(members\.find/);
  assert.match(app, /<ServerNotesContext\.Provider value=\{serverNotesValue\}>/);
});
