/**
 * 회원 단위 "수업기록 서버 보관 · AI 처리" 동의 (설계 문서 결정 4, 2026-11-16 대표 승인).
 *
 * 지금까지 AI 동의는 강사 계정마다 따로(users/{강사}/aiConsents/{기기 회원}) 저장돼, 대타 강사 · 서버 작업은
 * 그 회원이 동의했는지 알 수 없었다. 서버 저장(1단계) · AI 요약(2단계)은 회원 단위 동의 하나를 본다:
 * organizations/{센터}/clients/{회원}.aiConsent = { status, version, grantedAt, grantedBy, method }.
 *
 * 이 문구는 **초안**이다 -- 법률 검토를 거친 뒤 버전을 올린다(docs/member-data-consent-draft.md). 버전이 바뀌면
 * 이전 동의는 효력이 없다(서버 · 앱 모두 version 을 맞춰 본다) -- 다시 받는다.
 */

import { MEMBER_AI_CONSENT_VERSION, memberAiConsentGranted } from "../../../functions/shared/member-summary.mjs";

export { MEMBER_AI_CONSENT_VERSION };

/** 명부 회원(orgAiConsent) 또는 센터 회원 문서(aiConsent) 어느 쪽이든. */
export const memberDataConsentGranted = (member) => memberAiConsentGranted({ aiConsent: member?.aiConsent || member?.orgAiConsent || null });

export const MEMBER_DATA_CONSENT_TITLE = "수업기록 서버 보관 · AI 처리 동의";

/* 강사가 회원에게 보여 주고 읽어 주는 문구. 항목은 개인정보 보호법이 동의 때 알리라고 정한 것(목적 · 항목 ·
   보유 기간 · 거부 권리)과 민감정보 · 국외 이전 항목을 따른다. */
export const MEMBER_DATA_CONSENT_SECTIONS = Object.freeze([
  {
    heading: "무엇을 저장하나요",
    body: "강사가 수업 뒤 확정한 수업기록(한 운동 · 관찰 · 회원 반응 · 다음에 확인할 것)과 수업 날짜, 강사가 적은 운동 목표 · 통증 · 주의사항. 통증 · 불편감 같은 몸 상태 내용이 들어갈 수 있어 건강 관련 정보(민감정보)로 다룹니다. 사진 · 녹음 파일 · 연락처는 저장하지 않습니다.",
  },
  {
    heading: "왜 저장하나요",
    body: "담당 강사가 바뀌거나 대신 수업할 때, 새 기기에서도 지난 수업을 이어 보기 위해서입니다. 그리고 다음 수업 전에 읽을 요약(꼭 기억할 것 · 최근 흐름 · 계속 확인 중)을 만들기 위해서입니다.",
  },
  {
    heading: "누가 보나요",
    body: "센터 대표 · 총괄매니저, 회원님의 담당 강사, 그 기록을 쓴 강사만 봅니다.",
  },
  {
    heading: "AI 처리와 국외 이전",
    body: "요약은 OpenAI(미국)의 AI 가 만듭니다. 보내는 것은 최근 수업기록 내용과 날짜뿐이고 이름 · 연락처는 보내지 않습니다. 보낸 내용은 요약을 만든 뒤 OpenAI 에 저장하지 않도록 요청합니다. 요약은 강사가 참고하는 초안이며 진단이나 처방이 아닙니다.",
  },
  {
    heading: "얼마나 보관하나요",
    body: "센터 회원으로 있는 동안 보관하고, 회원 탈퇴를 요청하시면 지웁니다.",
  },
  {
    heading: "동의하지 않으셔도 됩니다",
    body: "동의하지 않으셔도 수업은 그대로 받으실 수 있습니다. 기록은 강사 기기에만 남고 서버 보관 · AI 요약만 쓰지 않습니다. 언제든 철회하실 수 있고, 철회하면 그 뒤 기록은 서버로 보내지 않습니다.",
  },
]);

export const MEMBER_DATA_CONSENT_CONFIRM = "회원님께 위 내용을 안내하고 동의를 받았습니다.";

/** 화면 상태 한 줄. */
export function memberDataConsentState(member) {
  const consent = member?.aiConsent || member?.orgAiConsent || null;
  if (memberDataConsentGranted(member)) return { key: "granted", label: "동의함" };
  if (consent?.status === "revoked") return { key: "revoked", label: "철회함" };
  if (consent?.status === "granted") return { key: "outdated", label: "다시 받아야 함 (문구가 바뀜)" };
  return { key: "missing", label: "동의 없음" };
}
