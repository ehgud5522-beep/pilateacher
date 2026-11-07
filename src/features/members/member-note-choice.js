/**
 * "회원에게 보낼 말" 을 선택형으로 (2026-11-07 대표). **순수 함수만.**
 *
 * 기본 화면은 "이번 수업에 회원에게 피드백을 보내시겠어요?" 와 [예] [아니오] 뿐이다.
 * - 아무것도 고르지 않으면 "아니오" 와 같다 -- 아무것도 쓰지 않는다 (수업기록 저장과 무관)
 * - [예] 를 눌러야 입력칸이 열린다. 비어 있으면 보내지 않는다
 * - 이미 저장한 말이 있으면 다시 열 때 "작성 완료" 로 보여 주고 [수정] 만 둔다.
 *   미선택 · 아니오 때문에 저장된 말이 지워지는 일은 없다. 지우는 것은 강사가 입력칸을
 *   비우고 [삭제] 를 눌렀을 때뿐이다
 * - 못 읽었으면 묻지 않는다 -- 빈 줄로 알고 [예] → 저장하면 먼젓번 말을 덮는다
 *
 * 강사 내부 수업기록(수업일지)은 이 선택과 상관없이 따로 저장된다.
 */

const text = (value) => String(value ?? "").trim();

export const MEMBER_NOTE_CHOICE = Object.freeze({ NONE: "", YES: "yes", NO: "no" });

export const MEMBER_NOTE_VIEW = Object.freeze({
  LOADING: "loading",
  ERROR: "error",
  /** 저장된 말이 있다 -- 작성 완료 + [수정] */
  SAVED: "saved",
  /** 저장된 말이 없고 아직 고르지 않았다 -- 질문 + [예] [아니오] */
  ASK: "ask",
  /** [아니오] -- 보내지 않음 (바꿀 수 있다) */
  DECLINED: "declined",
  /** 입력칸이 열려 있다 ([예] 또는 [수정]) */
  EDIT: "edit",
});

/**
 * 지금 그릴 모양.
 * @param {{ loaded: boolean, readError?: string, savedBody?: string, choice?: string, editing?: boolean }} state
 */
export function memberNoteView(state) {
  if (!state?.loaded) return MEMBER_NOTE_VIEW.LOADING;
  if (text(state?.readError)) return MEMBER_NOTE_VIEW.ERROR;
  if (state?.editing) return MEMBER_NOTE_VIEW.EDIT;
  if (text(state?.savedBody)) return MEMBER_NOTE_VIEW.SAVED;
  if (state?.choice === MEMBER_NOTE_CHOICE.YES) return MEMBER_NOTE_VIEW.EDIT;
  if (state?.choice === MEMBER_NOTE_CHOICE.NO) return MEMBER_NOTE_VIEW.DECLINED;
  return MEMBER_NOTE_VIEW.ASK;
}

export const MEMBER_NOTE_ACTION = Object.freeze({ NONE: "none", SAVE: "save", DELETE: "delete" });

/**
 * [저장] 이 무엇을 할 것인가. 같은 말을 다시 저장하지 않는다(한 수업 · 한 회원에 문서
 * 하나라 덮어쓸 뿐이지만, 회원 데이터를 쓸데없이 다시 만들지 않게). 저장된 말이 없는데
 * 비어 있으면 보내지 않는다. 저장된 말이 있는데 비우면 그때만 지운다.
 */
export function memberNoteSaveAction(body, savedBody) {
  const next = text(body);
  const before = text(savedBody);
  if (next === before) return MEMBER_NOTE_ACTION.NONE;
  if (!next) return before ? MEMBER_NOTE_ACTION.DELETE : MEMBER_NOTE_ACTION.NONE;
  return MEMBER_NOTE_ACTION.SAVE;
}
