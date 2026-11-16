/**
 * 2026-11-16 하주은 강사 제보: "AI 말하기로 기록했는데 계속 미기록 알림".
 * "기록" 화면(NoteForm)은 기록을 수업과 잇는 칸이 없어 언제나 sid 없이 저장했다 -- 그 수업은 영영 미기록.
 *  - 화면: 어느 수업의 기록인지 고르는 칸 (기본: 오늘 · 최근의 기록 없는 수업)
 *  - 저장: 고른 수업을 sid 로, 없으면 칸을 두지 않는다 (undefined 금지)
 *  - 이미 쌓인 기록: 틀릴 수 없는 경우만 그 수업에 잇는다 (linkOrphanLessonNotes)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { linkOrphanLessonNotes } from "../../src/features/lesson-record/note-edit.js";
import { selectPendingLessonSessions } from "../../src/features/lesson-record/member-detail-selectors.js";

const lesson = (id, date, memberId = "m1", status = "done", extra = {}) => ({
  id, date, start: "10:00", end: "10:50", type: "개인레슨", attendees: [{ memberId, status }], ...extra,
});
const orphan = (id, date, extra = {}) => ({ id, date, type: "개인레슨", body: "오늘은 브릿지", transcript: "오늘은 브릿지", voiceSource: "native", ...extra });

test("같은 날 기록 하나 · 출석한 미기록 수업 하나면 잇는다 -- 그러면 미기록이 사라진다", () => {
  const members = [{ id: "m1", status: "active", notes: [orphan("n1", "2026-11-15")] }];
  const schedule = [lesson("L1", "2026-11-15")];
  const before = selectPendingLessonSessions({ members, schedule, now: new Date("2026-11-16T09:00:00") });
  assert.ok(before.sessions.some((item) => item.reasons.includes("record")), "고치기 전에는 미기록");
  const { members: next, linked } = linkOrphanLessonNotes({ members, schedule });
  assert.equal(linked, 1);
  assert.equal(next[0].notes[0].sid, "L1");
  const after = selectPendingLessonSessions({ members: next, schedule, now: new Date("2026-11-16T09:00:00") });
  assert.equal(after.sessions.some((item) => item.reasons.includes("record")), false, "미기록이 없다");
});

test("틀릴 수 있으면 잇지 않는다", () => {
  // 같은 날 수업이 둘
  let r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15")] }], schedule: [lesson("L1", "2026-11-15"), lesson("L2", "2026-11-15")] });
  assert.equal(r.linked, 0);
  // 같은 날 sid 없는 기록이 둘
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15"), orphan("n2", "2026-11-15")] }], schedule: [lesson("L1", "2026-11-15")] });
  assert.equal(r.linked, 0);
  // 날짜가 다르다
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-16")] }], schedule: [lesson("L1", "2026-11-15")] });
  assert.equal(r.linked, 0);
  // 출석 전(예약)
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15")] }], schedule: [lesson("L1", "2026-11-15", "m1", "booked")] });
  assert.equal(r.linked, 0);
  // 상담 메모
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15", { type: "상담" })] }], schedule: [lesson("L1", "2026-11-15")] });
  assert.equal(r.linked, 0);
  // 그 수업에 이미 기록이 있다
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15"), orphan("n0", "2026-11-15", { sid: "L1" })] }], schedule: [lesson("L1", "2026-11-15")] });
  assert.equal(r.linked, 0);
  // 다른 회원의 수업
  r = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15")] }], schedule: [lesson("L1", "2026-11-15", "m2")] });
  assert.equal(r.linked, 0);
});

test("바뀐 회원만 새 객체 -- 나머지는 그대로", () => {
  const untouched = { id: "m2", notes: [orphan("x", "2026-11-01")] };
  const { members } = linkOrphanLessonNotes({ members: [{ id: "m1", notes: [orphan("n1", "2026-11-15")] }, untouched], schedule: [lesson("L1", "2026-11-15")] });
  assert.equal(members[1], untouched);
});

test("화면 · 저장: 기록 화면에 수업 고르기, 고른 수업이 sid 로, 없으면 칸이 없다", async () => {
  const source = await readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");
  const form = source.slice(source.indexOf("function NoteForm("), source.indexOf("const clampScore"));
  assert.match(form, /linkableLessonsFor\(\{ memberId: member\?\.id/);
  assert.match(form, /useState\(\(\) => defaultLinkLesson\(linkableLessons, todayISO\(\)\)\)/);
  assert.match(form, /data-record-lesson-link/);
  assert.match(form, /\.\.\.\(linkLessonId \? \{ sid: linkLessonId \} : \{\}\)/);
  assert.match(source, /const linkedSid = String\(note\.sid \|\| noteSid \|\| ""\)\.trim\(\);/);
  assert.match(source, /linkedSid \? \{ \.\.\.finalizedWithoutSid, sid: linkedSid \} : finalizedWithoutSid/);
  assert.doesNotMatch(source, /sid: noteSid \|\| undefined/);
  assert.match(source, /hasLessonLink: Boolean\(linkedSid\)/);
  assert.match(source, /"lessonId", "hasLessonLink",/, "진단 화이트리스트");
  assert.match(source, /const \{ members, linked \} = linkOrphanLessonNotes\(normalized\);/, "앱을 열 때 잇는다");
});
