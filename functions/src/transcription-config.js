"use strict";

const PILATES_TRANSCRIPTION_TERMS = Object.freeze([
  "리포머", "캐딜락", "체어", "바렐", "스프링", "풋워크", "헌드레드", "롤업", "롤다운",
  "브릿지", "플랭크", "사이드 라잉", "티저", "스완", "견갑", "흉추", "요추", "골반", "코어",
  "복부", "햄스트링", "둔근", "가동범위", "정렬", "호흡", "통증", "재등록", "노쇼",
]);

function buildTranscriptionPrompt(memberName = "") {
  const name = String(memberName || "").trim().slice(0, 160);
  return [
    "한국어 필라테스 수업 기록입니다. 들리는 말을 원문 의미 그대로 전사하세요.",
    `필라테스 용어 참고: ${PILATES_TRANSCRIPTION_TERMS.join(", ")}`,
    name ? `회원 이름 참고: ${name}` : "",
    "추측하거나 내용을 보충하지 마세요.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PILATES_TRANSCRIPTION_TERMS,
  buildTranscriptionPrompt,
};
