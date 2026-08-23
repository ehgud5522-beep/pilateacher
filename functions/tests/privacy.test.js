"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { prepareProviderInput, redactText } = require("../src/privacy");

test("provider input strips authority ids and direct identifiers recursively", () => {
  const input = {
    memberId: "member-1",
    lessonId: "lesson-1",
    name: "김지민",
    nested: { assessmentId: "a-1", phone: "010-1234-5678", safe: "관찰" },
  };
  assert.deepEqual(prepareProviderInput(input, { memberName: "김지민" }), { nested: { safe: "관찰" } });
});

test("free text redacts exact member names, labelled names, contacts and secrets", () => {
  const value = redactText("회원 김지민님, 강사: 박민수 연락 010-1234-5678 test@example.com Bearer abcdefghijk", "김지민");
  for (const secret of ["김지민", "박민수", "010-1234-5678", "test@example.com", "abcdefghijk"]) {
    assert.equal(value.includes(secret), false);
  }
  assert.match(value, /\[회원\]/);
});
