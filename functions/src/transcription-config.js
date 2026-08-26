"use strict";

const PILATES_TRANSCRIPTION_TERMS = Object.freeze([
  "리포머", "캐딜락", "체어", "바렐", "스프링", "풋워크", "헌드레드", "롤업", "롤다운",
  "브릿지", "플랭크", "사이드 라잉", "티저", "스완", "견갑", "흉추", "요추", "골반", "코어",
  "복부", "햄스트링", "둔근", "가동범위", "정렬", "호흡", "통증", "재등록", "노쇼",
]);

function buildTranscriptionPrompt(memberName = "") {
  const name = String(memberName || "").trim().slice(0, 160);
  return [
    `필라테스 수업 직후 강사의 짧은 한국어 기록입니다. ${PILATES_TRANSCRIPTION_TERMS.join("·")} 같은 용어가 나올 수 있습니다.`,
    name ? `회원 이름은 ${name}일 수 있습니다.` : "",
    "실제로 들리는 말만 원문 의미 그대로 전사하고, 들리지 않는 내용은 만들지 마세요.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PILATES_TRANSCRIPTION_TERMS,
  buildTranscriptionPrompt,
};
