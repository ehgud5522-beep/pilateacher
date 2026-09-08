"use strict";

// TEMP: 진단용, 확인 후 제거 -- openai-provider 의 임시 진단과 함께 삭제한다.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const providerSource = () => fs.readFileSync(path.join(__dirname, "..", "src", "openai-provider.js"), "utf8");

/* 임시 진단이 남기는 값이 무엇인지 못으로 박아 둔다. 확인용으로 잠깐 켜 두는
   로그가 발화 내용을 흘리면 그건 잠깐으로 끝나지 않는다. */

const block = () => {
  const source = providerSource();
  const start = source.indexOf("const TEMP_SUGGESTION_FIELDS");
  return source.slice(start, source.indexOf("});", source.indexOf("emitDiagnostic(\"AUDIO_STRUCTURE_SUCCEEDED\"", start)) + 3);
};

test("only a count, schema field names and a boolean are logged", () => {
  const source = block();
  assert.match(source, /suggestionsCount: tempSuggestions\.length,/);
  assert.match(source, /suggestionFields: tempSuggestions/);
  assert.match(source, /didTodayEmpty: \(Array\.isArray\(structured\.output\?\.didToday\) \? structured\.output\.didToday\.length : 0\) === 0,/);
});

test("the field names are checked against the schema keys", () => {
  const source = block();
  /* Whatever the model returns, only these four strings can reach the log. */
  assert.match(source, /const TEMP_SUGGESTION_FIELDS = \["didToday", "observations", "responses", "nextFocus"\];/);
  assert.match(source, /\.filter\(\(field\) => TEMP_SUGGESTION_FIELDS\.includes\(field\)\)/);
});

test("every value survives safeLogToken unchanged", () => {
  /* The gateway's sanitiser replaces anything outside A-Za-z0-9._:/- so a
     Korean phrase would show up mangled rather than absent. These values pass
     through it byte for byte, which is what proves they carry no text. */
  const safeLogToken = (value, max = 120) => String(value || "").replace(/[^A-Za-z0-9._:/-]/g, "_").slice(0, max);
  for (const field of ["didToday", "observations", "responses", "nextFocus"]) {
    assert.equal(safeLogToken(field), field);
  }
  for (const value of [0, 1, 2, true, false]) {
    assert.equal(safeLogToken(String(value)), String(value));
  }
});

test("no length of any field is logged", () => {
  const source = block();
  /* didToday is a boolean, not a count: how many things were said is enough to
     start reconstructing what was said. suggestionsCount is the one number,
     and it is the question being asked. */
  assert.doesNotMatch(source, /didTodayCount|charCount|textLength|\.text\b/);
  assert.equal((source.match(/\.length/g) || []).length, 2, "only tempSuggestions.length and the didToday emptiness check");
});

test("no transcript or field content is reachable from the logged values", () => {
  const source = block();
  for (const key of ["transcript", "rawTranscript", "summary", "memberName"]) {
    assert.ok(!source.includes(key), `${key} must not appear in the diagnostic`);
  }
});

test("the temporary nature is written where it will be found", () => {
  const source = providerSource();
  assert.match(source, /\/\/ TEMP: 진단용, 확인 후 제거/);
  assert.ok((source.match(/TEMP: 진단용, 확인 후 제거/g) || []).length >= 2, "marked at the block and at the values");
});
