import assert from "node:assert/strict";
import test from "node:test";

import { createMemberBriefing, selectScheduleBriefing } from "../../src/features/member-memory/briefing.js";
import { buildMemberMemory, confirmedSessions, memorySourceSessions, rejectMemoryEntry, selectLastLessonMemoryRecord } from "../../src/features/member-memory/member-memory.js";
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
const storedBriefing = (notes, options = {}) => {
  const built = buildMemberMemory({ memberId: "m1", notes, schedule: options.schedule || [], now: options.now || "2026-09-01" });
  const storedMember = JSON.parse(JSON.stringify(member(notes, { aiMemory: built.memories })));
  return createMemberBriefing({ member: storedMember, schedule: options.schedule || [], currentSessionId: options.currentSessionId || null });
};
const draftNote = (id, date, fields = {}, rawTranscript = "") => ({
  id: `note-${id}`,
  sid: id,
  date,
  body: rawTranscript || "확인 전 기록",
  transcript: rawTranscript,
  lessonRecord: rawTranscript && !Object.keys(fields).length
    ? { stage: "raw_transcript", status: "unstructured", confirmationStatus: "pending", rawTranscript }
    : { stage: "structured_draft", status: "structured", confirmationStatus: "pending", rawTranscript, structuredDraft: { didToday: [], observations: [], responses: [], nextFocus: [], ...fields } },
});

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
  assert.match(storedBriefing([duplicate, repeated], { now: "2026-08-09" }).lines.map((entry) => entry.text).join("\n"), /계속 확인: 오른쪽 고관절 뻣뻣함/);
});

test("memory becomes stale after five later confirmed sessions and is excluded from briefing", () => {
  const first = note("s0", "2026-01-01", { observations: [item("오른쪽 고관절 불편")] });
  const later = Array.from({ length: 5 }, (_, index) => note(`s${index + 1}`, `2026-01-${String(index + 2).padStart(2, "0")}`, { responses: [item(`코어 안정성 확인 ${index + 1}`)] }));
  const built = buildMemberMemory({ memberId: "m1", notes: [first, ...later], now: "2026-01-08" });
  const hip = built.memories.find((entry) => entry.bodyKey.region === "hip.joint");
  assert.equal(hip.status, "stale");
  const stored = member([first, ...later], { aiMemory: built.memories });
  assert.doesNotMatch(createMemberBriefing({ member: stored }).lines.map((entry) => entry.text).join("\n"), /고관절 불편/);
});

test("opposite records become conflict and briefing shows both dated sources without improvement inference", () => {
  const notes = [
    note("s1", "2026-08-10", { observations: [item("오른쪽 고관절 불편 기록")] }),
    note("s2", "2026-08-17", { responses: [item("오른쪽 고관절 불편 없음")] }),
  ];
  const built = buildMemberMemory({ memberId: "m1", notes, now: "2026-08-18" });
  const briefing = createMemberBriefing({ member: member(notes, { aiMemory: built.memories }) });
  assert.equal(briefing.memories.filter((entry) => entry.status === "conflict").length, 2);
  const text = briefing.lines.map((entry) => entry.text).join("\n");
  assert.match(text, /08\.10 · 계속 확인/);
  assert.match(text, /08\.17 · 회원 반응/);
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
  const briefing = storedBriefing(notes, { now: "2026-08-19" });
  assert.equal(briefing.lines[0].kind, "next_focus");
  assert.match(briefing.lines[0].text, /^08\.18 · 다음 확인: 오른쪽 고관절 다시 확인$/);
  assert.equal(briefing.lines[0].sourceRefs[0].id, "s1");
});

test("raw-only record is dated without inventing fields and an empty member has no forced line", () => {
  const raw = note("s1", "2026-08-18", {}, { raw: "오늘 회원이 직접 말한 원문을 그대로 저장했습니다." });
  const rawBriefing = createMemberBriefing({ member: member([raw]), now: "2026-08-19" });
  assert.equal(rawBriefing.kind, "memory");
  assert.equal(rawBriefing.lines[0].text, "08.18 · 지난 수업: 오늘 회원이 직접 말한 원문을 그대로 저장했습니다.");
  const first = createMemberBriefing({ member: member([]), now: "2026-08-19" });
  assert.deepEqual(first.lines, []);
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

test("unreviewed low-confidence records never enter member memory", () => {
  const flagged = note("flagged-1", "2026-08-26", { observations: [item("오른쪽 허리 좋아짐")] });
  flagged.lessonRecord.reviewFlags = ["low_confidence"];
  assert.deepEqual(confirmedSessions([flagged]), []);
  assert.equal(buildMemberMemory({ memberId: "m1", notes: [flagged], now: "2026-08-26" }).memories.length, 0);
});

test("no-comment does not create memory or masquerade as confirmed history", () => {
  const briefing = createMemberBriefing({ member: member([{ id: "n1", sid: "s1", date: "2026-08-18", body: "특이사항 없음" }]), now: "2026-08-19" });
  assert.equal(briefing.kind, "first_lesson");
  assert.equal(briefing.memories.length, 0);
});

test("member isolation and current-session exclusion prevent cross-member or same-session leakage", () => {
  const m1Notes = [note("m1-s1", "2026-08-18", { nextFocus: [item("오른쪽 고관절 다시 확인")] })];
  const m2Notes = [note("m2-s1", "2026-08-18", { nextFocus: [item("왼쪽 견갑 다시 확인")] })];
  const m1 = member(m1Notes, { aiMemory: buildMemberMemory({ memberId: "m1", notes: m1Notes }).memories });
  const m2 = { ...member(m2Notes, { aiMemory: buildMemberMemory({ memberId: "m2", notes: m2Notes }).memories }), id: "m2", name: "민지" };
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
  const built = buildMemberMemory({ memberId: "m1", notes: [confirmed], now: "2026-08-24" });
  const jay = member([confirmed], { aiMemory: built.memories });
  const nextBriefing = createMemberBriefing({ member: jay, currentSessionId: "jay-next", now: "2026-08-24" });
  assert.match(nextBriefing.lines[0].text, /^08\.23 · 다음 확인: 오른쪽 고관절은 다음 시간에 다시 볼게요$/);
  assert.equal(nextBriefing.lines[0].sourceRefs[0].id, "jay-first");
  assert.ok(nextBriefing.memories.every((entry) => entry.memberId === "m1" && entry.sourceRefs.length > 0));
});

test("schedule memory date uses sourceRefs, then legacy lastSeenAt, and omits an unknown date", () => {
  const memory = (overrides = {}) => ({ id: "memory-1", type: "next_focus", text: "흉추 확인", status: "active", seenCount: 1, sourceRefs: [], lastSeenAt: "", ...overrides });
  const sourced = selectScheduleBriefing({ memories: [memory({ sourceRefs: [{ type: "session", id: "s1", date: "2026-09-03" }], lastSeenAt: "2026-09-02" })] });
  assert.deepEqual({ sourceDate: sourced.sourceDate, dateLabel: sourced.dateLabel }, { sourceDate: "2026-09-03", dateLabel: "9.3" });
  const legacy = selectScheduleBriefing({ memories: [memory({ lastSeenAt: "2026-08-20" })] });
  assert.deepEqual({ sourceDate: legacy.sourceDate, dateLabel: legacy.dateLabel }, { sourceDate: "2026-08-20", dateLabel: "8.20" });
  const unknown = selectScheduleBriefing({ memories: [memory()] });
  assert.equal(unknown, null);
});

test("draft persistence feeds a bounded dated briefing and confirmation replaces the same sources", () => {
  const fields = {
    didToday: [item("리포머 풋워크")],
    observations: [item("오른쪽 허리 불편감")],
    responses: [item("동작이 편하다고 말함")],
    nextFocus: [item("캐딜락에서 흉추 확인")],
  };
  const draft = draftNote("pilot-lesson", "2026-08-30", fields, "리포머 풋워크 후 허리가 불편했고 동작은 편하다고 했으며 다음에는 캐딜락에서 흉추 확인");
  const schedule = [{ id: "pilot-lesson", date: "2026-08-30", start: "10:00" }];
  const draftBuilt = buildMemberMemory({ memberId: "m1", notes: [draft], schedule, now: "2026-08-30" });
  assert.equal(draftBuilt.memories.length, 3);
  assert.ok(draftBuilt.memories.every((entry) => entry.sourceState === "draft" && entry.sourceRefs[0].sourceState === "draft"));

  const restartedMember = JSON.parse(JSON.stringify(member([draft], { aiMemory: draftBuilt.memories })));
  const draftBriefing = createMemberBriefing({ member: restartedMember, schedule });
  assert.equal(draftBriefing.lines.length, 4);
  assert.ok(draftBriefing.lines.every((entry) => /^08\.30 · /.test(entry.text) && entry.text.length <= 60 && entry.text.endsWith("· 확인 전")));
  assert.deepEqual(draftBriefing.lines.map((entry) => entry.kind), ["next_focus", "observation", "response", "last_lesson"]);

  const confirmed = note("pilot-lesson", "2026-08-30", fields);
  const confirmedBuilt = buildMemberMemory({ memberId: "m1", notes: [confirmed], existingMemory: draftBuilt.memories, schedule, now: "2026-08-30" });
  assert.equal(confirmedBuilt.memories.length, 3);
  assert.deepEqual(confirmedBuilt.memories.map((entry) => entry.id).sort(), draftBuilt.memories.map((entry) => entry.id).sort());
  assert.ok(confirmedBuilt.memories.every((entry) => entry.sourceState === "confirmed" && entry.sourceRefs.length === 1 && entry.sourceRefs[0].sourceState === "confirmed"));
  const confirmedBriefing = createMemberBriefing({ member: member([confirmed], { aiMemory: confirmedBuilt.memories }), schedule });
  assert.equal(confirmedBriefing.lines.length, 4);
  assert.equal(new Set(confirmedBriefing.lines.map((entry) => entry.text)).size, 4);
  assert.ok(confirmedBriefing.lines.every((entry) => !entry.text.includes("확인 전")));
});

test("raw drafts participate in the loop while empty drafts do not create a source session", () => {
  const raw = draftNote("raw-draft", "2026-08-31", {}, "브릿지를 진행했습니다");
  const empty = draftNote("empty-draft", "2026-08-31", {});
  assert.equal(memorySourceSessions([raw]).length, 1);
  assert.equal(memorySourceSessions([empty]).length, 0);
  const briefing = createMemberBriefing({ member: member([raw]) });
  assert.equal(briefing.lines[0].text, "08.31 · 지난 수업: 브릿지를 진행했습니다 · 확인 전");
  assert.equal(buildMemberMemory({ memberId: "m1", notes: [raw] }).memories.length, 0);
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
