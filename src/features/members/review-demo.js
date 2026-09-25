/**
 * 심사용 회원 — 스토어 심사관이 로그인해서 볼 회원.
 *
 * ── 왜 필요한가 ──
 * 회원 앱은 문자 인증으로 들어간다. 심사관에게는 실제 회원의 번호를 줄 수
 * 없으므로 Firebase Auth 의 테스트 전화번호를 하나 등록하고, 그 번호로 명부에
 * 회원 하나를 만든다. 그 회원은 사람이 아니다.
 *
 * ── 왜 지점을 새로 만들지 않았나 ──
 * 지점을 만들면 지점 고르는 칸마다 그것이 나오고, 급여·매출이 지점별로 갈리는
 * 화면마다 빈 지점이 하나 늘어난다. 회원 하나 때문에 센터의 뼈대를 바꾸는 셈이다.
 * 표시 하나가 더 작다.
 *
 * ── 이 표시가 하는 일은 "빼는 것" 하나다 ──
 * 회원 목록 · 지점 인원수 · 급여 집계 · 발급 내역 · 매출에서 전부 빠진다.
 * 한 군데라도 새면 가짜 회원이 진짜 숫자에 섞이고, 그 숫자로 강사 급여가
 * 나간다. **그래서 빼는 자리마다 테스트가 있다.**
 *
 * ── 서버만 설정한다 ──
 * 규칙이 `reviewDemo` 를 앱에서 못 쓰게 막는다(만들 때도, 고칠 때도). 켜는
 * 것은 Firebase 콘솔에서 대표가 직접 한다 -- 회원 하나에 한 번뿐인 일이라
 * 버튼을 만들 이유가 없고, 버튼이 없으면 실수로 눌릴 일도 없다.
 *
 * ── 두 겹으로 막는다 ──
 * 그 회원의 회원권은 **0원 · 기타**로만 발급한다. 위의 제외가 한 군데
 * 새더라도 더해지는 금액이 0 이라 급여와 매출이 틀어지지 않는다. 운영 약속이라
 * 코드가 강제하지는 않지만, 그래서 적어 둔다.
 */

/** 대표 화면에서만 붙는 표. 심사관에게는 보이지 않는다 -- 회원 앱에는 없는 말이다. */
export const REVIEW_DEMO_BADGE = "심사용";

const text = (value) => String(value ?? "").trim();

/** 심사용으로 표시된 회원인가. */
export const isReviewDemo = (client) => client?.reviewDemo === true;

/**
 * 빼야 할 회원의 id 들.
 *
 * 집계는 원장을 읽는다 -- 원장 항목에는 이 표시가 없고 `clientId` 만 있다.
 * 그래서 명부에서 id 를 모아 두고 그것으로 거른다.
 *
 * @param {Array<any>} clients @returns {Set<string>}
 */
export function reviewDemoClientIds(clients) {
  const found = new Set();
  for (const client of Array.isArray(clients) ? clients : []) {
    if (!isReviewDemo(client)) continue;
    const id = text(client.id || client.clientId);
    if (id) found.add(id);
  }
  return found;
}

/**
 * 심사용 회원을 뺀 목록.
 *
 * 대표에게는 남긴다 -- 대표는 그 회원이 거기 있다는 것을 알아야 하고, 화면이
 * 배지로 그것을 말한다. 안 보이면 왜 숫자가 안 맞는지 물을 곳이 없다.
 *
 * @param {Array<any>} clients @param {{ role?: string }} [viewer]
 */
export function visibleToRole(clients, viewer = {}) {
  const list = Array.isArray(clients) ? clients : [];
  if (text(viewer.role) === "owner") return list;
  return list.filter((client) => !isReviewDemo(client));
}

/**
 * 숫자를 세는 목록에서 뺀다. 대표에게도 뺀다 -- 이건 보이는 문제가 아니라
 * **세는 문제**이고, 대표의 급여 합계에 가짜가 섞이면 그것이 가장 나쁘다.
 *
 * @param {Array<any>} rows @param {Set<string>} excluded
 * @param {(row: any) => string} [keyOf] 기본은 clientId
 */
export function withoutReviewDemo(rows, excluded, keyOf = (row) => text(row?.clientId)) {
  if (!(excluded instanceof Set) || excluded.size === 0) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => !excluded.has(keyOf(row)));
}

/**
 * 회원권 한 장이 심사용 회원의 것인가. 듀엣은 한쪽만 심사용일 수 없지만,
 * 그래도 둘 다 본다 -- 한 사람이라도 걸리면 그 회원권은 집계에서 뺀다.
 *
 * @param {any} pass @param {Set<string>} excluded
 */
export function passIsReviewDemo(pass, excluded) {
  if (!(excluded instanceof Set) || excluded.size === 0) return false;
  if (excluded.has(text(pass?.clientId))) return true;
  const listed = Array.isArray(pass?.clientIds) ? pass.clientIds : [];
  return listed.some((id) => excluded.has(text(id)));
}
