/**
 * 센터에 못 간 쓰기를 사람 말로.
 *
 * ── 왜 필요한가 ──
 * 이중 쓰기는 기기에 먼저 저장하고 그다음 센터로 보낸다. 센터 쪽이 실패해도
 * 코디네이터가 그것을 잡아 성공으로 돌려주므로, **강사에게는 저장된 것으로
 * 보였다.** 실제로 그 상태로 지냈고, 규칙이 연락처를 잠근 날 그 침묵이
 * 드러났다.
 *
 * 두 가지가 서로 다른 일이다.
 *
 *   영구 오류   서버가 "이 쓰기는 안 된다" 고 답했다. 다시 눌러도 같은 답이라
 *               **그 자리에서 말해야 한다** -- 사람이 고쳐야 할 일이다.
 *   일시 오류   연결이 끊겼다. 다음에 그 회원을 저장하면 들어간다.
 *               재촉하지 않고 위에 숫자만 둔다.
 *
 * 한 문구로 뭉개면 강사는 둘 중 무엇인지 모르고, 모르면 아무것도 하지 않는다.
 */

/** 무엇을 저장하려던 것이었나. 화면이 "무엇이" 안 갔는지 말할 수 있어야 한다. */
export const WRITE_LABEL = Object.freeze({
  client: "회원 정보",
  lesson: "수업 일정",
});

const text = (value) => String(value ?? "").trim();

/**
 * 영구 오류일 때 강사에게 보여 줄 한 줄.
 *
 * 회원 이름을 반드시 넣는다. "저장되지 않았어요" 만으로는 무엇을 다시 봐야
 * 하는지 알 수 없고, 강사는 그날 열 명을 만진다.
 *
 * @param {{ entityType?: string, entityId?: string, errorCode?: string }} outcome
 * @param {(id: string) => string} nameOf
 */
export function refusedWriteMessage(outcome, nameOf = () => "") {
  const what = WRITE_LABEL[text(outcome?.entityType)] || "변경";
  const who = text(nameOf(text(outcome?.entityId)));
  const subject = who ? `${who} 회원의 ${what}` : what;
  // 코드 없는 "오류가 발생했습니다" 는 금지다.
  return `${subject}가 센터에 저장되지 않았어요 — 대표님께 알려주세요 (코드 ${text(outcome?.errorCode) || "unknown"})`;
}

/**
 * 위에 띄울 한 줄. 아직 안 간 것이 없으면 빈 문자열이다.
 *
 * 숫자만 말한다. "실패" 라고 쓰지 않는 이유는 실제로 실패가 아니기 때문이다 --
 * 기기에는 저장됐고, 다음에 그 회원을 저장하면 들어간다.
 *
 * @param {Array<any>} pending
 */
export function pendingWriteSummary(pending) {
  const count = Array.isArray(pending) ? pending.length : 0;
  return count > 0 ? `센터에 아직 안 간 변경 ${count}건` : "";
}

/**
 * 그 목록을 사람이 읽을 모양으로. 회원 이름과 무엇이었는지.
 *
 * @param {Array<any>} pending @param {(id: string) => string} nameOf
 */
export function pendingWriteRows(pending, nameOf = () => "") {
  return (Array.isArray(pending) ? pending : []).map((entry) => ({
    key: text(entry?.idempotencyKey),
    name: text(nameOf(text(entry?.entityId))) || text(entry?.entityId) || "회원",
    what: WRITE_LABEL[text(entry?.entityType)] || "변경",
    code: text(entry?.lastErrorCode) || "unknown",
  }));
}
