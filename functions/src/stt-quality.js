"use strict";

const STT_HALLUCINATION_PATTERNS = Object.freeze([
  "구독과 좋아요",
  "좋아요 부탁",
  "시청해주셔서",
  "영상이 도움이",
  "다음 영상",
  "알림 설정",
  "구독 부탁",
]);

function filterSttHallucinations(transcript) {
  const input = String(transcript || "").trim();
  if (!input) return { transcript: "", removedCount: 0, removedAll: false };
  const parts = input.match(/[^.!?。！？]+[.!?。！？]?/gu) || [];
  const retained = parts.filter((sentence) => !STT_HALLUCINATION_PATTERNS.some((phrase) => sentence.includes(phrase)));
  const removedCount = parts.length - retained.length;
  const filtered = retained.join(" ").replace(/\s+/g, " ").trim();
  return { transcript: filtered, removedCount, removedAll: removedCount > 0 && !filtered };
}

module.exports = { STT_HALLUCINATION_PATTERNS, filterSttHallucinations };
