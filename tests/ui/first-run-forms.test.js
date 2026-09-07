import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LESSON_TYPES, lessonTypeDef } from "../../src/features/schedule/lesson-types.js";

const appSource = () => readFile(new URL("../../src/App.jsx", import.meta.url), "utf8");

const registerSheet = (source) => {
  const start = source.indexOf("function MemberRegisterSheet(");
  return source.slice(start, source.indexOf("\nfunction ", start + 50));
};

/* ------------------------- 1. registration form ------------------------- */

test("only the name and the lesson type meet a first-time user", async () => {
  const sheet = registerSheet(await appSource());
  const visible = sheet.slice(0, sheet.indexOf("{moreOpen && <>"));
  assert.match(visible, /<Field label="회원 이름">/);
  assert.match(visible, /<Field label="수업 유형">/);
  // Everything else has to sit behind the disclosure.
  for (const label of ["연락처", "생년월일", "기본 수업시간", "목표", "주의사항", "이용권", "총 횟수", "시작일", "만료일", "상담 메모"]) {
    assert.doesNotMatch(visible, new RegExp(`<Field label="${label}"`), `${label} must be collapsed`);
  }
});

test("the disclosure starts closed and keeps every field", async () => {
  const sheet = registerSheet(await appSource());
  assert.match(sheet, /const \[moreOpen, setMoreOpen\] = useState\(false\)/, "collapsed by default");
  assert.match(sheet, /더 입력하기/);
  // No field was deleted: the form still carries all twelve.
  assert.equal((sheet.match(/<Field label=/g) || []).length, 12);
  for (const label of ["회원 이름", "연락처", "생년월일", "수업 유형", "기본 수업시간", "목표", "주의사항", "이용권", "총 횟수", "시작일", "만료일", "상담 메모"]) {
    assert.match(sheet, new RegExp(`<Field label="${label}"`), `${label} must still exist`);
  }
});

test("a name alone enables the submit button", async () => {
  const sheet = registerSheet(await appSource());
  /* The submit guard also requires a session count, and its default of "10"
     survives while the section is collapsed, so a name is enough. */
  assert.match(sheet, /regular: "10"/);
  assert.match(sheet, /disabled=\{!f\.name\.trim\(\) \|\| !num\(f\.regular\)\}/);
});

test("the saved payload and its defaults are untouched", async () => {
  const sheet = registerSheet(await appSource());
  // Same keys, same defaults, same shape as before the form was folded.
  for (const key of ["name", "phone", "birth", "lessonType", "defaultLessonDuration", "goal", "focus", "passName", "regular", "total", "startDate", "contractEnd", "notes"]) {
    assert.match(sheet, new RegExp(`${key}:`), `${key} must still be saved`);
  }
  assert.match(sheet, /defaultLessonDuration: Number\(f\.defaultLessonDuration\) \|\| DEFAULT_CLASS_DURATION/);
});

/* ---------------------- 3. lesson type on the card ---------------------- */

test("the schedule card spells the lesson type out", async () => {
  const source = await appSource();
  assert.doesNotMatch(source, /\{b\.typeShort\}/, "the one-character abbreviation is gone from the card");
  // The rendered text, not the aria-label that also interpolates the label.
  assert.equal((source.match(/>\{b\.typeLabel\}<\/span>/g) || []).length, 2, "both the one-line and two-line cards");

  // Duet and group must read as words too, not just private.
  for (const key of ["private", "duet", "group"]) {
    const def = lessonTypeDef(key);
    assert.equal(def.label.length, 2, `${key} label should be the full two-character word`);
  }
  assert.deepEqual(LESSON_TYPES.filter((t) => ["private", "duet", "group"].includes(t.key)).map((t) => t.label), ["개인", "듀엣", "그룹"]);
});

/* ------------------- 4. entering capture from the detail ---------------- */

test("opening from the member detail lands on the purpose step", async () => {
  const source = await appSource();
  assert.match(source, /initialMode === "new" \? "purpose"/, "no intermediate screen");
  // The 변화 기록 tab keeps its own entry.
  assert.match(source, /: "home"\);/);
  assert.match(source, /onAssess\?\.\(\{ mode: "new" \}\)/);
});

/* ----------------------------- 5. wording ------------------------------- */

test("the capture flow no longer says 비포 or 에프터", async () => {
  const source = await appSource();
  const start = source.indexOf("function AssessmentWorkspace(");
  const workspace = source.slice(start, source.indexOf("\nfunction ", start + 50));

  assert.match(source, /nextCaptureLabel = completeSets\.length \? "다음 촬영 시작" : "첫 촬영 시작"/);
  assert.match(workspace, /"첫 촬영 저장 완료 · 다음 촬영이 필요합니다"/);
  assert.doesNotMatch(workspace, /비포 저장 완료/);

  // The role label is one phrase now, and the header no longer appends 촬영.
  assert.equal((source.match(/role === "before" \? "첫 촬영" : role === "after" \? "다음 촬영"/g) || []).length, 2);
  assert.match(source, /\{member\?\.name \|\| "회원"\} · \{roleLabel \|\| "미분류"\}<\/span>/);
});

test("the internal role keys are untouched", async () => {
  const source = await appSource();
  // Only the words changed; before/after remain the stored values.
  assert.match(source, /value: "before"/);
  assert.match(source, /value: "after"/);
  assert.match(source, /pendingRole === "before"/);
  assert.match(source, /completeSets\.length \? "after" : "before"/);
});

/* ------------------- 6. "촬영 전" is not a done state -------------------- */

test("nothing captured yet reads as neutral, not complete", async () => {
  const source = await appSource();
  const start = source.indexOf("function AssessmentWorkspace(");
  const workspace = source.slice(start, source.indexOf("\nfunction ", start + 50));

  // The green tick and green ground are conditional on a real save.
  assert.match(workspace, /backgroundColor: lastCompleted \? GOOD_S : CANVAS/);
  assert.match(workspace, /lastCompleted \? <Check size=\{15\} style=\{\{ color: GOOD \}\} \/> : <Camera size=\{15\} style=\{\{ color: SUB \}\} \/>/);
  assert.match(workspace, /color: lastCompleted \? GOOD : INK2/);
  assert.match(workspace, /"아직 촬영한 기록이 없습니다"/);
  // A completed save keeps its green.
  assert.match(workspace, /"최근 변화 기록 저장 완료"/);
});
