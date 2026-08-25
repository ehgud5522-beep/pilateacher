import assert from "node:assert/strict";
import test from "node:test";

import { createMemberBriefing } from "../../src/features/member-memory/briefing.js";
import { buildMemberMemory, confirmedSessions, rejectMemoryEntry, selectLastLessonMemoryRecord } from "../../src/features/member-memory/member-memory.js";
import { readMemberMemoryUsage, trackMemberMemoryUsage } from "../../src/features/member-memory/usage-telemetry.js";

const item = (text, origin = "ai") => ({ text, origin });
const note = (id, date, fields = {}, options = {}) => ({
  id: `note-${id}`,
  sid: id,
  date,
  body: options.body || "확정 기록",
  lessonRecord: {
    stage: "confirmed_record",
    status: options.raw ? "confirmed_unstructured" : "confirmed",
    rawTranscript: options.raw || "",
    confirmedRecord: options.raw ? { rawTranscript: options.raw, origin: "raw" } : {
      didToday: [], observations: [], responses: [], nextFocus: [], uncertain: [], ...fields,
    },
  },
});
const member = (notes, extra = {}) => ({ id: "m1", name: "제이", regular: 10, service: 0, notes, ...extra });

test("single observation becomes sourced memory and didToday is not promoted", () => {
  const built = buildMemberMemory({ memberId: "m1", notes: [note("s1", "2026-08-01", { didToday: [item("리포머 풋워크")], observations: [item("오른쪽 고관절 불편")] })], now: "2026-08-02" });
  assert.equal(built.memories.length, 1);
  assert.equal(built.memories[0].type, "observation");
  assert.equal(built.memories[0].bodyKey.region, "hip.joint");
  assert.deepEqual(built.memories[0].sourceRefs.map((source) => source.id), ["s1"]);
});

test("different sessions merge and promote a pattern without counting same-session duplicates", () => {
  const duplicate = note("s1", "2026-08-01", { observations: [item("오른쪽 고관절 불편"), item("오른쪽 고관절 통증")] });
  const repeated = note("s2", "2026-08-08", { observations: [item("오른쪽 고관절 뻣뻣함")] });
  const once = buildMemberMemory({ memberId: "m1", notes: [duplicate], now: "2026-08-02" });
  assert.equal(once.memories[0].seenCount, 1);
  const twice = buildMemberMemory({ memberId: "m1", notes: [duplicate, repeated], now: "2026-08-09" });
  assert.equal(twice.memories[0].seenCount, 2);
  assert.equal(twice.stats.patternCount, 1);
  assert.match(createMemberBriefing({ member: member([duplicate, repeated]), now: "2026-08-09" }).lines.map((entry) => entry.text).join("\n"), /관련 기록 2회/);
});

test("memory becomes stale after five later confirmed sessions and is excluded from briefing", () => {
  const first = note("s0", "2026-01-01", { observations: [item("오른쪽 고관절 불편")] });
  const later = Array.from({ length: 5 }, (_, index) => note(`s${index + 1}`, `2026-01-${String(index + 2).padStart(2, "0")}`, { responses: [item(`코어 안정성 확인 ${index + 1}`)] }));
  const built = buildMemberMemory({ memberId: "m1", notes: [first, ...later], now: "2026-01-08" });
  const hip = built.memories.find((entry) => entry.bodyKey.region === "hip.joint");
  assert.equal(hip.status, "stale");
  assert.doesNotMatch(createMemberBriefing({ member: member([first, ...later]), now: "2026-01-08" }).lines.map((entry) => entry.text).join("\n"), /고관절 불편/);
});

test("opposite records become conflict and briefing shows both dated sources without improvement inference", () => {
  const notes = [
    note("s1", "2026-08-10", { observations: [item("오른쪽 고관절 불편 기록")] }),
    note("s2", "2026-08-17", { responses: [item("오른쪽 고관절 불편 없음")] }),
  ];
  const briefing = createMemberBriefing({ member: member(notes), now: "2026-08-18" });
  assert.equal(briefing.memories.filter((entry) => entry.status === "conflict").length, 2);
  const text = briefing.lines.map((entry) => entry.text).join("\n");
  assert.match(text, /최근 기록이 달라졌습니다/);
  assert.match(text, /8\/10·8\/17/);
  assert.doesNotMatch(text, /개선됐습니다/);
});

test("rejected AI memory suppresses the same candidate while instructor memory is protected", () => {
  const notes = [note("s1", "2026-08-10", { observations: [item("오른쪽 고관절 불편")] })];
  const initial = buildMemberMemory({ memberId: "m1", notes, now: "2026-08-11" });
  const rejected = rejectMemoryEntry(initial.memories, initial.memories[0].id, "2026-08-11T00:00:00Z");
  const rebuilt = buildMemberMemory({ memberId: "m1", notes: [...notes, note("s2", "2026-08-12", { observations: [item("오른쪽 고관절 통증")] })], existingMemory: rejected, now: "2026-08-13" });
  assert.equal(rebuilt.memories.filter((entry) => entry.status === "active").length, 0);
  assert.ok(rebuilt.stats.suppressedCount >= 1);

  const instructor = { ...initial.memories[0], origin: "instructor", text: "선생님이 확정한 고관절 기록" };
  const protectedResult = buildMemberMemory({ memberId: "m1", notes: [...notes, note("s2", "2026-08-12", { observations: [item("오른쪽 고관절 통증", "ai")] })], existingMemory: [instructor], now: "2026-08-13" });
  assert.equal(protectedResult.memories[0].text, "선생님이 확정한 고관절 기록");
  assert.equal(protectedResult.memories[0].origin, "instructor");
});

test("instructor nextFocus ranks first even on its first occurrence", () => {
  const notes = [note("s1", "2026-08-18", {
    observations: [item("브릿지 안정감이 좋았어요")],
    nextFocus: [item("오른쪽 고관절 다시 확인", "instructor")],
  })];
  const briefing = createMemberBriefing({ member: member(notes), now: "2026-08-19" });
  assert.equal(briefing.lines[0].kind, "next_focus");
  assert.match(briefing.lines[0].text, /선생님 메모: 오른쪽 고관절 다시 확인/);
  assert.equal(briefing.lines[0].sourceRefs[0].id, "s1");
});

test("raw-only record is quoted briefly and first lesson stays literal", () => {
  const raw = note("s1", "2026-08-18", {}, { raw: "오늘 회원이 직접 말한 원문을 그대로 저장했습니다." });
  const rawBriefing = createMemberBriefing({ member: member([raw]), now: "2026-08-19" });
  assert.equal(rawBriefing.kind, "raw_only");
  assert.equal(rawBriefing.lines[0].text, "[8/18] 수업 기록: 오늘 회원이 직접 말한 원문을 그대로 저장했습니다.");
  const first = createMemberBriefing({ member: member([]), now: "2026-08-19" });
  assert.deepEqual(first.lines.map((entry) => entry.text), ["첫 수업"]);
});

test("last lesson uses today lesson, then model summary, then raw teacher record", () => {
  const structured = note("s1", "2026-08-18", { didToday: [item("브릿지")] });
  structured.lessonRecord.provenanceSource = "openai";
  const structuredDisplay = selectLastLessonMemoryRecord(confirmedSessions([structured])[0]);
  assert.deepEqual({ text: structuredDisplay.text, source: structuredDisplay.provenanceSource, label: structuredDisplay.sourceLabel }, { text: "브릿지", source: "openai", label: "[AI]" });

  const summarized = note("s1-summary", "2026-08-18", { summary: "오른쪽 허리 움직임이 좋아졌고 운동 중에는 힘들어했습니다." });
  summarized.lessonRecord.provenanceSource = "openai";
  const summaryDisplay = selectLastLessonMemoryRecord(confirmedSessions([summarized])[0]);
  assert.deepEqual({ text: summaryDisplay.text, source: summaryDisplay.provenanceSource, label: summaryDisplay.sourceLabel }, { text: "오른쪽 허리 움직임이 좋아졌고 운동 중에는 힘들어했습니다.", source: "openai", label: "[AI]" });

  const raw = note("s2", "2026-08-19", {}, { raw: "운동을 할 때 힘들었고 오른쪽 허리가 좋아졌습니다" });
  raw.lessonRecord.provenanceSource = "fallback_raw";
  const rawDisplay = selectLastLessonMemoryRecord(confirmedSessions([raw])[0]);
  assert.deepEqual({ text: rawDisplay.text, source: rawDisplay.provenanceSource, label: rawDisplay.sourceLabel }, { text: "운동을 할 때 힘들었고 오른쪽 허리가 좋아졌습니다", source: "fallback_raw", label: "선생님 기록" });
  assert.notEqual(rawDisplay.sourceLabel, "[AI]");
});

test("no-comment does not create memory or masquerade as confirmed history", () => {
  const briefing = createMemberBriefing({ member: member([{ id: "n1", sid: "s1", date: "2026-08-18", body: "특이사항 없음" }]), now: "2026-08-19" });
  assert.equal(briefing.kind, "first_lesson");
  assert.equal(briefing.memories.length, 0);
});

test("member isolation and current-session exclusion prevent cross-member or same-session leakage", () => {
  const m1 = member([note("m1-s1", "2026-08-18", { nextFocus: [item("오른쪽 고관절 다시 확인")] })]);
  const m2 = { ...member([note("m2-s1", "2026-08-18", { nextFocus: [item("왼쪽 견갑 다시 확인")] })]), id: "m2", name: "민지" };
  assert.doesNotMatch(createMemberBriefing({ member: m1, currentSessionId: "m1-s2", now: "2026-08-19" }).lines.map((entry) => entry.text).join("\n"), /견갑/);
  assert.doesNotMatch(createMemberBriefing({ member: m2, currentSessionId: "m2-s2", now: "2026-08-19" }).lines.map((entry) => entry.text).join("\n"), /고관절/);
  assert.equal(createMemberBriefing({ member: m1, currentSessionId: "m1-s1", now: "2026-08-19" }).kind, "first_lesson");
});

test("closed loop returns the confirmed nextFocus on the same member's next scheduled session", () => {
  const confirmed = note("jay-first", "2026-08-23", {
    didToday: [item("리포머 풋워크"), item("브릿지")],
    responses: [item("브릿지는 안정감이 좋았어요")],
    nextFocus: [item("오른쪽 고관절은 다음 시간에 다시 볼게요", "instructor")],
  });
  const jay = member([confirmed]);
  const nextBriefing = createMemberBriefing({ member: jay, currentSessionId: "jay-next", now: "2026-08-24" });
  assert.match(nextBriefing.lines[0].text, /^\[8\/23\] 선생님 메모: 오른쪽 고관절은 다음 시간에 다시 볼게요$/);
  assert.equal(nextBriefing.lines[0].sourceRefs[0].id, "jay-first");
  assert.ok(nextBriefing.memories.every((entry) => entry.memberId === "m1" && entry.sourceRefs.length > 0));
});

test("briefing telemetry counts only numeric aggregates and never stores lesson content or LLM calls", () => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)) };
  trackMemberMemoryUsage("briefing_rendered", { count: 2, text: "민감한 수업 원문" }, storage);
  trackMemberMemoryUsage("briefing_opened", { count: 1 }, storage);
  trackMemberMemoryUsage("memory_candidates", { count: 3 }, storage);
  trackMemberMemoryUsage("memory_merged", { count: 1 }, storage);
  trackMemberMemoryUsage("patterns", { count: 2 }, storage);
  const usage = readMemberMemoryUsage(storage);
  assert.deepEqual({ rendered: usage.briefingRendered, opened: usage.briefingOpened, candidates: usage.memoryCandidateCount, merged: usage.memoryMergedCount, patterns: usage.patternCount }, { rendered: 2, opened: 1, candidates: 3, merged: 1, patterns: 2 });
  assert.doesNotMatch([...data.values()].join("\n"), /민감한 수업 원문|llm/i);
});
