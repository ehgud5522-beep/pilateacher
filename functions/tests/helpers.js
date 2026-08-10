"use strict";

function createRequest(overrides = {}) {
  const headers = Object.fromEntries(Object.entries(overrides.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    method: "POST",
    body: {
      lessonId: "lesson-1",
      memberId: "member-1",
      transcript: "호흡과 중립 골반을 연습했고 불편감은 없었다.",
      idempotencyKey: "idem-voice-0001",
    },
    headers: { authorization: "Bearer valid-token", ...headers },
    get(name) {
      return this.headers[String(name).toLowerCase()] || "";
    },
    ...overrides,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

const validResult = Object.freeze({
  todayExercises: ["호흡", "브리지"],
  memberCondition: "불편감 없음",
  painOrDiscomfort: "",
  improvements: "골반 중립 유지가 안정적이었음",
  nextGoal: "호흡과 동작 연결",
  homework: "호흡 연습",
  cautions: "",
});

module.exports = {
  createRequest,
  createResponse,
  validResult,
};
