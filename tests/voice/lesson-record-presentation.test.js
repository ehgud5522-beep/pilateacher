import assert from "node:assert/strict";
import test from "node:test";
import {
  lessonRecordPresentation, markLessonRecordGuideUsed, shouldShowLessonRecordGuide,
} from "../../src/features/lesson-record/lesson-record-presentation.js";

test("presentation shows the model summary without assembling a local narrative", () => {
  const view = lessonRecordPresentation({
    didToday: [{ text: "흉추 회전 운동" }],
    observations: [{ text: "오른쪽 어깨 가동범위 개선" }],
    responses: [{ text: "이전보다 움직임이 부드러움" }],
    nextFocus: [],
    uncertain: [],
    summary: "오른쪽 어깨 가동범위가 좋아졌고 흉추 회전 운동을 진행했습니다.",
  });
  assert.deepEqual(view.cards.map((item) => item.label), ["변화", "오늘 수업", "회원 반응", "다음 확인"]);
  assert.equal(view.cards[3].value, "아직 계획 없음");
  assert.equal(view.narrative, "오른쪽 어깨 가동범위가 좋아졌고 흉추 회전 운동을 진행했습니다.");
  assert.equal(view.narrativeLabel, "수업 기록");
});

test("missing model summary hides the narrative while raw fallback stays a teacher record", () => {
  const withoutSummary = lessonRecordPresentation({ didToday: [{ text: "브릿지" }], summary: null });
  assert.equal(withoutSummary.cards[1].value, "브릿지");
  assert.equal(withoutSummary.narrative, "");

  const raw = lessonRecordPresentation({
    provenanceSource: "fallback_raw",
    rawTranscript: "오늘은 평소대로 진행했습니다.",
  });
  assert.equal(raw.narrative, "오늘은 평소대로 진행했습니다.");
  assert.equal(raw.narrativeLabel, "선생님 기록");
});

test("presentation never emits the removed local sentence templates", () => {
  const forbidden = /회원의 변화는|오늘 수업에서는|진행했습니다\s*:|(?:습니다|입니다){2,}/u;
  const cases = [
    {},
    { didToday: [{ text: "브릿지" }] },
    { observations: [{ text: "오른쪽 허리 좋아짐" }], responses: [{ text: "운동 중 힘들어함" }] },
    { summary: "브릿지를 진행했습니다." },
  ];
  cases.forEach((draft) => assert.doesNotMatch(JSON.stringify(lessonRecordPresentation(draft)), forbidden));
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
