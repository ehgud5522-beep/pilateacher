/**
 * 회원 이름 수정 · 보관 (2026-11-04 대표).
 *
 * ── 왜 삭제가 아니라 보관인가 ──
 * 회원 문서를 지우면 그 회원에 매달린 것이 주인을 잃는다 -- 원장(append-only)의
 * 차감 줄, 급여의 회원별 보기, 강사 폰에만 있는 사진 · 기록, 회원 앱 연결,
 * 같은 번호로 다시 등록할 때의 문서 id(csv_{번호}). 규칙도 삭제를 막는다
 * (clients `allow delete: if false`).
 *
 * 보관은 **목록 · 검색 · 회원 선택에서만 뺀다.** 문서와 장부는 그대로이고,
 * 되살리면 전과 같다. 판정과 문구만 여기 둔다 -- 쓰기는 client-repository.js.
 *
 * ── 보관할 수 있는 회원 ──
 * 쓸 수 있는 회원권(isDeductablePass -- 차감 선택과 같은 판정)이 한 장도 없는
 * 회원만. 듀엣 회원권은 짝의 것이기도 하다 -- 짝이 쓰는 회원권에 이 회원이
 * 들어 있으면 보관하지 않는다(passBelongsTo 가 clientIds 를 본다). 보관한 회원이
 * 수업 등록 · 발급에서 사라지는데, 그 회원권이 아직 차감될 수 있으면 짝의
 * 수업이 끊긴다.
 */

import { isDeductablePass } from "../../data/repositories/pass-repository.js";
import { passBelongsTo } from "../../data/schema/pass-clients.js";

/** 이름 길이 상한. 규칙은 비어 있지 않은지만 본다 -- 화면이 더 좁힌다. */
export const CLIENT_NAME_MAX = 40;

export const CLIENT_EDIT_ERROR = Object.freeze({
  NAME_EMPTY: "name_empty",
  NAME_TOO_LONG: "name_too_long",
  NAME_UNCHANGED: "name_unchanged",
  ACTIVE_PASS: "active_pass",
  ALREADY_ARCHIVED: "already_archived",
  NOT_ARCHIVED: "not_archived",
});

const text = (value) => String(value ?? "").trim();

/** 보관된 회원인가. 필드 하나로만 판정한다 (archived === true). */
export const isArchivedClient = (client) => client?.archived === true;

/** 목록 · 검색 · 회원 선택에 쓸 회원. 보관된 회원을 뺀다. */
export const withoutArchived = (clients) => (Array.isArray(clients) ? clients : [])
  .filter((client) => client && !isArchivedClient(client));

/** 보관된 회원만. 회원 관리의 "보관된 회원" 묶음이 쓴다. */
export const onlyArchived = (clients) => (Array.isArray(clients) ? clients : [])
  .filter((client) => client && isArchivedClient(client));

/**
 * 새 이름을 검사한다. 앞뒤 공백은 떼고 저장한다.
 *
 * @param {unknown} name @param {{ current?: string }} [options]
 * @returns {{ ok: true, name: string } | { ok: false, code: string }}
 */
export function validateClientName(name, options = {}) {
  const next = text(name);
  if (!next) return { ok: false, code: CLIENT_EDIT_ERROR.NAME_EMPTY };
  if (next.length > CLIENT_NAME_MAX) return { ok: false, code: CLIENT_EDIT_ERROR.NAME_TOO_LONG };
  if (next === text(options.current)) return { ok: false, code: CLIENT_EDIT_ERROR.NAME_UNCHANGED };
  return { ok: true, name: next };
}

/**
 * 이 회원을 지금 보관할 수 없는 이유. 보관할 수 있으면 null.
 *
 * @param {{ id?: string, archived?: boolean }} client
 * @param {Array<any>} passes 이 회원의 회원권 (듀엣 포함 -- loadClientPassHistory 가 그렇게 준다)
 * @param {Date} [now]
 */
export function archiveBlock(client, passes, now = new Date()) {
  if (isArchivedClient(client)) return CLIENT_EDIT_ERROR.ALREADY_ARCHIVED;
  const clientId = text(client?.id);
  const usable = (Array.isArray(passes) ? passes : [])
    .some((pass) => passBelongsTo(pass, clientId) && isDeductablePass(pass, now));
  return usable ? CLIENT_EDIT_ERROR.ACTIVE_PASS : null;
}

/**
 * 코드 → 문구. 코드는 언제나 함께 보여준다 (CLAUDE.md §4).
 *
 * @param {{ code?: string } | null | undefined} error
 */
export function clientEditMessage(error) {
  const code = text(error?.code) || "unknown";
  const known = {
    [CLIENT_EDIT_ERROR.NAME_EMPTY]: "이름을 입력해 주세요.",
    [CLIENT_EDIT_ERROR.NAME_TOO_LONG]: `이름은 ${CLIENT_NAME_MAX}자까지예요.`,
    [CLIENT_EDIT_ERROR.NAME_UNCHANGED]: "지금 이름과 같아요.",
    [CLIENT_EDIT_ERROR.ACTIVE_PASS]: "쓸 수 있는 회원권이 남아 있어 보관할 수 없어요. 듀엣 회원권이면 짝의 회원권도 봅니다.",
    [CLIENT_EDIT_ERROR.ALREADY_ARCHIVED]: "이미 보관된 회원이에요.",
    [CLIENT_EDIT_ERROR.NOT_ARCHIVED]: "보관된 회원이 아니에요.",
  };
  if (known[code]) return `${known[code]} (코드 ${code})`;
  if (code === "permission-denied") return `이 회원을 고칠 권한이 없어요. (코드 ${code})`;
  if (["unavailable", "deadline-exceeded", "aborted"].includes(code)) {
    return `연결이 불안정해 저장하지 못했어요. 다시 시도해 주세요. (코드 ${code})`;
  }
  return `저장하지 못했어요. (코드 ${code})`;
}
