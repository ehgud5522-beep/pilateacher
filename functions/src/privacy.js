"use strict";

const DIRECT_IDENTIFIER_KEYS = new Set([
  "memberId", "lessonId", "assessmentId", "uid", "userId", "organizationId",
  "name", "memberName", "personName", "phone", "email", "photo", "image",
  "blob", "src", "token", "secret", "password", "apiKey", "authorization", "회원",
  "이름", "성명", "회원명", "강사명",
]);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?82[-. ]?)?0?1[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)/g;
const LABELED_KOREAN_NAME = /((?:회원|강사|선생님?|고객|이름)\s*[:：]?\s*)[가-힣]{2,4}(?=\s|님|$|[,.!?])/g;
const SECRET_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]+|\bsk-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi;

function escaped(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactText(value, memberName = "") {
  let text = String(value || "");
  const exactName = String(memberName || "").trim();
  if (exactName.length >= 2) text = text.replace(new RegExp(escaped(exactName), "g"), "[회원]");
  return text
    .replace(EMAIL_PATTERN, "[이메일]")
    .replace(PHONE_PATTERN, "[전화번호]")
    .replace(LABELED_KOREAN_NAME, "$1[이름]")
    .replace(SECRET_PATTERN, "[비밀정보]");
}

function stripIdentifiers(value, { memberName = "" } = {}, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === "string") return redactText(value, memberName);
  if (Array.isArray(value)) return value.map((item) => stripIdentifiers(item, { memberName }, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (DIRECT_IDENTIFIER_KEYS.has(key)) continue;
    output[key] = stripIdentifiers(item, { memberName }, depth + 1);
  }
  return output;
}

function prepareProviderInput(input, options = {}) {
  return stripIdentifiers(input, options);
}

module.exports = {
  DIRECT_IDENTIFIER_KEYS,
  prepareProviderInput,
  redactText,
};
