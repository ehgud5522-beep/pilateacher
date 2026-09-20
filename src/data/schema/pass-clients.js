/**
 * 회원권 하나에 회원 둘 — 듀엣.
 *
 * ── 확정된 것 ──
 * 듀엣은 계약서가 하나이고 회원권도 하나다. 30회 계약이면 두 명이 함께 쓰는
 * 30회다. 수업 한 번에 1회 차감되고 잔여가 29가 된다. 급여도 수업 한 번 기준
 * (2:1 신규 30,000 / 재등록 35,000). 한 명이 노쇼여도 그대로 차감되고 그대로
 * 지급된다. 두 명을 한 단위로 본다.
 *
 * ── 왜 clientId 를 그대로 두는가 ──
 * clientIds 로 갈아치우지 않고 더한다. 이유가 둘이다.
 *
 * 하나. 규칙이 원장 항목을 회원권에 못 박고 있다 --
 * `entry.clientId == getAfter(pass).data.clientId`. 배열로 바꾸면 그 조건이
 * 무엇과 비교해야 하는지부터 답이 없고, 이미 쌓인 원장 항목은 영영 그 필드를
 * 들고 있다.
 *
 * 둘. pass.clientId 를 읽는 자리가 서른 곳이 넘는다. 전부 배열을 다루게 하면
 * 그중 한 곳이 조용히 첫 번째만 보게 되는 날이 오고, 그 한 곳이 하필 급여면
 * 원장은 append-only 라 고칠 수 없다.
 *
 * 그래서 불변식 하나로 묶는다.
 *
 *   clientIds[0] === clientId
 *
 * clientId 는 "이 회원권의 대표 회원"이고 clientIds 는 "함께 쓰는 사람 전부"다.
 * 대표를 읽던 코드는 그대로 돌고, 둘 다 봐야 하는 곳만 clientIds 를 본다.
 *
 * ── 대표가 특별대우를 받지는 않는다 ──
 * 차감은 두 사람 모두에게 일어난다: 참가자 문서도 둘, 강사-회원 누적도 둘.
 * 대표는 회원권 문서를 찾는 열쇠일 뿐 급여나 회차에서 앞서지 않는다.
 *
 * ── 아직 없는 것 ──
 * 듀엣이 깨지는 경우는 이 범위 밖이다. 환불·정산 규칙이 먼저 정해져야 한다.
 * 지금은 대표가 회원권을 취소하고 다시 발급한다 -- 이력이 남으므로 안전하다.
 * 나중에 제대로 넣을 수 있게 구조는 열어 둔다: 여기 어디에도 "둘은 영원히
 * 함께" 라고 적혀 있지 않고, 갈라서는 길은 clientIds 를 줄이는 문 하나를
 * 여는 일이 된다.
 */

/** 한 회원권에 담을 수 있는 회원 수. 듀엣이 둘이고, 트리오는 아직 없다. */
export const MAX_PASS_CLIENTS = 2;

const text = (value) => String(value ?? "").trim();

/**
 * 이 회원권을 함께 쓰는 회원 전부. 언제나 길이 1 이상이다.
 *
 * clientIds 가 없는 옛 회원권은 대표 한 명짜리로 읽는다 -- 이관된 것과 이
 * 기능 전에 발급된 것이 전부 그렇고, 그 회원권들은 실제로 1:1 이다.
 *
 * @param {any} pass
 * @returns {Array<string>}
 */
export function passClientIds(pass) {
  const anchor = text(pass?.clientId);
  const listed = Array.isArray(pass?.clientIds) ? pass.clientIds.map(text).filter(Boolean) : [];
  if (!listed.length) return anchor ? [anchor] : [];
  /* 불변식이 깨진 문서를 만나면 대표를 앞으로 되돌린다. 던지지 않는 것은 이
     함수가 읽기 경로에 있기 때문이다 -- 문서 하나가 이상하다고 그 회원의 화면이
     통째로 비면 안 된다. 쓰기 쪽은 normalizePassClientIds 가 막는다. */
  if (anchor && listed[0] !== anchor) {
    return [anchor, ...listed.filter((id) => id !== anchor)];
  }
  return listed;
}

/** 둘이 함께 쓰는 회원권인가. */
export const isDuetPass = (pass) => passClientIds(pass).length > 1;

/**
 * 이 회원의 짝. 듀엣이 아니거나 이 회원의 회원권이 아니면 빈 문자열이다.
 *
 * @param {any} pass @param {string} clientId
 */
export function partnerClientId(pass, clientId) {
  const id = text(clientId);
  const all = passClientIds(pass);
  if (!id || !all.includes(id)) return "";
  return all.find((other) => other !== id) || "";
}

/** 이 회원권이 이 회원의 것인가. 대표든 짝이든 같다. */
export const passBelongsTo = (pass, clientId) => {
  const id = text(clientId);
  return Boolean(id) && passClientIds(pass).includes(id);
};

/**
 * 발급·이관이 쓰는 검사. 여기서만 던진다.
 *
 * @param {string} clientId 대표 회원
 * @param {unknown} clientIds 함께 쓰는 회원 전부. 없으면 대표 한 명
 * @returns {Array<string>}
 */
export function normalizePassClientIds(clientId, clientIds) {
  const anchor = text(clientId);
  if (!anchor) throw new Error("Missing clientId");
  if (clientIds === undefined || clientIds === null) return [anchor];
  if (!Array.isArray(clientIds)) throw new Error("Invalid clientIds");

  const all = clientIds.map(text);
  if (all.some((id) => !id)) throw new Error("Invalid clientIds");
  if (!all.length || all.length > MAX_PASS_CLIENTS) throw new Error("Invalid clientIds");
  /* 같은 사람을 두 번 적으면 회차는 하나인데 누적은 둘이 올라간다. 20회 판정이
     실제의 두 배 속도로 지나간다. */
  if (new Set(all).size !== all.length) throw new Error("Invalid clientIds");
  // 불변식. 대표가 첫 번째가 아니면 규칙과 원장이 가리키는 사람이 달라진다.
  if (all[0] !== anchor) throw new Error("Invalid clientIds");
  return all;
}

/**
 * 이 수업의 단가를 정할 때 볼 누적 횟수.
 *
 * 판정 3 은 "이 강사가 이 회원을 아직 모른다" 를 묻는다. 듀엣에서 한 명이 새
 * 사람이면 그 수업은 강사에게 아직 새 수업이므로, 둘 중 적은 쪽을 본다.
 *
 * 누적 자체는 둘 다 올라간다 -- 강사는 두 사람을 각각 가르쳤다. 둘이 늘 함께
 * 다니면 값이 같아 이 함수는 아무 일도 하지 않고, 한 명이 따로 1:1 도 할 때에만
 * 갈라진다.
 *
 * @param {Array<number>} sessionsPerClient
 */
export function pricingPriorSessions(sessionsPerClient) {
  const counts = (Array.isArray(sessionsPerClient) ? sessionsPerClient : [])
    .map((value) => (Number.isInteger(value) && value >= 0 ? value : 0));
  return counts.length ? Math.min(...counts) : 0;
}
