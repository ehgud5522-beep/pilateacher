import assert from "node:assert/strict";
import test from "node:test";
import {
  MEMBER_NOTE_ACTION, MEMBER_NOTE_CHOICE, MEMBER_NOTE_VIEW, memberNoteSaveAction, memberNoteView,
} from "../../src/features/members/member-note-choice.js";

/* 회원에게 보낼 말 — 선택형 (2026-11-07 대표). */

const view = (state) => memberNoteView({ loaded: true, readError: "", savedBody: "", choice: "", editing: false, ...state });

test("기본은 미선택 — 질문과 예 / 아니오만, 입력칸은 닫혀 있다", () => {
  assert.equal(view({}), MEMBER_NOTE_VIEW.ASK);
  assert.equal(view({ choice: MEMBER_NOTE_CHOICE.YES }), MEMBER_NOTE_VIEW.EDIT, "예를 누르면 입력칸이 열린다");
  assert.equal(view({ choice: MEMBER_NOTE_CHOICE.NO }), MEMBER_NOTE_VIEW.DECLINED, "아니오면 열리지 않는다");
});

test("저장된 말이 있으면 다시 들어올 때 작성 완료 — 미선택 · 아니오여도 그대로 남는다", () => {
  assert.equal(view({ savedBody: "브릿지 10회" }), MEMBER_NOTE_VIEW.SAVED);
  assert.equal(view({ savedBody: "브릿지 10회", choice: MEMBER_NOTE_CHOICE.NO }), MEMBER_NOTE_VIEW.SAVED);
  assert.equal(view({ savedBody: "브릿지 10회", editing: true }), MEMBER_NOTE_VIEW.EDIT, "[수정] 을 누르면 입력칸");
});

test("읽기 전 · 못 읽었을 때는 묻지 않는다 — 덮어쓰지 않게", () => {
  assert.equal(memberNoteView({ loaded: false }), MEMBER_NOTE_VIEW.LOADING);
  assert.equal(view({ readError: "불러오지 못했어요 (코드 unavailable)", choice: MEMBER_NOTE_CHOICE.YES }), MEMBER_NOTE_VIEW.ERROR);
});

test("저장 규칙 — 비어 있으면 보내지 않고, 같은 말은 다시 쓰지 않고, 지우는 것은 저장된 말을 비웠을 때뿐", () => {
  assert.equal(memberNoteSaveAction("", ""), MEMBER_NOTE_ACTION.NONE, "예를 골라도 비어 있으면 전송하지 않는다");
  assert.equal(memberNoteSaveAction("   ", ""), MEMBER_NOTE_ACTION.NONE);
  assert.equal(memberNoteSaveAction("잘했어요", ""), MEMBER_NOTE_ACTION.SAVE);
  assert.equal(memberNoteSaveAction("잘했어요 ", "잘했어요"), MEMBER_NOTE_ACTION.NONE, "같은 말은 다시 저장하지 않는다");
  assert.equal(memberNoteSaveAction("더 잘했어요", "잘했어요"), MEMBER_NOTE_ACTION.SAVE, "고쳐 저장 = 같은 문서를 덮어쓴다");
  assert.equal(memberNoteSaveAction("", "잘했어요"), MEMBER_NOTE_ACTION.DELETE, "직접 비우고 누를 때만 지운다");
});
