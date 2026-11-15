/**
 * 2026-11-15 강사 제보: "AI 음성기록 이후 수정하려 하면 다 없어지거나 에러가 뜬다."
 *
 * ① 강사가 고치는 글에 AI 출력 검사(연결어미 금지)가 걸려 자동저장이 예외를 던졌다 →
 *    화면 전체가 꺼짐. 기록 저장은 문장 검사 없이 모양만 맞춘다.
 * ② 저장된 음성 기록을 다시 열면 빈 녹음 화면 → 저장된 기록을 펼친다.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createLessonRecordMeta, editStructuredField, normalizeEditedStructuredDraft, validateStructuredOutput,
} from "../../src/features/lesson-record/record-schema.js";
import { voiceNoteFor, voiceNoteRestoreState } from "../../src/features/lesson-record/note-edit.js";

const aiDraft = () => validateStructuredOutput({
  didToday: ["브릿지 10회 진행"],
  observations: ["골반 정렬이 좋아짐"],
  responses: [],
  nextFocus: ["햄스트링 스트레칭"],
  uncertain: [],
  summary: "브릿지로 골반 정렬을 확인함",
});

test("한글을 치는 도중의 '~하고' 줄에서 기록 저장이 예외를 던지지 않는다", () => {
  for (const typing of ["브릿지 하고", "골반 잡으면서", "천천히 내려오며", ""]) {
    const draft = editStructuredField(aiDraft(), "didToday", typing);
    assert.doesNotThrow(() => createLessonRecordMeta({ rawTranscript: "오늘은 브릿지", structuredDraft: draft, status: "structured" }), typing || "빈 칸");
    const meta = createLessonRecordMeta({ rawTranscript: "오늘은 브릿지", structuredDraft: draft, status: "structured" });
    if (typing) assert.equal(meta.structuredDraft.didToday[0].text, typing, "강사가 친 글이 그대로 남는다");
    else assert.deepEqual(meta.structuredDraft.didToday, []);
  }
});

test("AI 출력을 받는 문은 여전히 엄격하다", () => {
  assert.throws(() => validateStructuredOutput({ didToday: ["브릿지 하고"] }), (error) => error.code === "invalid_output");
});

test("칸을 다 비우면 AI 요약을 버린다 -- 칸과 어긋난 요약을 남기지 않는다", () => {
  let draft = aiDraft();
  for (const field of ["didToday", "observations", "nextFocus"]) draft = editStructuredField(draft, field, "");
  assert.equal(normalizeEditedStructuredDraft(draft).summary, null);
  assert.equal(normalizeEditedStructuredDraft(aiDraft()).summary, "브릿지로 골반 정렬을 확인함", "칸이 있으면 요약 유지");
});

test("강사가 고친 줄은 instructor, AI 가 쓴 줄은 ai 출처를 지킨다", () => {
  const draft = editStructuredField(aiDraft(), "nextFocus", "어깨 긴장 확인하고");
  const normalized = normalizeEditedStructuredDraft(draft);
  assert.equal(normalized.didToday[0].origin, "ai");
  assert.equal(normalized.nextFocus[0].origin, "instructor");
});

test("모양이 아닌 값은 null", () => {
  assert.equal(normalizeEditedStructuredDraft(null), null);
  assert.equal(normalizeEditedStructuredDraft([]), null);
});

const savedVoice = (overrides = {}) => ({
  id: "v1", sid: "L1", body: "오늘 수업: 브릿지", transcript: "오늘은 브릿지 했어요", voiceSource: "native",
  aiSummary: aiDraft(),
  aiSummaryTeacherEdited: editStructuredField(aiDraft(), "responses", "재밌어함"),
  lessonRecord: { stage: "confirmed_record", status: "confirmed", confirmationStatus: "confirmed" },
  ...overrides,
});

test("저장된 음성 기록을 다시 열면 강사가 고친 내용으로 펼친다", () => {
  const state = voiceNoteRestoreState(savedVoice());
  assert.equal(state.transcript, "오늘은 브릿지 했어요");
  assert.equal(state.structuredDraft.responses[0].text, "재밌어함", "강사가 고친 판");
  assert.equal(state.summaryOriginal.responses.length, 0, "AI 원본은 따로");
  assert.equal(state.confirmed, true);
  assert.equal(state.source, "native");
});

test("고친 판이 없으면 lessonRecord 의 초안 · 확정본으로", () => {
  const state = voiceNoteRestoreState(savedVoice({
    aiSummary: null, aiSummaryTeacherEdited: null,
    lessonRecord: { stage: "confirmed_record", confirmationStatus: "confirmed", rawTranscript: "x", confirmedRecord: aiDraft() },
  }));
  assert.equal(state.structuredDraft.didToday[0].text, "브릿지 10회 진행");
});

test("직접 입력 · 전사 없는 기록은 펼치지 않는다", () => {
  assert.equal(voiceNoteRestoreState({ id: "m1", sid: "L1", body: "손으로 쓴 글" }), null);
  assert.equal(voiceNoteRestoreState(savedVoice({ transcript: "", lessonRecord: { stage: "confirmed_record" } })), null);
  assert.equal(voiceNoteRestoreState(null), null);
});

test("AI 정리가 끝났을 때 고를 기록은 같은 수업의 음성 기록이다 -- 직접 쓴 일지를 집지 않는다", () => {
  const manual = { id: "m1", sid: "L1", body: "손으로 쓴 일지", lessonRecord: { status: "confirmed_manual" } };
  assert.equal(voiceNoteFor([manual], "L1"), null, "음성 기록이 없으면 새로 만든다");
  assert.equal(voiceNoteFor([manual, savedVoice()], "L1").id, "v1");
});
