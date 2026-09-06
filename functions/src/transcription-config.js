"use strict";

const PILATES_TRANSCRIPTION_TERMS = Object.freeze([
  "운동", "리포머", "캐딜락", "체어", "바렐", "바디포머", "스파인 코렉터", "스프링", "풋워크", "헌드레드", "롤업", "롤다운",
  "브릿지", "플랭크", "사이드 라잉", "티저", "스완", "견갑", "흉추", "요추", "골반", "코어",
  "복부", "햄스트링", "둔근", "가동범위", "정렬", "호흡", "통증", "재등록", "노쇼",
  "경추", "고관절", "지난주", "낮췄다", "올렸다",
]);

function buildTranscriptionPrompt(memberName = "") {
  const name = String(memberName || "").trim().slice(0, 160);
  return [
    `필라테스 수업 직후 강사의 짧은 한국어 기록입니다. ${PILATES_TRANSCRIPTION_TERMS.join("·")} 같은 용어가 나올 수 있습니다.`,
    "리포머·캐딜락·체어·바렐·바디포머·스파인 코렉터는 필라테스 기구명입니다. 문맥과 발음이 명확할 때만 해당 표준 명칭으로 전사하세요.",
    "게릴락·캐딜라처럼 들리는 불완전한 발음도 문맥상 캐딜락이 명확할 때만 캐딜락으로 적고, 확실하지 않으면 들리는 표현을 유지하세요.",
    "운동은 필라테스 기록에서 자주 쓰입니다. 음봉·응동·은근처럼 들려도 문장 문맥과 조사가 운동을 명확히 뜻할 때만 운동으로 적고, 은근 등 실제 일반어일 가능성이 있으면 들리는 표현을 유지하세요.",
    "특히 흉추·요추·경추·견갑·고관절, 지난주, 강도를 낮췄다·올렸다 같은 표현을 들리는 그대로 구분합니다.",
    name ? `회원 이름은 ${name}일 수 있습니다.` : "",
    "실제로 들리는 말만 원문 의미 그대로 전사하고, 들리지 않는 내용은 만들지 마세요.",
  ].filter(Boolean).join("\n");
}

const EXERCISE_MISHEARING_CODES = Object.freeze({
  "음봉": "stt_corrected_eumbong_to_exercise",
  "응동": "stt_corrected_eungdong_to_exercise",
});

function correctPilatesTranscription(value) {
  let transcript = String(value || "").trim();
  const corrections = [];
  for (const [heard, code] of Object.entries(EXERCISE_MISHEARING_CODES)) {
    const matcher = new RegExp(heard, "gu");
    transcript = transcript.replace(matcher, (match, offset, fullText) => {
      const before = fullText.slice(Math.max(0, offset - 24), offset);
      const after = fullText.slice(offset + match.length, offset + match.length + 32);
      const lessonAction = /^\s*(?:을|를|은|는|이|가)?\s*(?:했|해|할|합니다|진행|예정|좋|편|힘들|쉬웠|마쳤)/u.test(after);
      const nextEquipment = /(?:^|[\s,.!?])다음\s*$/u.test(before)
        && /^\s*(?:은|는|을|를)?\s*(?:리포머|캐딜락|체어|바렐|바디포머|스파인\s*코렉터|으로|로|에서)/u.test(after);
      if (!lessonAction && !nextEquipment) return match;
      corrections.push(code);
      return "운동";
    });
  }
  return Object.freeze({ transcript, corrections: Object.freeze([...new Set(corrections)]) });
}

module.exports = {
  PILATES_TRANSCRIPTION_TERMS,
  buildTranscriptionPrompt,
  correctPilatesTranscription,
};
