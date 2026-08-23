import assert from "node:assert/strict";
import test from "node:test";
import {
  lessonRecordPresentation, markLessonRecordGuideUsed, shouldShowLessonRecordGuide,
} from "../../src/features/lesson-record/lesson-record-presentation.js";

test("presentation maps the existing contract to four teacher-facing cards without inventing values", () => {
  const view = lessonRecordPresentation({
    didToday: [{ text: "흉추 회전 운동" }],
    observations: [{ text: "오른쪽 어깨 가동범위 개선" }],
    responses: [{ text: "이전보다 움직임이 부드러움" }],
    nextFocus: [],
    uncertain: [],
  });
  assert.deepEqual(view.cards.map((item) => item.label), ["변화", "오늘 수업", "회원 반응", "다음 확인"]);
  assert.equal(view.cards[3].value, "아직 계획 없음");
  assert.equal(view.narrative.includes("견갑"), false, "presentation must not invent a missing next plan");
  assert.equal(view.narrative.includes("흉추 회전 운동"), true);
});

test("first-use guide is shown for three saved records only", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  assert.equal(shouldShowLessonRecordGuide(storage), true);
  markLessonRecordGuideUsed(storage); markLessonRecordGuideUsed(storage);
  assert.equal(shouldShowLessonRecordGuide(storage), true);
  markLessonRecordGuideUsed(storage);
  assert.equal(shouldShowLessonRecordGuide(storage), false);
});
